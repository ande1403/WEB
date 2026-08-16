import type { Env } from '../types';

/**
 * OAuth2 refresh-token flow pro účet ande1403.batumi@gmail.com.
 * Access token se cachuje v paměti isolate (žije typicky minuty až desítky minut),
 * takže běžný běh cronu si o token řekne nejvýš jednou.
 */

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cache: CachedToken | null = null;

/** Jen pro testy. */
export function _resetTokenCache(): void {
  cache = null;
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
];

export async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) return cache.token;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'Chybí Google OAuth secrets (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN).'
    );
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    // invalid_grant = token odvolán, vypršel (aplikace v režimu Testing má 7 dní),
    // nebo se změnilo heslo účtu. Vyžaduje nový consent, ne retry.
    throw new Error(`Google OAuth selhal (${res.status}): ${text}`);
  }

  const data = JSON.parse(text) as { access_token: string; expires_in: number };
  cache = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
  return cache.token;
}

/** Volání Google API s automatickým tokenem a srozumitelnou chybou. */
export async function googleFetch(
  env: Env,
  url: string,
  init: RequestInit = {},
  retryOnAuthError = true
): Promise<any> {
  const token = await getAccessToken(env);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const res = await fetch(url, { ...init, headers });

  if (res.status === 401 && retryOnAuthError) {
    cache = null;
    return googleFetch(env, url, init, false);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google API ${init.method ?? 'GET'} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}
