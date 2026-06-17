import Cookies from "js-cookie";

// Single source of truth for the shared JWT used by both API clients
// (user-svc + asset-svc). The token lives in localStorage (primary) and is
// mirrored into a cookie for backwards compatibility with components that
// still read `Cookies.get("token")`.

const TOKEN_KEY = "token";
const USER_KEY = "user";
const CLIENT_KEY = "client";

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

export function getToken(): string | null {
  if (!isBrowser) return null;
  return localStorage.getItem(TOKEN_KEY) || Cookies.get(TOKEN_KEY) || null;
}

export function getUser(): AuthUser | null {
  if (!isBrowser) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function getClient(): AuthClient | null {
  if (!isBrowser) return null;
  try {
    const raw = localStorage.getItem(CLIENT_KEY);
    return raw ? (JSON.parse(raw) as AuthClient) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session, remember = false) {
  if (!isBrowser) return;
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  localStorage.setItem(CLIENT_KEY, JSON.stringify(session.client));
  if (remember) {
    Cookies.set(TOKEN_KEY, session.token, { expires: new Date(session.expire_at * 1000) });
  } else {
    Cookies.set(TOKEN_KEY, session.token); // session cookie
  }
}

export function clearSession() {
  if (!isBrowser) return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(CLIENT_KEY);
  Cookies.remove(TOKEN_KEY);
}

/** Clears the session and sends the user to the sign-in page. */
export function redirectToSignIn() {
  clearSession();
  if (isBrowser && window.location.pathname !== "/sign-in") {
    window.location.href = "/sign-in";
  }
}
