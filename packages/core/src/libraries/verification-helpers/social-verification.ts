import type { ConnectorSession, SocialUserInfo } from '@logto/connector-kit';
import {
  connectorSessionGuard,
  GoogleConnector,
  isExternalGoogleOneTap,
  isGoogleOneTap as isGoogleOneTapChecker,
  logtoGoogleOneTapCookieKey,
} from '@logto/connector-kit';
import type { Connector, SignInExperience, SocialConnectorPayload } from '@logto/schemas';
import { ConnectorType } from '@logto/schemas';
import type { Context } from 'koa';
import type { Provider } from 'oidc-provider';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import type { WithLogContext } from '#src/middleware/koa-audit-log.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';
import { type LogtoConnector } from '#src/utils/connectors/types.js';

type SocialAuthorizationUrlPayload = {
  connectorId: string;
  state: string;
  redirectUri: string;
  scope?: string;
};

/**
 * LOGTO PATCH(social-sign-in-connector-targets-enforcement): refuse to start a social
 * authorization when the connector is not enabled in the sign-in experience.
 *
 * `socialSignInConnectorTargets` is the console switch for social sign-in, but upstream only reads
 * it to decide which buttons to render (`libraries/sign-in-experience`). The sign-in flow itself
 * resolves the connector by id and never consults the switch, so removing a connector from the
 * console hides the button while the authorization-uri endpoints keep answering to anyone who
 * knows the `connectorId`. This is the single place where the switch is enforced: both sign-in
 * entry points (`POST /api/experience/verification/social/:connectorId/authorization-uri` and the
 * legacy `POST /api/interaction/verification/social-authorization-uri`) reach the connector
 * through {@link createSocialAuthorizationUrl}.
 *
 * Deliberately NOT applied to the Account Center identity-linking flow: that one goes through
 * `SocialVerification.createAuthorizationUrl(..., 'verificationRecord')` →
 * `createSocialAuthorizationSession`, never through this helper, and is governed by a different
 * switch (`accountCenter.fields.social`). Linking an identity is not signing in, so the sign-in
 * switch must not close it.
 *
 * The rejection reuses the exact error `getLogtoConnectorById` throws for an unknown id, so a
 * disabled connector is indistinguishable from a non-existent one and the endpoint cannot be used
 * to enumerate the tenant's connectors.
 *
 * `findDefaultSignInExperience` is read per request (memoized in the well-known cache, which the
 * console's `PATCH /api/sign-in-exp` invalidates), so toggling a connector takes effect at once.
 *
 * Upstream: (no check — the connector was used as soon as it resolved and typed as social)
 */
export const assertSocialSignInConnectorEnabled = async (
  queries: Queries,
  connector: {
    metadata: Pick<LogtoConnector['metadata'], 'target'>;
    dbEntry: Pick<Connector, 'id'>;
  }
) => {
  const { socialSignInConnectorTargets } =
    await queries.signInExperiences.findDefaultSignInExperience();

  if (!socialSignInConnectorTargets.includes(connector.metadata.target)) {
    throw new RequestError({
      code: 'entity.not_found',
      id: connector.dbEntry.id,
      status: 404,
    });
  }
};

/**
 * LOGTO PATCH(social-sign-in-only-targets): refuse to provision a user from a social identity
 * whose connector target is listed in `socialSignIn.signInOnlyConnectorTargets`.
 *
 * Such a connector may authenticate an existing user but must never create one: an identity the
 * directory does not know is an unknown party, not a new user. Enrollment for those targets
 * happens through a separate, deliberate path (e.g. the Account API with the user's own token).
 *
 * This is the single implementation of the rule, shared by both registration paths so they can
 * not drift apart:
 * - the Experience API, through `SignInExperienceValidator.guardInteractionEvent`, and
 * - the deprecated but still mounted Interaction API, through `verifyProfile`
 *   (`POST /api/interaction/submit`), which does not use `SignInExperienceValidator` at all.
 *
 * The rule keys off the connector *target*, not the connector id, because that is what
 * `sign_in_experiences` stores everywhere else (see `socialSignInConnectorTargets`), and it is
 * read from the sign-in experience on every request, so console changes take effect immediately.
 * No connector id is hard-coded here.
 *
 * The check is intentionally target-scoped and *directory-independent*: it fires on configuration
 * alone, identically for a known and an unknown identity, so it can not be used to probe which
 * identities are enrolled. The reused `user.identity_not_exist` code and message are the exact
 * ones the caller already gets from the preceding identification attempt, so the refusal adds no
 * new distinguishable signal while still telling the user something actionable.
 *
 * @throws {RequestError} with status 403 if any of the given connectors is sign-in only.
 *
 * Upstream: (no such check)
 */
export const assertSocialTargetsAllowRegistration = async (
  {
    libraries,
    getSignInExperience,
  }: {
    libraries: Pick<Libraries, 'socials'>;
    /**
     * Reads the sign-in experience. Passed in rather than queried here so each caller keeps its
     * own caching: the Experience API validator already snapshots it per interaction, and reading
     * it again would both cost an extra lookup and risk reading two different snapshots.
     */
    getSignInExperience: () => Promise<Pick<SignInExperience, 'socialSignIn'>>;
  },
  connectorIds: readonly string[]
) => {
  // Nothing social in this interaction: keep the upstream code path untouched, and in particular
  // do not read the social sign-in policy at all.
  if (connectorIds.length === 0) {
    return;
  }

  const { socialSignIn } = await getSignInExperience();

  // Opt-in: an unset or empty list keeps upstream registration behaviour for every connector.
  if (!socialSignIn.signInOnlyConnectorTargets?.length) {
    return;
  }

  const signInOnlyTargets = new Set(socialSignIn.signInOnlyConnectorTargets);
  const targets = await Promise.all(
    connectorIds.map(async (connectorId) => {
      const {
        metadata: { target },
      } = await libraries.socials.getConnector(connectorId);

      return target;
    })
  );

  assertThat(
    targets.every((target) => !signInOnlyTargets.has(target)),
    new RequestError({ code: 'user.identity_not_exist', status: 403 })
  );
};

export const createSocialAuthorizationUrl = async (
  ctx: WithLogContext,
  { provider, connectors, queries }: TenantContext,
  payload: SocialAuthorizationUrlPayload
) => {
  const { getLogtoConnectorById } = connectors;

  const { connectorId, state, redirectUri, scope } = payload;
  assertThat(state && redirectUri, 'session.insufficient_info');

  const connector = await getLogtoConnectorById(connectorId);

  assertThat(connector.type === ConnectorType.Social, 'connector.unexpected_type');

  // LOGTO PATCH(social-sign-in-connector-targets-enforcement): see the helper above.
  await assertSocialSignInConnectorEnabled(queries, connector);

  const {
    headers: { 'user-agent': userAgent },
  } = ctx.request;

  const { jti } = await provider.interactionDetails(ctx.req, ctx.res);

  return connector.getAuthorizationUri(
    {
      state,
      redirectUri,
      scope,
      /**
       * For POST /authn/saml/:connectorId API, we need to block requests
       * for non-SAML connector (relies on connectorFactoryId) and use `connectorId`
       * to find correct connector config.
       */
      connectorId,
      connectorFactoryId: connector.metadata.id,
      jti,
      headers: { userAgent },
    },
    async (connectorStorage: ConnectorSession) =>
      assignConnectorSessionResult(ctx, provider, connectorStorage)
  );
};

export const verifySocialIdentity = async (
  { connectorId, connectorData }: SocialConnectorPayload,
  ctx: WithLogContext,
  { provider, libraries }: TenantContext
): Promise<SocialUserInfo> => {
  const {
    socials: { getUserInfo, getConnector },
  } = libraries;

  const log = ctx.createLog('Interaction.SignIn.Identifier.Social.Submit');
  log.append({ connectorId, connectorData });

  const connector = await getConnector(connectorId);

  // Verify the CSRF token if it's a Google connector and has credential (a Google One Tap
  // verification)
  if (connector.metadata.id === GoogleConnector.factoryId && isGoogleOneTapChecker(connectorData)) {
    if (isExternalGoogleOneTap(connectorData)) {
      assertThat(
        connectorData[GoogleConnector.oneTapParams.credential] ===
          ctx.cookies.get(logtoGoogleOneTapCookieKey),
        'session.google_one_tap.cookie_mismatch'
      );
    } else {
      const csrfToken = connectorData[GoogleConnector.oneTapParams.csrfToken];
      const value = ctx.cookies.get(GoogleConnector.oneTapParams.csrfToken);
      assertThat(value === csrfToken, 'session.csrf_token_mismatch');
    }
  }

  const userInfo = await getUserInfo(connectorId, connectorData, async () =>
    getConnectorSessionResult(ctx, provider)
  );

  log.append(userInfo);

  return userInfo;
};

export const assignConnectorSessionResult = async (
  ctx: Context,
  provider: Provider,
  connectorSession: ConnectorSession
) => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  await provider.interactionResult(ctx.req, ctx.res, {
    ...details.result,
    connectorSession,
  });
};

export const getConnectorSessionResult = async (
  ctx: Context,
  provider: Provider
): Promise<ConnectorSession> => {
  const { result } = await provider.interactionDetails(ctx.req, ctx.res);

  const signInResult = z
    .object({
      connectorSession: connectorSessionGuard,
    })
    .safeParse(result);

  assertThat(result && signInResult.success, 'session.connector_validation_session_not_found');

  const { connectorSession, ...rest } = result;
  await provider.interactionResult(ctx.req, ctx.res, {
    ...rest,
  });

  return signInResult.data.connectorSession;
};
