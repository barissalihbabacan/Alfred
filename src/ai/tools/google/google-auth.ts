/**
 * Google Calendar & Tasks Integration Service
 * 
 * Handles OAuth2 token persistence, auto-refresh with client_secret,
 * and direct REST API calls to Google Calendar and Tasks APIs.
 */

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp in ms
  scope?: string;
}

export interface GoogleIntegrationStatus {
  connected: boolean;
  email?: string;
  scope?: string;
  connectedAt?: string;
  updatedAt?: string;
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/userinfo.email"
].join(" ");

export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent", // Ensures we get a refresh_token on initial connection
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}> {
  const fetcher = params.fetchFn || fetch;
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code"
  });

  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as Record<string, any>;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
    scope: data.scope
  };
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
}): Promise<{
  accessToken: string;
  expiresIn: number;
  scope?: string;
}> {
  const fetcher = params.fetchFn || fetch;
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token"
  });

  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as Record<string, any>;
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    scope: data.scope
  };
}

export async function fetchGoogleUserEmail(accessToken: string, fetchFn?: typeof fetch): Promise<string | null> {
  const fetcher = fetchFn || fetch;
  try {
    const res = await fetcher("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, any>;
    return typeof data.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}
