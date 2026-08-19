/* eslint-disable max-lines */
import { ConnectorType, TemplateType } from '@logto/connector-kit';
import {
  adminConsoleApplicationId,
  adminTenantId,
  type CreateUser,
  InteractionEvent,
  LogtoActionKey,
  type JwtCustomizerUserContext,
  type SignInExperience,
  SignInIdentifier,
  SignInMode,
  type User,
  VerificationType,
  MfaPolicy,
  MfaFactor,
} from '@logto/schemas';
import { createMockUtils, pickDefault } from '@logto/shared/esm';

import { mockSignInExperience } from '#src/__mocks__/sign-in-experience.js';
import { mockUser, mockUserWithMfaVerifications } from '#src/__mocks__/user.js';
import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { type InsertUserResult } from '#src/libraries/user.js';
import { createMockLogContext } from '#src/test-utils/koa-audit-log.js';
import { createMockProvider } from '#src/test-utils/oidc-provider.js';
import { MockTenant } from '#src/test-utils/tenant.js';
import { createContextWithRouteParameters } from '#src/utils/test-utils.js';

import { type Interaction, type WithHooksAndLogsContext } from '../types.js';

import { EmailCodeVerification } from './verifications/code-verification.js';
import { SocialVerification } from './verifications/social-verification.js';
import { SignInPasskeyVerification } from './verifications/web-authn-verification.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);

mockEsm('#src/utils/tenant.js', () => ({
  getTenantId: () => [adminTenantId],
}));

const mockEmail = 'foo@bar.com';
const userQueries = {
  hasActiveUsers: jest.fn().mockResolvedValue(false),
  hasUserWithEmail: jest.fn().mockResolvedValue(false),
  hasUserWithNormalizedPhone: jest.fn().mockResolvedValue(false),
  hasUserWithIdentity: jest.fn().mockResolvedValue(false),
  findUserById: jest.fn().mockResolvedValue(mockUser),
  updateUserById: jest.fn().mockResolvedValue(mockUser),
};
const userLibraries = {
  checkIdentifierCollision: jest.fn().mockResolvedValue(null),
  generateUserId: jest.fn().mockResolvedValue('uid'),
  insertUser: jest.fn(async (user: CreateUser): Promise<InsertUserResult> => [user as User]),
  provisionOrganizations: jest.fn().mockResolvedValue([]),
  provisionOrganizationsByEmailDomain: jest.fn().mockResolvedValue([]),
};
const ssoConnectors = {
  getAvailableSsoConnectors: jest.fn().mockResolvedValue([]),
};
const signInExperiences = {
  findDefaultSignInExperience: jest.fn().mockResolvedValue({
    ...mockSignInExperience,
    signUp: {
      identifiers: [SignInIdentifier.Email],
      password: false,
      verify: true,
    },
  }),
  updateDefaultSignInExperience: jest.fn(),
};

const mockProviderInteractionDetails = jest
  .fn()
  .mockResolvedValue({ params: { client_id: adminConsoleApplicationId } });
const mockJwtCustomizerUserContext: JwtCustomizerUserContext = {
  id: mockUser.id,
  username: mockUser.username,
  primaryEmail: mockUser.primaryEmail,
  primaryPhone: mockUser.primaryPhone,
  name: mockUser.name,
  avatar: mockUser.avatar,
  customData: mockUser.customData,
  identities: mockUser.identities,
  lastSignInAt: mockUser.lastSignInAt,
  createdAt: mockUser.createdAt,
  updatedAt: mockUser.updatedAt,
  profile: mockUser.profile,
  applicationId: mockUser.applicationId,
  cimdClientId: mockUser.cimdClientId,
  isSuspended: mockUser.isSuspended,
  hasPassword: true,
  ssoIdentities: [],
  mfaVerificationFactors: [],
  roles: [],
  organizations: [],
  organizationRoles: [],
};

const ExperienceInteraction = await pickDefault(import('./experience-interaction.js'));

const createSignInInteraction = ({
  headers,
  interactionEvent = InteractionEvent.SignIn,
  adaptiveMfaEnabled = false,
  user = mockUser,
  interactionResult = {},
  signInExperienceOverrides = {},
}: {
  headers?: Record<string, string>;
  interactionEvent?: InteractionEvent;
  adaptiveMfaEnabled?: boolean;
  user?: User;
  interactionResult?: Record<string, unknown>;
  signInExperienceOverrides?: Partial<SignInExperience>;
} = {}) => {
  const userGeoLocations = {
    upsertUserGeoLocation: jest.fn().mockResolvedValue(null),
  };
  const userSignInCountries = {
    upsertUserSignInCountry: jest.fn().mockResolvedValue(null),
    pruneUserSignInCountriesByUserId: jest.fn().mockResolvedValue(null),
  };
  const signInExperiencesWithAdaptiveMfa = {
    findDefaultSignInExperience: jest.fn().mockResolvedValue({
      ...mockSignInExperience,
      adaptiveMfa: { enabled: adaptiveMfaEnabled },
      passwordExpiration: {
        enabled: false,
      },
      ...signInExperienceOverrides,
    }),
  };
  const signInUserQueries = {
    ...userQueries,
    findUserById: jest.fn().mockResolvedValue(user),
    updateUserById: jest.fn().mockResolvedValue(user),
  };
  const runActionHandler = jest.fn(
    async (_input: { event: unknown; key: LogtoActionKey }): Promise<unknown> => undefined
  );
  const runAction = jest.fn(
    async <Event>(
      input: { key: LogtoActionKey; auditContext: unknown } & (
        | { event: Event }
        | { getEvent: () => Promise<Event> }
      )
    ): Promise<unknown> => {
      const event = 'getEvent' in input ? await input.getEvent() : input.event;
      return runActionHandler({ key: input.key, event });
    }
  );
  const getUserContext = jest.fn().mockResolvedValue(mockJwtCustomizerUserContext);
  const provider = createMockProvider();
  const signInTenant = new MockTenant(
    provider,
    {
      users: signInUserQueries,
      signInExperiences: signInExperiencesWithAdaptiveMfa,
      userGeoLocations,
      userSignInCountries,
    },
    undefined,
    {
      users: userLibraries,
      ssoConnectors,
      actions: { runAction },
      jwtCustomizers: { getUserContext },
    }
  );
  const logContext = createMockLogContext();
  const baseContext = createContextWithRouteParameters(
    headers
      ? { headers }
      : {
          headers: {
            'x-logto-cf-country': 'US',
            'x-logto-cf-latitude': '37.7749',
            'x-logto-cf-longitude': '-122.4194',
          },
        }
  );
  const interactionDetails = {
    jti: 'session-id',
    params: {
      client_id: adminConsoleApplicationId,
    },
    result: {
      interactionEvent,
      userId: user.id,
      ...interactionResult,
    },
  } as unknown as Interaction;
  const signInContext: WithHooksAndLogsContext = {
    assignReleaseOnSuccessInteractionHookResult: jest.fn(),
    assignReleaseAnywayInteractionHookResult: jest.fn(),
    appendDataHookContext: jest.fn(),
    appendExceptionHookContext: jest.fn(),
    ...baseContext,
    ...logContext,
    interactionDetails,
  };

  const experienceInteraction = new ExperienceInteraction(
    signInContext,
    signInTenant,
    interactionDetails
  );

  return {
    experienceInteraction,
    provider,
    runAction,
    runActionHandler,
    getUserContext,
    signInUserQueries,
    userGeoLocations,
    userSignInCountries,
    createLog: logContext.createLog,
    mockAppend: logContext.mockAppend,
  };
};

describe('ExperienceInteraction class', () => {
  const originalIsDevFeaturesEnabled = EnvSet.values.isDevFeaturesEnabled;
  const setDevFeaturesEnabled = (enabled: boolean) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    (EnvSet.values as { isDevFeaturesEnabled: boolean }).isDevFeaturesEnabled = enabled;
  };

  const tenant = new MockTenant(
    createMockProvider(mockProviderInteractionDetails),
    {
      users: userQueries,
      signInExperiences,
    },
    undefined,
    { users: userLibraries, ssoConnectors }
  );

  // @ts-expect-error --mock test context
  const ctx: WithHooksAndLogsContext = {
    assignReleaseOnSuccessInteractionHookResult: jest.fn(),
    assignReleaseAnywayInteractionHookResult: jest.fn(),
    appendDataHookContext: jest.fn(),
    ...createContextWithRouteParameters(),
    ...createMockLogContext(),
  };
  const { libraries, queries } = tenant;

  const emailVerificationRecord = new EmailCodeVerification(libraries, queries, {
    id: 'mock_email_verification_id',
    type: VerificationType.EmailVerificationCode,
    identifier: {
      type: SignInIdentifier.Email,
      value: mockEmail,
    },
    templateType: TemplateType.Register,
    verified: true,
  });

  beforeAll(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    setDevFeaturesEnabled(originalIsDevFeaturesEnabled);
  });

  describe('new user registration', () => {
    it('First admin user provisioning', async () => {
      const experienceInteraction = new ExperienceInteraction(
        ctx,
        tenant,
        InteractionEvent.Register
      );

      experienceInteraction.setVerificationRecord(emailVerificationRecord);
      await experienceInteraction.createUser(emailVerificationRecord.id);

      expect(userLibraries.insertUser).toHaveBeenCalledWith(
        {
          id: 'uid',
          primaryEmail: mockEmail,
          logtoConfig: {
            mfa: { enabled: false },
          },
        },
        { isInteractive: true, roleNames: ['user', 'default:admin'] }
      );

      expect(signInExperiences.updateDefaultSignInExperience).toHaveBeenCalledWith({
        signInMode: SignInMode.SignIn,
      });

      expect(userLibraries.provisionOrganizationsByEmailDomain).toHaveBeenCalledWith(
        'uid',
        mockEmail
      );
    });
  });

  /**
   * LOGTO PATCH(social-sign-in-only-targets): a social connector target listed in
   * `socialSignIn.signInOnlyConnectorTargets` must never provision a user.
   */
  describe('sign-in-only social connector target', () => {
    const walletTarget = 'wallet';
    const getConnector = jest.fn().mockResolvedValue({
      type: ConnectorType.Social,
      metadata: { target: walletTarget },
      dbEntry: { syncProfile: false },
    });

    const socialTenant = new MockTenant(
      createMockProvider(mockProviderInteractionDetails),
      { users: userQueries, signInExperiences },
      undefined,
      { users: userLibraries, ssoConnectors, socials: { getConnector } }
    );

    const buildWalletVerificationRecord = () =>
      new SocialVerification(socialTenant.libraries, socialTenant.queries, {
        id: 'mock_wallet_verification_id',
        type: VerificationType.Social,
        connectorId: 'mock_wallet_connector_id',
        socialUserInfo: { id: 'wallet_identity_id' },
      });

    beforeEach(() => {
      userLibraries.insertUser.mockClear();
      signInExperiences.findDefaultSignInExperience.mockResolvedValue({
        ...mockSignInExperience,
        signInMode: SignInMode.SignInAndRegister,
        socialSignIn: { signInOnlyConnectorTargets: [walletTarget] },
      });
    });

    afterEach(() => {
      signInExperiences.findDefaultSignInExperience.mockResolvedValue({
        ...mockSignInExperience,
        signUp: {
          identifiers: [SignInIdentifier.Email],
          password: false,
          verify: true,
        },
      });
    });

    it('does not create a user for an unknown identity', async () => {
      const experienceInteraction = new ExperienceInteraction(
        ctx,
        socialTenant,
        InteractionEvent.Register
      );
      const walletVerificationRecord = buildWalletVerificationRecord();

      experienceInteraction.setVerificationRecord(walletVerificationRecord);

      await expect(
        experienceInteraction.createUser(walletVerificationRecord.id)
      ).rejects.toMatchError(new RequestError({ code: 'user.identity_not_exist', status: 403 }));

      expect(userLibraries.insertUser).not.toHaveBeenCalled();
    });

    it('rejects switching the interaction to Register', async () => {
      const experienceInteraction = new ExperienceInteraction(
        ctx,
        socialTenant,
        InteractionEvent.SignIn
      );
      const walletVerificationRecord = buildWalletVerificationRecord();

      experienceInteraction.setVerificationRecord(walletVerificationRecord);

      await expect(
        experienceInteraction.setInteractionEvent(InteractionEvent.Register)
      ).rejects.toMatchError(new RequestError({ code: 'user.identity_not_exist', status: 403 }));
    });
  });

  describe('sign-in submission', () => {
    it('runs PostSignIn action before provider interaction result', async () => {
      const { experienceInteraction, provider, runAction, runActionHandler, getUserContext } =
        createSignInInteraction();

      await experienceInteraction.submit();

      expect(getUserContext).toHaveBeenCalledWith(mockUser.id);
      const [runActionInput] = runAction.mock.calls[0]!;
      expect(runActionInput).toMatchObject({
        key: LogtoActionKey.PostSignIn,
        auditContext: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matcher is typed as `any`.
          createLog: expect.any(Function),
          sessionId: 'session-id',
          applicationId: adminConsoleApplicationId,
          userId: mockUser.id,
        },
      });
      expect('getEvent' in runActionInput && typeof runActionInput.getEvent).toBe('function');
      expect(runActionHandler).toHaveBeenCalledWith({
        key: LogtoActionKey.PostSignIn,
        event: {
          key: LogtoActionKey.PostSignIn,
          interactionEvent: InteractionEvent.SignIn,
          user: mockJwtCustomizerUserContext,
        },
      });
      expect(runActionHandler.mock.invocationCallOrder[0]).toBeLessThan(
        (provider.interactionResult as jest.Mock).mock.invocationCallOrder[0]!
      );
    });

    it('does not include password in the PostSignIn action event', async () => {
      const { experienceInteraction, runActionHandler } = createSignInInteraction();

      await experienceInteraction.submit();

      const [{ event }] = runActionHandler.mock.calls[0]!;

      expect(event).not.toHaveProperty('password');
      expect(JSON.stringify(event)).not.toContain(mockUser.passwordEncrypted);
    });

    it('does not run PostSignIn action for register interactions', async () => {
      const { experienceInteraction, runAction, getUserContext } = createSignInInteraction({
        interactionEvent: InteractionEvent.Register,
      });

      await experienceInteraction.submit();

      expect(getUserContext).not.toHaveBeenCalled();
      expect(runAction).not.toHaveBeenCalled();
    });

    it('updates user when PostSignIn action returns updateUser', async () => {
      const { experienceInteraction, runActionHandler } = createSignInInteraction();
      const updateUser = jest.spyOn(experienceInteraction.provisionLibrary, 'updateUser');

      runActionHandler.mockResolvedValueOnce({
        action: 'updateUser',
        user: {
          name: 'Jane Doe',
        },
      });

      await experienceInteraction.submit();

      expect(updateUser).toHaveBeenCalledWith(
        mockUser.id,
        { name: 'Jane Doe' },
        { mergeCustomData: true }
      );
    });

    it('preserves existing customData when PostSignIn action writes customData', async () => {
      const user = {
        ...mockUser,
        customData: {
          p1Synced: true,
          source: 'p1',
        },
      };
      const { experienceInteraction, runActionHandler, signInUserQueries } =
        createSignInInteraction({
          user,
        });

      runActionHandler.mockResolvedValueOnce({
        action: 'updateUser',
        user: {
          customData: {
            p2Synced: true,
          },
        },
      });

      await experienceInteraction.submit();

      expect(signInUserQueries.updateUserById).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          customData: {
            p1Synced: true,
            p2Synced: true,
            source: 'p1',
          },
        }),
        'replace'
      );
    });

    it.each([undefined, null, {}, { action: 'updateUser' }])(
      'does not update user and proceeds when PostSignIn action returns no-op result %#',
      async (result) => {
        const { experienceInteraction, provider, runActionHandler } = createSignInInteraction();
        const updateUser = jest.spyOn(experienceInteraction.provisionLibrary, 'updateUser');

        runActionHandler.mockResolvedValueOnce(result);

        await experienceInteraction.submit();

        expect(updateUser).not.toHaveBeenCalled();
        expect(provider.interactionResult).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            login: { accountId: mockUser.id },
          })
        );
      }
    );

    it.each([
      { action: 'createUser', user: { name: 'Jane Doe' } },
      { action: 'rejectInvalidCredentials' },
      { action: 'denyAccess', user: { name: 'Jane Doe' } },
      { action: 'continue' },
      { ignored: true },
      { user: { name: 'Jane Doe' } },
    ])('blocks sign-in when PostSignIn action returns invalid result %#', async (result) => {
      const { experienceInteraction, provider, runActionHandler } = createSignInInteraction();

      runActionHandler.mockResolvedValueOnce(result);

      await expect(experienceInteraction.submit()).rejects.toMatchError(
        new RequestError({ code: 'session.verification_failed', status: 400 })
      );

      expect(provider.interactionResult).not.toHaveBeenCalled();
    });

    it('blocks sign-in when PostSignIn action execution fails in block mode', async () => {
      const { experienceInteraction, provider, runActionHandler } = createSignInInteraction();

      runActionHandler.mockRejectedValueOnce(
        new RequestError({ code: 'session.verification_failed', status: 400 })
      );

      await expect(experienceInteraction.submit()).rejects.toMatchError(
        new RequestError({ code: 'session.verification_failed', status: 400 })
      );

      expect(provider.interactionResult).not.toHaveBeenCalled();
    });

    it('should record geo context when dev features are disabled', async () => {
      setDevFeaturesEnabled(false);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction();

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).toHaveBeenCalledWith(
        mockUser.id,
        37.7749,
        -122.4194
      );
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });

    it('should record geo location and sign-in country when dev features are enabled', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction();

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).toHaveBeenCalledWith(
        mockUser.id,
        37.7749,
        -122.4194
      );
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });

    it('should allow zero coordinates and record them', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations } = createSignInInteraction({
        headers: {
          'x-logto-cf-country': 'US',
          'x-logto-cf-latitude': '0',
          'x-logto-cf-longitude': '0',
        },
      });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).toHaveBeenCalledWith(mockUser.id, 0, 0);
    });

    it('should skip invalid coordinates but still record valid country', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction({
          headers: {
            'x-logto-cf-country': 'US',
            'x-logto-cf-latitude': 'abc',
            'x-logto-cf-longitude': '181',
          },
        });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).not.toHaveBeenCalled();
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });

    it('should skip out-of-range latitude but still record valid country', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction({
          headers: {
            'x-logto-cf-country': 'US',
            'x-logto-cf-latitude': '-91',
            'x-logto-cf-longitude': '10',
          },
        });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).not.toHaveBeenCalled();
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });

    it('should skip invalid country codes but record coordinates', async () => {
      setDevFeaturesEnabled(true);
      const invalidCountries = ['USA', 'jpn'];

      for (const country of invalidCountries) {
        const { experienceInteraction, userGeoLocations, userSignInCountries } =
          createSignInInteraction({
            headers: {
              'x-logto-cf-country': country,
              'x-logto-cf-latitude': '37.7749',
              'x-logto-cf-longitude': '-122.4194',
            },
          });

        // eslint-disable-next-line no-await-in-loop
        await experienceInteraction.submit();

        expect(userGeoLocations.upsertUserGeoLocation).toHaveBeenCalledWith(
          mockUser.id,
          37.7749,
          -122.4194
        );
        expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(
          mockUser.id,
          undefined
        );
      }
    });

    it('should normalize lowercase country codes', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userSignInCountries } = createSignInInteraction({
        headers: {
          'x-logto-cf-country': 'jp',
          'x-logto-cf-latitude': '35.6762',
          'x-logto-cf-longitude': '139.6503',
        },
      });

      await experienceInteraction.submit();

      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'JP');
    });

    it('should record country when coordinates are missing', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction({
          headers: {
            'x-logto-cf-country': 'US',
          },
        });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).not.toHaveBeenCalled();
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });

    it('should skip recording coordinates when only latitude is provided', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction({
          headers: {
            'x-logto-cf-latitude': '51.5074',
          },
        });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).not.toHaveBeenCalled();
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(
        mockUser.id,
        undefined
      );
    });

    it('should record geo context when adaptive MFA is disabled', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction({ adaptiveMfaEnabled: false });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).toHaveBeenCalledWith(
        mockUser.id,
        37.7749,
        -122.4194
      );
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });

    it('should record geo context for register interactions', async () => {
      setDevFeaturesEnabled(true);
      const { experienceInteraction, userGeoLocations, userSignInCountries } =
        createSignInInteraction({ interactionEvent: InteractionEvent.Register });

      await experienceInteraction.submit();

      expect(userGeoLocations.upsertUserGeoLocation).toHaveBeenCalledWith(
        mockUser.id,
        37.7749,
        -122.4194
      );
      expect(userSignInCountries.upsertUserSignInCountry).toHaveBeenCalledWith(mockUser.id, 'US');
    });
  });

  describe('guardMfaVerificationStatus', () => {
    it('skips MFA verification check when sign-in passkey is already verified', async () => {
      const { libraries, queries } = tenant;
      const interactionDetails = {
        result: {
          interactionEvent: InteractionEvent.SignIn,
          userId: mockUserWithMfaVerifications.id,
        },
      } as unknown as Interaction;
      const experienceInteraction = new ExperienceInteraction(ctx, tenant, interactionDetails);

      experienceInteraction.setVerificationRecord(
        new SignInPasskeyVerification(libraries, queries, {
          id: 'mock-sign-in-passkey-verification-id',
          type: VerificationType.SignInPasskey,
          verified: true,
          userId: mockUserWithMfaVerifications.id,
        })
      );

      await expect(experienceInteraction.guardMfaVerificationStatus()).resolves.not.toThrow();
    });

    /**
     * LOGTO PATCH(te-channel-counts-as-mfa): aprobar en la cartera cuenta como segundo factor.
     *
     * Las dos mitades del contrato, y la segunda importa tanto como la primera: **sólo** el
     * conector de la cartera exime. Un social cualquiera —«entrar con Google»— identifica pero no
     * demuestra posesión de nada, y si esta excepción se le aplicara a todos, cualquier conector
     * social configurado en el tenant se convertiría en una puerta trasera al segundo factor.
     */
    const conectorTe = { id: 'te_connector_id', target: 'tripleenable' };

    /**
     * **Con el MFA de verdad exigido.** El `mockSignInExperience` trae `factors: []`, así que
     * `isMfaRequired` da `false` y el guard pasa haga lo que haga la excepción — una prueba montada
     * sobre él no probaría nada. Se configura TOTP, que es lo que el usuario de prueba tiene
     * vinculado, para que haya un segundo factor real que eximir.
     */
    const sieConMfa = {
      findDefaultSignInExperience: jest.fn().mockResolvedValue({
        ...mockSignInExperience,
        mfa: { policy: MfaPolicy.Mandatory, factors: [MfaFactor.TOTP] },
      }),
      updateDefaultSignInExperience: jest.fn(),
    };

    const tenantConConector = (target: string) =>
      new MockTenant(
        createMockProvider(mockProviderInteractionDetails),
        {
          users: {
            ...userQueries,
            // **El usuario tiene que TENER un factor vinculado.** `mockUser` no lo tiene, así que
            // `isMfaRequired` daba `false` y el guard pasaba siempre: las dos pruebas de abajo
            // habrían pasado sin comprobar nada.
            findUserById: jest.fn().mockResolvedValue(mockUserWithMfaVerifications),
          },
          signInExperiences: sieConMfa,
        },
        {
          getLogtoConnectors: jest.fn().mockResolvedValue([
            {
              type: ConnectorType.Social,
              metadata: { target },
              dbEntry: { id: conectorTe.id, enabled: true },
            },
          ]),
        },
        {
          users: userLibraries,
          ssoConnectors,
          // Sin esto, el camino de «dispositivo de confianza» satisface el MFA por su cuenta y la
          // prueba pasa haga lo que haga la excepción de la cartera.
          trustedDevicePolicy: {
            getEffectivePolicy: jest.fn().mockResolvedValue({ enabled: false, durationDays: 30 }),
          },
        }
      );

    /**
     * El canal por el que entró se lee del resultado de la interacción, así que el proveedor
     * simulado tiene que devolverlo. Sin él no se exime nada — y eso también es parte del contrato:
     * ante la duda, se pide el segundo factor.
     *
     * **Hay dos fases y las dos tienen que funcionar**, porque en producción sólo se llega a la
     * segunda:
     *
     *  - `'vivo'`: el estado completo, tal como está entre abrir el canal y confirmarlo.
     *  - `'confirmado'`: lo que queda **después** de `confirm`, que borra el estado para que el
     *    secreto del canal no sobreviva a su uso y deja sólo la marca del canal.
     *
     * El `submit` —que es donde corre este guard— va siempre después de `confirm`, o sea que la
     * fase real es la segunda. Probar sólo la primera daba pruebas en verde con el acceso roto:
     * pedía un segundo factor justo después de aprobarlo en el teléfono.
     */
    const conVerificacionSocial = (
      tenantDePrueba: MockTenant,
      connectorId: string,
      canal?: 'qr' | 'push',
      fase: 'vivo' | 'confirmado' = 'vivo'
    ) => {
      const interactionDetails = {
        result: {
          interactionEvent: InteractionEvent.SignIn,
          userId: mockUserWithMfaVerifications.id,
        },
      } as unknown as Interaction;
      if (canal) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (tenantDePrueba.provider as never as {
          interactionDetails: jest.Mock;
        }).interactionDetails = jest.fn().mockResolvedValue({
          result:
            fase === 'vivo'
              ? { teChannel: { canal, txnId: 't', verificationId: 'v', connectorId } }
              : { teChannelHecho: canal },
        });
      }
      const interaccion = new ExperienceInteraction(ctx, tenantDePrueba, interactionDetails);
      const social = new SocialVerification(tenantDePrueba.libraries, tenantDePrueba.queries, {
        id: 'te_verification_id',
        type: VerificationType.Social,
        connectorId,
        socialUserInfo: { id: 'te_identity_id' },
      });
      interaccion.setVerificationRecord(social);
      return interaccion;
    };

    it('aprobar por push cuenta como segundo factor', async () => {
      // Para llegar al push hubo que pasar un primer factor, así que completarlo ES ser el segundo.
      const interaccion = conVerificacionSocial(
        tenantConConector(conectorTe.target),
        conectorTe.id,
        'push'
      );

      await expect(interaccion.guardMfaVerificationStatus()).resolves.not.toThrow();
    });

    it('el QR entra solo cuando está configurado como factor único (por defecto)', async () => {
      const interaccion = conVerificacionSocial(
        tenantConConector(conectorTe.target),
        conectorTe.id,
        'qr'
      );

      await expect(interaccion.guardMfaVerificationStatus()).resolves.not.toThrow();
    });

    it('con TE_QR_SINGLE_FACTOR=false el QR ya no exime, pero el push sí', async () => {
      const previo = process.env.TE_QR_SINGLE_FACTOR;
      process.env.TE_QR_SINGLE_FACTOR = 'false';

      try {
        const conQr = conVerificacionSocial(
          tenantConConector(conectorTe.target),
          conectorTe.id,
          'qr'
        );
        await expect(conQr.guardMfaVerificationStatus()).rejects.toThrow();

        // El push no depende de esa bandera: ahí ya hubo un primer factor.
        const conPush = conVerificacionSocial(
          tenantConConector(conectorTe.target),
          conectorTe.id,
          'push'
        );
        await expect(conPush.guardMfaVerificationStatus()).resolves.not.toThrow();
      } finally {
        process.env.TE_QR_SINGLE_FACTOR = previo;
      }
    });

    /**
     * **La fase que de verdad ocurre.** `confirm` borra el estado del canal antes de que el
     * navegador llame a `submit`, así que cuando este guard corre el estado vivo ya no está. Leerlo
     * ahí encontraba siempre un hueco, el guard fallaba cerrado y el acceso pedía un segundo factor
     * **después** de haberlo aprobado en el teléfono.
     *
     * Las pruebas de arriba no lo veían porque simulaban el estado vivo, que en ese punto ya no
     * existe.
     */
    it.each(['push', 'qr'] as const)(
      'tras confirmar —con el estado ya borrado— el canal %s sigue eximiendo',
      async (canal) => {
        const interaccion = conVerificacionSocial(
          tenantConConector(conectorTe.target),
          conectorTe.id,
          canal,
          'confirmado'
        );

        await expect(interaccion.guardMfaVerificationStatus()).resolves.not.toThrow();
      }
    );

    it('tras confirmar, un conector social cualquiera sigue SIN eximir', async () => {
      // La marca sobrevive al borrado, pero no relaja la otra mitad del contrato.
      const interaccion = conVerificacionSocial(
        tenantConConector('google'),
        'otro_connector_id',
        'push',
        'confirmado'
      );

      await expect(interaccion.guardMfaVerificationStatus()).rejects.toThrow();
    });

    it('un conector social cualquiera NO exime del segundo factor', async () => {
      // Sin esta mitad, cualquier conector social del tenant sería una puerta trasera al MFA.
      const interaccion = conVerificacionSocial(
        tenantConConector('google'),
        'otro_connector_id',
        'qr'
      );

      await expect(interaccion.guardMfaVerificationStatus()).rejects.toThrow();
    });
  });
});

/* eslint-enable max-lines */
