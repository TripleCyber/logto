import nock from 'nock';

import { ConnectorError } from '@logto/connector-kit';

import { mockConfig } from './mock.js';
import { codeVerifierGuard } from './types.js';
import { generateCodeChallenge, generateCodeVerifier } from './utils.js';

const getConfig = vi.fn().mockResolvedValue(mockConfig);
const getConfigWithPkce = vi.fn().mockResolvedValue({ ...mockConfig, enablePkce: true });

const { default: createConnector } = await import('./index.js');

const redirectUri = 'http://localhost:3001/callback';

const authorizationUriPayload = {
  state: 'some_state',
  redirectUri,
  connectorId: 'some_connector_id',
  connectorFactoryId: 'some_connector_factory_id',
  jti: 'some_jti',
  headers: {},
};

/**
 * The token endpoint is requested with an `application/x-www-form-urlencoded` body, which nock
 * hands over already parsed. Normalize it so the assertions do not depend on that detail.
 */
const parseFormBody = (body: unknown): Record<string, unknown> =>
  typeof body === 'string'
    ? Object.fromEntries(new URLSearchParams(body))
    : { ...(body as Record<string, unknown>) };

/**
 * Intercepts the token endpoint and hands the parsed request body over to `onRequestBody`,
 * so that the token exchange parameters can be asserted.
 */
const mockTokenEndpoint = (onRequestBody?: (body: Record<string, unknown>) => void) => {
  const tokenEndpointUrl = new URL(mockConfig.tokenEndpoint);
  nock(tokenEndpointUrl.origin)
    .post(tokenEndpointUrl.pathname, (body: unknown) => {
      onRequestBody?.(parseFormBody(body));
      return true;
    })
    .query(true)
    .reply(
      200,
      JSON.stringify({
        access_token: 'access_token',
        token_type: 'bearer',
      })
    );
};

const mockUserInfoEndpoint = (userId: string) => {
  const userInfoEndpointUrl = new URL(mockConfig.userInfoEndpoint);
  nock(userInfoEndpointUrl.origin).get(userInfoEndpointUrl.pathname).query(true).reply(200, {
    sub: userId,
    foo: 'bar',
  });
};

describe('getAuthorizationUri', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should get a valid uri by redirectUri and state', async () => {
    const connector = await createConnector({ getConfig });
    const setSession = vi.fn();
    const authorizationUri = await connector.getAuthorizationUri(
      authorizationUriPayload,
      setSession
    );

    const { origin, pathname, searchParams } = new URL(authorizationUri);
    expect(origin + pathname).toEqual(mockConfig.authorizationEndpoint);
    expect(searchParams.get('client_id')).toEqual(mockConfig.clientId);
    expect(searchParams.get('redirect_uri')).toEqual('http://localhost:3001/callback');
    expect(searchParams.get('state')).toEqual('some_state');
    expect(searchParams.get('response_type')).toEqual('code');
  });

  it('should get a valid uri with custom scope', async () => {
    const connector = await createConnector({ getConfig });
    const setSession = vi.fn();
    const authorizationUri = await connector.getAuthorizationUri(
      {
        ...authorizationUriPayload,
        scope: 'custom_scope',
      },
      setSession
    );

    const { origin, pathname, searchParams } = new URL(authorizationUri);
    expect(origin + pathname).toEqual(mockConfig.authorizationEndpoint);
    expect(searchParams.get('client_id')).toEqual(mockConfig.clientId);
    expect(searchParams.get('redirect_uri')).toEqual('http://localhost:3001/callback');
    expect(searchParams.get('state')).toEqual('some_state');
    expect(searchParams.get('response_type')).toEqual('code');
    expect(searchParams.get('scope')).toEqual('custom_scope');
  });

  /**
   * Guards every connector that does not opt in to PKCE: the authorization URI and the connector
   * session must stay exactly what they were before PKCE support was added, since some OAuth 2.0
   * providers reject authorization requests carrying unknown parameters.
   */
  it('should not touch the authorization uri nor the session when PKCE is disabled', async () => {
    const connector = await createConnector({ getConfig });
    const setSession = vi.fn();
    const authorizationUri = await connector.getAuthorizationUri(
      authorizationUriPayload,
      setSession
    );

    expect(authorizationUri).toEqual(
      'http://authorization.endpoint.io/auth?response_type=code&client_id=client-id&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fcallback&state=some_state'
    );
    expect(setSession).toHaveBeenCalledWith({ redirectUri });
  });

  it('should add an `S256` code challenge and store the verifier when PKCE is enabled', async () => {
    const connector = await createConnector({ getConfig: getConfigWithPkce });
    const setSession = vi.fn();
    const authorizationUri = await connector.getAuthorizationUri(
      authorizationUriPayload,
      setSession
    );

    const { origin, pathname, searchParams } = new URL(authorizationUri);
    expect(origin + pathname).toEqual(mockConfig.authorizationEndpoint);
    expect(searchParams.get('state')).toEqual('some_state');
    expect(searchParams.get('code_challenge_method')).toEqual('S256');

    // The verifier survives the connector session round-trip and matches the published challenge.
    const session = setSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(session.redirectUri).toEqual(redirectUri);
    const { success, data: codeVerifier } = codeVerifierGuard.safeParse(session.codeVerifier);
    expect(success).toBe(true);
    expect(generateCodeChallenge(codeVerifier!)).toEqual(searchParams.get('code_challenge'));
  });

  it('should generate a new code verifier on every authorization request', async () => {
    const connector = await createConnector({ getConfig: getConfigWithPkce });
    const setSession = vi.fn();
    await connector.getAuthorizationUri(authorizationUriPayload, setSession);
    await connector.getAuthorizationUri(authorizationUriPayload, setSession);

    const [first, second] = setSession.mock.calls.map(
      ([session]) => (session as Record<string, unknown>).codeVerifier
    );
    expect(first).not.toEqual(second);
  });
});

describe('getUserInfo', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('should get valid userInfo', async () => {
    const userId = 'userId';
    mockTokenEndpoint();
    mockUserInfoEndpoint(userId);
    const connector = await createConnector({ getConfig });
    const userInfo = await connector.getUserInfo(
      { code: 'code' },
      vi.fn().mockImplementationOnce(() => {
        return { redirectUri };
      })
    );
    expect(userInfo).toStrictEqual({ id: userId, rawData: { sub: userId, foo: 'bar' } });
  });

  it('should not send a code verifier when PKCE is disabled', async () => {
    const onRequestBody = vi.fn<(body: Record<string, unknown>) => void>();
    mockTokenEndpoint(onRequestBody);
    mockUserInfoEndpoint('userId');
    const connector = await createConnector({ getConfig });
    await connector.getUserInfo(
      { code: 'code' },
      // A verifier left over in the session by a previously enabled PKCE must not leak out.
      vi.fn().mockResolvedValue({ redirectUri, codeVerifier: generateCodeVerifier() })
    );

    expect(onRequestBody).toHaveBeenCalledTimes(1);
    expect(onRequestBody.mock.calls[0]?.[0]).not.toHaveProperty('code_verifier');
  });

  it('should send the code verifier of the session when PKCE is enabled', async () => {
    const codeVerifier = generateCodeVerifier();
    const onRequestBody = vi.fn<(body: Record<string, unknown>) => void>();
    mockTokenEndpoint(onRequestBody);
    mockUserInfoEndpoint('userId');
    const connector = await createConnector({ getConfig: getConfigWithPkce });
    await connector.getUserInfo(
      { code: 'code' },
      vi.fn().mockResolvedValue({ redirectUri, codeVerifier })
    );

    expect(onRequestBody.mock.calls[0]?.[0]).toMatchObject({
      code: 'code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
  });

  it('should throw when PKCE is enabled but the session has no code verifier', async () => {
    const connector = await createConnector({ getConfig: getConfigWithPkce });
    await expect(
      connector.getUserInfo({ code: 'code' }, vi.fn().mockResolvedValue({ redirectUri }))
    ).rejects.toThrowError(ConnectorError);
  });

  it('should throw when the session has an invalid code verifier', async () => {
    const connector = await createConnector({ getConfig: getConfigWithPkce });
    await expect(
      connector.getUserInfo(
        { code: 'code' },
        vi.fn().mockResolvedValue({ redirectUri, codeVerifier: 'too-short' })
      )
    ).rejects.toThrowError(ConnectorError);
  });
});

describe('getTokenResponseAndUserInfo', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('should send the code verifier of the session when PKCE is enabled', async () => {
    const codeVerifier = generateCodeVerifier();
    const onRequestBody = vi.fn<(body: Record<string, unknown>) => void>();
    mockTokenEndpoint(onRequestBody);
    mockUserInfoEndpoint('userId');

    const connector = await createConnector({ getConfig: getConfigWithPkce });
    const { userInfo } = await connector.getTokenResponseAndUserInfo!(
      { code: 'code' },
      vi.fn().mockResolvedValue({ redirectUri, codeVerifier })
    );

    expect(userInfo).toMatchObject({ id: 'userId' });
    expect(onRequestBody.mock.calls[0]?.[0]).toMatchObject({ code_verifier: codeVerifier });
  });

  it('should throw when PKCE is enabled but the session has no code verifier', async () => {
    const connector = await createConnector({ getConfig: getConfigWithPkce });
    await expect(
      connector.getTokenResponseAndUserInfo!(
        { code: 'code' },
        vi.fn().mockResolvedValue({ redirectUri })
      )
    ).rejects.toThrowError(ConnectorError);
  });
});
