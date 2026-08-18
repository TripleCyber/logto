import { ConnectorType, GoogleConnector } from '@logto/connector-kit';
import { createMockUtils } from '@logto/shared/esm';

import { mockConnector } from '#src/__mocks__/connector.js';
import RequestError from '#src/errors/RequestError/index.js';
import type { WithLogContext } from '#src/middleware/koa-audit-log.js';
import type Queries from '#src/tenants/Queries.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import createMockContext from '#src/test-utils/jest-koa-mocks/create-mock-context.js';
import { createMockLogContext } from '#src/test-utils/koa-audit-log.js';
import { MockTenant } from '#src/test-utils/tenant.js';

const { jest } = import.meta;
const { mockEsm, mockEsmWithActual } = createMockUtils(jest);

const isExternalGoogleOneTap = jest.fn().mockReturnValue(false);

await mockEsmWithActual('@logto/connector-kit', () => ({
  isExternalGoogleOneTap,
}));

const getUserInfo = jest.fn().mockResolvedValue({ id: 'foo' });
const getConnector = jest.fn().mockResolvedValue(mockConnector);

const tenant = new MockTenant(undefined, undefined, undefined, {
  socials: { getUserInfo, getConnector },
});

mockEsm('#src/libraries/connector.js', () => ({
  getLogtoConnectorById: jest.fn().mockResolvedValue({
    metadata: {
      id: 'social',
    },
    type: ConnectorType.Social,
    getAuthorizationUri: jest.fn(async () => ''),
  }),
}));

const { verifySocialIdentity, createSocialAuthorizationUrl, assertSocialSignInConnectorEnabled } =
  await import('./social-verification.js');

const socialConnectorId = 'mock-social-connector-id';
const socialConnectorTarget = 'mock-social';
const socialAuthorizationUri = 'https://social.example.com/authorize?state=state';
const socialAuthorizationUrlPayload = {
  connectorId: socialConnectorId,
  state: 'state',
  redirectUri: 'https://logto.example.com/callback',
};

const buildSocialConnector = () => ({
  type: ConnectorType.Social,
  metadata: { id: 'mock-social-factory-id', target: socialConnectorTarget },
  dbEntry: { id: socialConnectorId },
  getAuthorizationUri: jest.fn(async () => socialAuthorizationUri),
});

const buildQueries = (socialSignInConnectorTargets: string[]) =>
  ({
    signInExperiences: {
      findDefaultSignInExperience: jest.fn(async () => ({ socialSignInConnectorTargets })),
    },
  }) as unknown as Queries;

/**
 * A tenant context whose sign-in experience enables `socialSignInConnectorTargets`, and whose
 * connector library only knows about `socialConnectorId` when a `connector` is given.
 */
const buildSocialTenantContext = ({
  socialSignInConnectorTargets,
  connector,
}: {
  socialSignInConnectorTargets: string[];
  connector?: ReturnType<typeof buildSocialConnector>;
}) => {
  const queries = buildQueries(socialSignInConnectorTargets);
  const getLogtoConnectorById = jest.fn(async (id: string) => {
    if (!connector) {
      throw new RequestError({ code: 'entity.not_found', id, status: 404 });
    }

    return connector;
  });

  const tenantContext = {
    provider: {
      interactionDetails: jest.fn(async () => ({ jti: 'mock-jti' })),
      interactionResult: jest.fn(),
    },
    connectors: { getLogtoConnectorById },
    queries,
  } as unknown as TenantContext;

  return {
    tenantContext,
    findDefaultSignInExperience: queries.signInExperiences.findDefaultSignInExperience,
  };
};

const buildSocialContext = () =>
  ({
    ...createMockContext(),
    ...createMockLogContext(),
  }) as unknown as WithLogContext;

const catchRequestError = async (promise: Promise<unknown>): Promise<RequestError> => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected the promise to reject with a RequestError.');
};

describe('assertSocialSignInConnectorEnabled', () => {
  it('should resolve when the connector target is enabled', async () => {
    await expect(
      assertSocialSignInConnectorEnabled(
        buildQueries([socialConnectorTarget]),
        buildSocialConnector()
      )
    ).resolves.toBeUndefined();
  });

  it('should reject when the connector target is not enabled', async () => {
    const error = await catchRequestError(
      assertSocialSignInConnectorEnabled(buildQueries([]), buildSocialConnector())
    );

    expect(error).toMatchObject({ code: 'entity.not_found', status: 404 });
  });
});

describe('createSocialAuthorizationUrl', () => {
  it('should return the authorization URI when the connector is enabled in the sign-in experience', async () => {
    const connector = buildSocialConnector();
    const { tenantContext } = buildSocialTenantContext({
      socialSignInConnectorTargets: [socialConnectorTarget],
      connector,
    });

    await expect(
      createSocialAuthorizationUrl(
        buildSocialContext(),
        tenantContext,
        socialAuthorizationUrlPayload
      )
    ).resolves.toBe(socialAuthorizationUri);
    expect(connector.getAuthorizationUri).toHaveBeenCalled();
  });

  it('should reject when the connector is not in the sign-in experience social targets', async () => {
    const connector = buildSocialConnector();
    const { tenantContext } = buildSocialTenantContext({
      socialSignInConnectorTargets: [],
      connector,
    });

    const error = await catchRequestError(
      createSocialAuthorizationUrl(
        buildSocialContext(),
        tenantContext,
        socialAuthorizationUrlPayload
      )
    );

    expect(error).toMatchObject({ code: 'entity.not_found', status: 404 });
    expect(connector.getAuthorizationUri).not.toHaveBeenCalled();
  });

  it('should reject a disabled connector exactly like a non-existent one', async () => {
    const disabled = buildSocialTenantContext({
      socialSignInConnectorTargets: ['some-other-target'],
      connector: buildSocialConnector(),
    });
    // Same requested `connectorId`, but this tenant has no such connector at all.
    const nonExistent = buildSocialTenantContext({
      socialSignInConnectorTargets: [socialConnectorTarget],
    });

    const disabledError = await catchRequestError(
      createSocialAuthorizationUrl(
        buildSocialContext(),
        disabled.tenantContext,
        socialAuthorizationUrlPayload
      )
    );
    const nonExistentError = await catchRequestError(
      createSocialAuthorizationUrl(
        buildSocialContext(),
        nonExistent.tenantContext,
        socialAuthorizationUrlPayload
      )
    );

    // The response must not tell the two apart, or the endpoint becomes a connector oracle.
    expect({
      code: disabledError.code,
      status: disabledError.status,
      message: disabledError.message,
    }).toEqual({
      code: nonExistentError.code,
      status: nonExistentError.status,
      message: nonExistentError.message,
    });
  });

  it('should reject a non-social connector before consulting the sign-in experience', async () => {
    const connector = { ...buildSocialConnector(), type: ConnectorType.Sms };
    const { tenantContext, findDefaultSignInExperience } = buildSocialTenantContext({
      socialSignInConnectorTargets: [socialConnectorTarget],
      connector,
    });

    const error = await catchRequestError(
      createSocialAuthorizationUrl(
        buildSocialContext(),
        tenantContext,
        socialAuthorizationUrlPayload
      )
    );

    expect(error).toMatchObject({ code: 'connector.unexpected_type' });
    expect(findDefaultSignInExperience).not.toHaveBeenCalled();
  });
});

describe('verifySocialIdentity', () => {
  it('should verify social identity', async () => {
    // @ts-expect-error test mock context
    const ctx: WithLogContext = {
      ...createMockContext(),
      ...createMockLogContext(),
    };
    const connectorId = 'connector';
    const connectorData = { authCode: 'code' };
    const userInfo = await verifySocialIdentity({ connectorId, connectorData }, ctx, tenant);

    expect(getUserInfo).toBeCalledWith(connectorId, connectorData, expect.anything());
    expect(userInfo).toEqual({ id: 'foo' });
  });

  it('should throw error if csrf token is not matched for Google One Tap verification', async () => {
    const ctx: WithLogContext = {
      ...createMockContext(),
      ...createMockLogContext(),
      // @ts-expect-error test mock context
      cookies: { get: jest.fn().mockReturnValue('token') },
    };

    getConnector.mockResolvedValueOnce({
      ...mockConnector,
      metadata: {
        ...mockConnector.metadata,
        id: GoogleConnector.factoryId,
      },
    });
    const connectorData = {
      [GoogleConnector.oneTapParams.credential]: 'credential',
      [GoogleConnector.oneTapParams.csrfToken]: 'mismatched_token',
    };

    await expect(
      verifySocialIdentity({ connectorId: 'google', connectorData }, ctx, tenant)
    ).rejects.toThrow('CSRF token mismatch.');
  });

  it('should verify Google One Tap verification', async () => {
    const ctx: WithLogContext = {
      ...createMockContext(),
      ...createMockLogContext(),
      // @ts-expect-error test mock context
      cookies: { get: jest.fn().mockReturnValue('token') },
    };
    const connectorId = GoogleConnector.factoryId;
    const connectorData = {
      [GoogleConnector.oneTapParams.credential]: 'credential',
      [GoogleConnector.oneTapParams.csrfToken]: 'token',
    };

    await expect(
      verifySocialIdentity({ connectorId, connectorData }, ctx, tenant)
    ).resolves.toEqual({ id: 'foo' });
  });

  it('should skip CSRF token validation for external website Google One Tap', async () => {
    const ctx: WithLogContext = {
      ...createMockContext(),
      ...createMockLogContext(),
      // @ts-expect-error test mock context
      cookies: {
        get: jest.fn().mockImplementation((key) => {
          // For external Google One Tap, return the credential value for the logto cookie
          if (key === '_logto_google_one_tap_credential') {
            return 'credential';
          }
          return 'different_token';
        }),
      },
    };

    getConnector.mockResolvedValueOnce({
      ...mockConnector,
      metadata: {
        ...mockConnector.metadata,
        id: GoogleConnector.factoryId,
      },
    });

    // Mock isExternalGoogleOneTap to return true
    isExternalGoogleOneTap.mockReturnValueOnce(true);

    const connectorData = {
      [GoogleConnector.oneTapParams.credential]: 'credential',
      [GoogleConnector.oneTapParams.csrfToken]: 'mismatched_token',
    };

    // Should not throw CSRF mismatch error for external website Google One Tap
    await expect(
      verifySocialIdentity({ connectorId: 'google', connectorData }, ctx, tenant)
    ).resolves.toEqual({ id: 'foo' });

    expect(isExternalGoogleOneTap).toHaveBeenCalledWith(connectorData);
  });

  it('should enforce CSRF token validation for regular Google One Tap', async () => {
    const ctx: WithLogContext = {
      ...createMockContext(),
      ...createMockLogContext(),
      // @ts-expect-error test mock context
      cookies: { get: jest.fn().mockReturnValue('different_token') },
    };

    getConnector.mockResolvedValueOnce({
      ...mockConnector,
      metadata: {
        ...mockConnector.metadata,
        id: GoogleConnector.factoryId,
      },
    });

    // Mock isExternalGoogleOneTap to return false (regular Google One Tap)
    isExternalGoogleOneTap.mockReturnValueOnce(false);

    const connectorData = {
      [GoogleConnector.oneTapParams.credential]: 'credential',
      [GoogleConnector.oneTapParams.csrfToken]: 'mismatched_token',
    };

    // Should throw CSRF mismatch error for regular Google One Tap
    await expect(
      verifySocialIdentity({ connectorId: 'google', connectorData }, ctx, tenant)
    ).rejects.toThrow('CSRF token mismatch.');

    expect(isExternalGoogleOneTap).toHaveBeenCalledWith(connectorData);
  });
});
