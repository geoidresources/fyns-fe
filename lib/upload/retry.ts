// Small retry helper for the upload flow (ORB-38).
//
// lib/api/client.ts deliberately auto-retries GETs ONLY — retrying a POST could
// double-submit. But some non-GET calls in the upload run ARE safe to retry
// because they are idempotent by construction: markAssetUploaded just flips one
// asset row to `registered`, so replaying it converges on the same state.
// Without a retry, a single transient blip on that PATCH strands already-
// uploaded bytes as `pending_upload` forever.
//
// Callers must only wrap genuinely idempotent operations.

/** Worth another attempt: a network error, a request timeout (408), or a 5xx.
 * A 4xx is deterministic (auth, validation, not-found) and must surface now. */
function retriable(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status === 408 || status >= 500;
  return true; // non-ApiError → fetch/network failure
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base delay; grows linearly (base, 2×base, …). */
  backoffMs?: number;
  /** Test seam — defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `fn`, retrying transient failures with linear backoff. Rethrows the
 * last error once attempts are exhausted or the failure is deterministic. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !retriable(err)) throw err;
      await sleep(backoffMs * attempt);
    }
  }
  throw lastErr;
}
