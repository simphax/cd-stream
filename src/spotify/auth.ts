/**
 * Spotify Authorization Code flow with PKCE — runs entirely in the browser,
 * no client secret or backend required.
 */

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-library-read',
  'user-top-read',
  'user-read-recently-played',
  'user-read-playback-state',
  'user-modify-playback-state',
];

const LS = {
  clientId: 'cdstream.clientId',
  token: 'cdstream.token',
  verifier: 'cdstream.pkceVerifier',
  state: 'cdstream.pkceState',
};

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope: string;
}

export function getClientId(): string | null {
  const fromEnv = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  return localStorage.getItem(LS.clientId);
}

export function hasBuiltInClientId() {
  return Boolean((import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim());
}

export function setClientId(id: string) {
  localStorage.setItem(LS.clientId, id.trim());
}

export function redirectUri() {
  const { origin, pathname } = window.location;
  return origin + pathname;
}

function randomString(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Missing Spotify Client ID');
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(LS.verifier, verifier);
  localStorage.setItem(LS.state, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

function store(json: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }) {
  const prev = readToken();
  const token: StoredToken = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? prev?.refreshToken ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? prev?.scope ?? '',
  };
  localStorage.setItem(LS.token, JSON.stringify(token));
  return token;
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(LS.token);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

/** Completes the redirect leg of the flow if the URL carries ?code=… */
export async function handleRedirect(): Promise<void> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  if (!code && !error) return;

  // Clean the URL regardless of the outcome.
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);

  if (error) throw new Error(error === 'access_denied' ? 'Spotify login was cancelled.' : `Spotify login failed: ${error}`);

  const verifier = localStorage.getItem(LS.verifier);
  const expectedState = localStorage.getItem(LS.state);
  localStorage.removeItem(LS.verifier);
  localStorage.removeItem(LS.state);
  if (!verifier || state !== expectedState) throw new Error('Login session expired — please try again.');

  const clientId = getClientId();
  if (!clientId) throw new Error('Missing Spotify Client ID');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  store(await res.json());
}

let refreshing: Promise<StoredToken | null> | null = null;

async function refresh(token: StoredToken): Promise<StoredToken | null> {
  const clientId = getClientId();
  if (!clientId || !token.refreshToken) return null;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) logout();
    return null;
  }
  return store(await res.json());
}

export function isLoggedIn() {
  return Boolean(readToken()?.refreshToken || readToken()?.accessToken);
}

/** Returns a valid access token, refreshing it when close to expiry. */
export async function getAccessToken(force = false): Promise<string> {
  const token = readToken();
  if (!token) throw new Error('Not logged in');
  if (!force && token.expiresAt - Date.now() > 60_000) return token.accessToken;
  refreshing ??= refresh(token).finally(() => (refreshing = null));
  const next = await refreshing;
  if (!next) throw new Error('Spotify session expired — please log in again.');
  return next.accessToken;
}

export function logout() {
  localStorage.removeItem(LS.token);
}
