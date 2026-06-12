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

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Skip the Authorization header (e.g. login). */
  noAuth?: boolean;
}

export async function apiFetch<T>(baseUrl: string, path: string, opts: ApiFetchOptions = {}): Promise<T> {
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

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

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
