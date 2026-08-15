---
"@logto/connector-oauth": minor
---

add optional PKCE support to the OAuth 2.0 standard connector

The OAuth 2.0 connector can now protect the authorization code flow with PKCE ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)) using the `S256` code challenge method. When the new **Enable PKCE** option (`enablePkce`) is on, the connector generates a cryptographically random `code_verifier` for every authorization request, keeps it in the connector session, sends its SHA-256 challenge as `code_challenge` / `code_challenge_method=S256` in the authorization request, and sends the verifier back as `code_verifier` in the token request, so an intercepted authorization code can not be redeemed.

The option is disabled by default: the authorization request otherwise carries parameters that some OAuth 2.0 providers reject, and existing connectors must keep working untouched. Turning it on requires an identity provider that supports PKCE.
