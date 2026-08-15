import { z } from 'zod';

import { connectorSessionGuard } from '@logto/connector-kit';

import { oauth2ConfigGuard } from './oauth2/types.js';

export const profileMapGuard = z
  .object({
    id: z.string().optional().default('id'),
    email: z.string().optional().default('email'),
    phone: z.string().optional().default('phone'),
    name: z.string().optional().default('name'),
    avatar: z.string().optional().default('avatar'),
  })
  .optional()
  .default({
    id: 'id',
    email: 'email',
    phone: 'phone',
    name: 'name',
    avatar: 'avatar',
  });

export type ProfileMap = z.infer<typeof profileMapGuard>;

export const userProfileGuard = z.object({
  id: z.string().or(z.number()).transform(String),
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  avatar: z.string().optional(),
});

export type UserProfile = z.infer<typeof userProfileGuard>;

const tokenEndpointResponseTypeGuard = z
  .enum(['query-string', 'json'])
  .optional()
  .default('query-string');

export type TokenEndpointResponseType = z.input<typeof tokenEndpointResponseTypeGuard>;

export const oauth2ConnectorConfigGuard = oauth2ConfigGuard.extend({
  userInfoEndpoint: z.string(),
  tokenEndpointResponseType: tokenEndpointResponseTypeGuard,
  profileMap: profileMapGuard,
  customConfig: z.record(z.string()).optional(),
  /**
   * LOGTO PATCH(oauth2-pkce): opt-in switch for PKCE (RFC 7636) with the `S256` challenge method.
   * Upstream assumes the plain authorization code flow, so an intercepted code can be redeemed
   * by anyone holding the client credentials. Off by default because PKCE adds two parameters to
   * the authorization request and some OAuth 2.0 providers reject requests carrying parameters
   * they do not know, which would break already-working connectors.
   *
   * Upstream: (no such option; a code challenge is never sent)
   */
  enablePkce: z.boolean().optional().default(false),
});

export type Oauth2ConnectorConfig = z.infer<typeof oauth2ConnectorConfigGuard>;

/**
 * The PKCE code verifier as defined in RFC 7636, section 4.1: a high-entropy cryptographic
 * random string using the unreserved characters `[A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"`,
 * with a minimum length of 43 characters and a maximum length of 128 characters.
 */
export const codeVerifierGuard = z.string().regex(/^[\w.~-]{43,128}$/);

/**
 * The connector session of the OAuth 2.0 connector. It is stored in the interaction payload
 * between `getAuthorizationUri` and the token exchange, hence the keys have to survive a
 * JSON round-trip. Inherits the `catchall` of the base guard, so unknown keys are preserved.
 */
export const oauth2ConnectorSessionGuard = connectorSessionGuard.extend({
  codeVerifier: codeVerifierGuard.optional(),
});

export type Oauth2ConnectorSession = z.infer<typeof oauth2ConnectorSessionGuard>;
