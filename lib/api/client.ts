import { getToken, redirectToSignIn } from "@/lib/auth";

// Shared fetch core for the frontend API split: user-svc (identity + projects)
// and asset-svc (surveys, manifest, measurements) are separate services that
// share one Bearer JWT.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Resolve a service base URL from its NEXT_PUBLIC_* env var. The localhost
 * fallback is a dev convenience only — in a production build the var is
 * required, and its absence throws loudly rather than shipping an app that
 * silently points every request at localhost (a guaranteed connection refused).
 */
export function resolveServiceBase(
  envValue: string | undefined,
  suffix: string,
  varName: string,
  devFallbackOrigin: string
): string {
  const origin = (envValue || "").trim();
  if (origin) return origin.replace(/\/+$/, "") + suffix;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${varName} is not set — it is required for production builds`);
  }
  return devFallbackOrigin + suffix;
}

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip the Authorization header (e.g. login). */
  noAuth?: boolean;
  /** Caller-supplied cancellation; defaults to a 30s timeout when omitted. */
  signal?: AbortSignal;
}

// Per-attempt cap. A hung backend must never leave the request pending forever
// (spinner stuck); with the transient-retry below, a shorter per-attempt budget
// surfaces a bad attempt sooner instead of blocking the whole load on one slow call.
const DEFAULT_TIMEOUT_MS = 20_000;
// Transient blips (a rolling backend restart, a dropped connection) self-heal on
// idempotent reads. Small linear backoff; POST/PATCH/DELETE never auto-retry.
const MAX_GET_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Worth retrying an idempotent request: a raw network failure (TypeError
 * "Failed to fetch"), a request timeout (408), or a 5xx. NOT 4xx (auth,
 * validation, not-found) — those are deterministic and must surface at once. */
function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 408 || err.status >= 500;
  return true; // a non-ApiError escaping apiFetchOnce is a fetch/network error
}

export async function apiFetch<T>(baseUrl: string, path: string, opts: ApiFetchOptions = {}): Promise<T> {
  // Only idempotent GETs auto-retry (retrying a POST could double-submit); a
  // caller-supplied signal means the caller owns cancellation, so don't retry.
  const retries = (opts.method ?? "GET") === "GET" && !opts.signal ? MAX_GET_RETRIES : 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await apiFetchOnce<T>(baseUrl, path, opts);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isTransient(err)) throw err;
      await sleep(RETRY_BACKOFF_MS * (attempt + 1)); // 250ms, 500ms
    }
  }
  throw lastErr;
}

async function apiFetchOnce<T>(baseUrl: string, path: string, opts: ApiFetchOptions): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (!opts.noAuth) {
    const token = getToken();
    if (!token) {
      redirectToSignIn();
      throw new ApiError(401, "Not signed in");
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  // A caller-supplied signal takes precedence; otherwise each attempt gets its
  // own fresh timeout signal.
  const signal = opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError(408, "Request timed out");
    }
    throw err;
  }

  if (res.status === 401 && !opts.noAuth) {
    redirectToSignIn();
    throw new ApiError(401, "Session expired");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body — fall through
  }

  if (!res.ok) {
    const message =
      (data as { error?: string; message?: string } | null)?.error ||
      (data as { error?: string; message?: string } | null)?.message ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}
