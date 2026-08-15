import { assert, conditional, pick } from '@silverhand/essentials';

import {
  type GetAuthorizationUri,
  type GetUserInfo,
  type SocialConnector,
  type CreateConnector,
  type GetConnectorConfig,
  parseJsonObject,
  ConnectorError,
  ConnectorErrorCodes,
  validateConfig,
  ConnectorType,
  type GetTokenResponseAndUserInfo,
  type GetAccessTokenByRefreshToken,
  type GetSession,
} from '@logto/connector-kit';
import ky, { HTTPError } from 'ky';

import { defaultMetadata, defaultTimeout } from './constant.js';
import { constructAuthorizationUri } from './oauth2/utils.js';
import {
  type Oauth2ConnectorConfig,
  oauth2ConnectorConfigGuard,
  oauth2ConnectorSessionGuard,
} from './types.js';
import {
  userProfileMapping,
  getAccessToken,
  generateCodeChallenge,
  generateCodeVerifier,
  getAccessTokenByRefreshToken as _getAccessTokenByRefreshToken,
} from './utils.js';

export * from './oauth2/index.js';

/**
 * LOGTO PATCH(oauth2-pkce): read and validate the connector session before the token exchange.
 * Replaces the inline `getSession()` + `redirectUri` assertion that upstream duplicates in
 * `getUserInfo` and `getTokenResponseAndUserInfo`, and additionally restores the PKCE code
 * verifier stored by `getAuthorizationUri`. The verifier is required (and only returned) when
 * the connector has `enablePkce` on, so turning the option off never sends a stale verifier.
 *
 * Upstream (in both functions):
 *   const { redirectUri } = await getSession();
 *   assert(redirectUri, new ConnectorError(...));
 */
const getSessionResult = async (getSession: GetSession, enablePkce: boolean) => {
  const result = oauth2ConnectorSessionGuard.safeParse(await getSession());

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.General, {
      message: 'Invalid connector session.',
    });
  }

  const { redirectUri, codeVerifier } = result.data;

  assert(
    redirectUri,
    new ConnectorError(ConnectorErrorCodes.General, {
      message: 'Cannot find `redirectUri` from connector session.',
    })
  );

  if (enablePkce) {
    assert(
      codeVerifier,
      new ConnectorError(ConnectorErrorCodes.General, {
        message: 'Cannot find `codeVerifier` from connector session.',
      })
    );
  }

  return { redirectUri, codeVerifier: conditional(enablePkce && codeVerifier) };
};

const getAuthorizationUri =
  (getConfig: GetConnectorConfig): GetAuthorizationUri =>
  async ({ state, redirectUri, scope }, setSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oauth2ConnectorConfigGuard);
    const parsedConfig = oauth2ConnectorConfigGuard.parse(config);

    const { authorizationEndpoint, customConfig, enablePkce } = parsedConfig;

    /**
     * LOGTO PATCH(oauth2-pkce): bind the authorization code to a PKCE (RFC 7636) code verifier.
     * Upstream sends no code challenge, so an authorization code intercepted on the redirect
     * can be redeemed by whoever holds it. The verifier travels in the connector session, which
     * already carries `redirectUri`; when `enablePkce` is off nothing is generated and both the
     * session and the authorization URI stay byte-for-byte identical to upstream.
     *
     * Upstream: await setSession({ redirectUri });
     */
    const codeVerifier = conditional(enablePkce && generateCodeVerifier());

    await setSession({ redirectUri, ...conditional(codeVerifier && { codeVerifier }) });

    return constructAuthorizationUri(authorizationEndpoint, {
      ...pick(parsedConfig, 'responseType', 'clientId', 'scope'),
      redirectUri,
      state,
      ...customConfig,
      // If scope is provided, it will override the scope in the config.
      ...conditional(scope && { scope }),
      ...conditional(
        codeVerifier && {
          codeChallenge: generateCodeChallenge(codeVerifier),
          codeChallengeMethod: 'S256',
        }
      ),
    });
  };

const _getUserInfo = async (
  config: Oauth2ConnectorConfig,
  token_type: string,
  access_token: string
) => {
  try {
    const httpResponse = await ky.get(config.userInfoEndpoint, {
      headers: {
        authorization: `${token_type} ${access_token}`,
      },
      timeout: defaultTimeout,
    });

    const rawData = parseJsonObject(await httpResponse.text());

    return { ...userProfileMapping(rawData, config.profileMap), rawData };
  } catch (error: unknown) {
    if (error instanceof HTTPError) {
      throw new ConnectorError(ConnectorErrorCodes.General, JSON.stringify(error.response.body));
    }

    throw error;
  }
};

const getUserInfo =
  (getConfig: GetConnectorConfig): GetUserInfo =>
  async (data, getSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oauth2ConnectorConfigGuard);
    const parsedConfig = oauth2ConnectorConfigGuard.parse(config);

    const { redirectUri, codeVerifier } = await getSessionResult(
      getSession,
      parsedConfig.enablePkce
    );

    const { access_token, token_type } = await getAccessToken(
      parsedConfig,
      data,
      redirectUri,
      codeVerifier
    );
    return _getUserInfo(parsedConfig, token_type, access_token);
  };

const getTokenResponseAndUserInfo =
  (getConfig: GetConnectorConfig): GetTokenResponseAndUserInfo =>
  async (data, getSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oauth2ConnectorConfigGuard);
    const parsedConfig = oauth2ConnectorConfigGuard.parse(config);

    const { redirectUri, codeVerifier } = await getSessionResult(
      getSession,
      parsedConfig.enablePkce
    );

    const tokenResponse = await getAccessToken(parsedConfig, data, redirectUri, codeVerifier);

    const userInfo = await _getUserInfo(
      parsedConfig,
      tokenResponse.token_type,
      tokenResponse.access_token
    );

    return {
      tokenResponse,
      userInfo,
    };
  };

const getAccessTokenByRefreshToken =
  (getConfig: GetConnectorConfig): GetAccessTokenByRefreshToken =>
  async (refreshToken: string) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oauth2ConnectorConfigGuard);
    return _getAccessTokenByRefreshToken(config, refreshToken);
  };

const createOauthConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => {
  return {
    metadata: defaultMetadata,
    type: ConnectorType.Social,
    configGuard: oauth2ConnectorConfigGuard,
    getAuthorizationUri: getAuthorizationUri(getConfig),
    getUserInfo: getUserInfo(getConfig),
    getTokenResponseAndUserInfo: getTokenResponseAndUserInfo(getConfig),
    getAccessTokenByRefreshToken: getAccessTokenByRefreshToken(getConfig),
  };
};

export default createOauthConnector;
