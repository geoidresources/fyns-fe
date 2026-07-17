import Cookies from "js-cookie";

// Single source of truth for the shared JWT used by both API clients
// (user-svc + asset-svc). The token lives in localStorage (primary) and is
// mirrored into a cookie for backwards compatibility with components that
// still read `Cookies.get("token")`.

const TOKEN_KEY = "token";
const USER_KEY = "user";
const CLIENT_KEY = "client";
const EXPIRE_KEY = "expire_at";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  client_id: string;
}

export interface AuthClient {
  id: string;
  name: string;
  company_name?: string;
  email?: string;
  domain?: string;
}

export interface Session {
  token: string;
  expire_at: number; // unix seconds
  user: AuthUser;
  client: AuthClient;
}

const isBrowser = typeof window !== "undefined";

// "Remember me" persists to localStorage; otherwise the session lives in
// sessionStorage and dies with the tab. Reads check sessionStorage first so an
// active session always shadows a stale persistent one.
function readItem(key: string): string | null {
  if (!isBrowser) return null;
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

export function getToken(): string | null {
  if (!isBrowser) return null;
  const token = readItem(TOKEN_KEY) || Cookies.get(TOKEN_KEY) || null;
  if (!token) return null;
  // Treat an expired token as absent so callers redirect to sign-in instead of
  // firing a request that's guaranteed to 401.
  const expRaw = readItem(EXPIRE_KEY);
  if (expRaw) {
    const exp = Number(expRaw);
    if (Number.isFinite(exp) && exp > 0 && Date.now() >= exp * 1000) return null;
  }
  return token;
}

export function getUser(): AuthUser | null {
  try {
    const raw = readItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function getClient(): AuthClient | null {
  try {
    const raw = readItem(CLIENT_KEY);
    return raw ? (JSON.parse(raw) as AuthClient) : null;
  } catch {
    return null;
  }
}

// Raw (unparsed) reads — for callers driving `useSyncExternalStore`, which
// needs a snapshot that's referentially stable when unchanged. Strings compare
// by value, so two reads of the same stored JSON are `Object.is`-equal; a
// freshly `JSON.parse`d object (getUser/getClient above) never would be, which
// would make React treat every render as a store change.
export function getUserRaw(): string | null {
  return readItem(USER_KEY);
}
export function getClientRaw(): string | null {
  return readItem(CLIENT_KEY);
}

export function setSession(session: Session, remember = false) {
  if (!isBrowser) return;
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  // Clear the other store so toggling "remember me" between logins never
  // leaves a stale token behind in the store we're not using.
  for (const key of [TOKEN_KEY, USER_KEY, CLIENT_KEY, EXPIRE_KEY]) other.removeItem(key);
  store.setItem(TOKEN_KEY, session.token);
  store.setItem(USER_KEY, JSON.stringify(session.user));
  store.setItem(CLIENT_KEY, JSON.stringify(session.client));
  store.setItem(EXPIRE_KEY, String(session.expire_at));
  // secure only over HTTPS (keeps LAN-IP/localhost dev working); sameSite=lax,
  // NOT strict — strict drops the cookie on top-level navigations from external
  // links, which would break returning to the app from an email/bookmark.
  const attrs = { secure: window.location.protocol === "https:", sameSite: "lax" as const };
  Cookies.set(
    TOKEN_KEY,
    session.token,
    remember ? { ...attrs, expires: new Date(session.expire_at * 1000) } : attrs
  );
}

export function clearSession() {
  if (!isBrowser) return;
  for (const store of [localStorage, sessionStorage]) {
    for (const key of [TOKEN_KEY, USER_KEY, CLIENT_KEY, EXPIRE_KEY]) store.removeItem(key);
  }
  Cookies.remove(TOKEN_KEY);
}

/** Clears the session and sends the user to sign-in, preserving where they were
 * so the sign-in form can bounce them back after re-authenticating. */
export function redirectToSignIn() {
  clearSession();
  if (isBrowser && !window.location.pathname.startsWith("/sign-in")) {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/sign-in?next=${encodeURIComponent(next)}`;
  }
}
