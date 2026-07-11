/**
 * Google OAuth 2.0 server-side web flow for Search Console (read-only).
 * fetch is injected so everything is unit-testable without the network.
 */

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(
  config: Pick<OAuthConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `${GSC_SCOPE} email`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenGrant {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

async function tokenRequest(
  fetchImpl: FetchLike,
  body: Record<string, string>,
): Promise<TokenGrant> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    // Never include the request body (credentials) in errors or logs.
    throw new Error(`Google token endpoint returned ${response.status}`);
  }
  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in,
  };
}

export function exchangeCode(
  fetchImpl: FetchLike,
  config: OAuthConfig,
  code: string,
): Promise<TokenGrant> {
  return tokenRequest(fetchImpl, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(
  fetchImpl: FetchLike,
  config: Pick<OAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
): Promise<TokenGrant> {
  return tokenRequest(fetchImpl, {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
}
