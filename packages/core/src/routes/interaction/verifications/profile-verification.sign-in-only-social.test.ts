import { InteractionEvent } from '@logto/schemas';
import { pickDefault } from '@logto/shared/esm';

import { mockSignInExperience } from '#src/__mocks__/sign-in-experience.js';
import RequestError from '#src/errors/RequestError/index.js';
import { MockTenant } from '#src/test-utils/tenant.js';

import type { Identifier, IdentifierVerifiedInteractionResult } from '../types/index.js';

const { jest } = import.meta;

/**
 * LOGTO PATCH(social-sign-in-only-targets): regression guard for the deprecated Interaction API.
 *
 * `POST /api/interaction/submit` provisions users through `verifyProfile` and never touches
 * `SignInExperienceValidator`, so the Experience API guard does not cover it. Its own sign-in
 * experience checks ignore social identifiers entirely (`verifyIdentifierSettings` returns early
 * for `connectorId`), which made this router — mounted unconditionally in `routes/init.ts` — a
 * complete bypass. These tests fail if the guard is removed from that path.
 */

const userQueries = {
  hasUser: jest.fn().mockResolvedValue(false),
  findUserById: jest.fn().mockResolvedValue({ id: 'foo' }),
  hasUserWithEmail: jest.fn().mockResolvedValue(false),
  hasUserWithNormalizedPhone: jest.fn().mockResolvedValue(false),
  hasUserWithIdentity: jest.fn().mockResolvedValue(false),
};

const findDefaultSignInExperience = jest.fn();
const getConnector = jest.fn();
const getLogtoConnectorById = jest.fn().mockResolvedValue({ metadata: { target: 'wallet' } });

const buildTenant = (signInOnlyConnectorTargets?: string[]) =>
  new MockTenant(
    undefined,
    {
      users: userQueries,
      signInExperiences: {
        findDefaultSignInExperience: findDefaultSignInExperience.mockResolvedValue({
          ...mockSignInExperience,
          socialSignIn: { signInOnlyConnectorTargets },
        }),
      },
    },
    { getLogtoConnectorById },
    {
      socials: { getConnector: getConnector.mockResolvedValue({ metadata: { target: 'wallet' } }) },
    }
  );

const verifyProfile = await pickDefault(import('./profile-verification.js'));

const identifiers: Identifier[] = [
  { key: 'social', connectorId: 'wallet-connector-id', userInfo: { id: 'unknown-key' } },
];

const registerInteraction: IdentifierVerifiedInteractionResult = {
  event: InteractionEvent.Register,
  identifiers,
  profile: { connectorId: 'wallet-connector-id' },
};

describe('sign-in-only social connector target (deprecated Interaction API)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects registration driven by a sign-in-only social target', async () => {
    await expect(verifyProfile(buildTenant(['wallet']), registerInteraction)).rejects.toMatchError(
      new RequestError({ code: 'user.identity_not_exist', status: 403 })
    );
  });

  it('leaves other social connector targets free to register', async () => {
    await expect(
      verifyProfile(buildTenant(['some-other-target']), registerInteraction)
    ).resolves.toMatchObject({ event: InteractionEvent.Register });
  });

  it('is off by default: an empty policy keeps upstream registration behaviour', async () => {
    await expect(verifyProfile(buildTenant(), registerInteraction)).resolves.toMatchObject({
      event: InteractionEvent.Register,
    });
    // The policy is opt-in, so no connector is resolved when the list is unset.
    expect(getConnector).not.toHaveBeenCalled();
  });

  it('does not read the social sign-in policy when nothing social is involved', async () => {
    await expect(
      verifyProfile(buildTenant(['wallet']), {
        event: InteractionEvent.Register,
        identifiers: [{ key: 'emailVerified', value: 'email@logto.io' }],
        profile: { email: 'email@logto.io' },
      })
    ).resolves.toMatchObject({ event: InteractionEvent.Register });
    expect(getConnector).not.toHaveBeenCalled();
  });

  it('still lets a sign-in-only target sign an existing user in', async () => {
    await expect(
      verifyProfile(buildTenant(['wallet']), {
        event: InteractionEvent.SignIn,
        accountId: 'foo',
        identifiers,
        profile: {},
      })
    ).resolves.toMatchObject({ event: InteractionEvent.SignIn });
  });
});
