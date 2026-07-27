// Direct-to-GCS upload of one file via its signed PUT URL, with progress.
//
// XHR instead of fetch: fetch has no upload-progress events. The Content-Type
// header MUST match the content_type the URL was signed with (initUploads),
// or GCS rejects the signature.
//
// CORS fallback: the bucket historically has no CORS policy (see the /gcs
// same-origin rewrite in next.config.ts that exists for tile GETs). If the
// direct PUT dies network-level (the browser surfaces a CORS block as a bare
// network error, status 0), retry once through the same-origin /gcs proxy —
// same path + signed query string, so the signature still verifies. Note the
// proxy hop buffers through the Next server, so direct CORS (a one-time
// bucket config) remains the right setup for multi-GB rasters.

const GCS_HOST = "https://storage.googleapis.com/";

// A large PUT has no single sensible total-time limit (multi-GB over slow links
// is legitimately long), but a connection that stops making progress must not
// hang the UI forever. Watch for a STALL instead: abort if no upload-progress
// event arrives for this long. Reset on every progress tick.
const STALL_TIMEOUT_MS = 90_000;

function proxiedUrl(signedUrl: string): string | null {
  if (!signedUrl.startsWith(GCS_HOST)) return null;
  return "/gcs/" + signedUrl.slice(GCS_HOST.length);
}

/** Thrown when the caller aborts the upload via its AbortSignal (Cancel /
 * unmount). Distinct so the page can treat it as a cancellation, not a failure. */
export class UploadAbortedError extends Error {
  constructor() {
    super("upload cancelled");
    this.name = "UploadAbortedError";
  }
}

function putOnce(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    let cancelled = false;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort(); // fires onabort; we reject with the stall reason below
      }, STALL_TIMEOUT_MS);
    };
    const onAbortSignal = () => {
      cancelled = true;
      xhr.abort();
    };
    const cleanup = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = undefined;
      signal?.removeEventListener("abort", onAbortSignal);
    };

    signal?.addEventListener("abort", onAbortSignal);
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      armStall(); // progress → reset the stall clock
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`upload failed (${xhr.status}): ${xhr.responseText?.slice(0, 200) || "no body"}`));
      }
    };
    // status 0 / onerror: network-level failure — for cross-origin PUTs this
    // is how a missing bucket CORS policy presents.
    xhr.onerror = () => {
      cleanup();
      reject(new CorsLikeError("upload blocked (network/CORS)"));
    };
    xhr.onabort = () => {
      cleanup();
      if (cancelled) reject(new UploadAbortedError());
      else if (stalled) reject(new Error(`upload stalled (no progress for ${STALL_TIMEOUT_MS / 1000}s)`));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error("upload timed out"));
    };
    armStall(); // arm before send so a connection that never even starts still trips
    xhr.send(file);
  });
}

class CorsLikeError extends Error {}

/** PUTs `file` to the signed URL, falling back to the same-origin /gcs proxy
 * when the direct PUT is CORS-blocked. Reports progress as 0..1. Aborts when
 * `signal` fires (throws UploadAbortedError). The /gcs fallback only helps
 * path-style signed URLs (`storage.googleapis.com/<bucket>/…`); a virtual-hosted
 * URL (`<bucket>.storage.googleapis.com/…`) is signed against a different host, so
 * rewriting it to the path-style proxy would break the V4 signature — for those we
 * surface a clear CORS error pointing at the bucket policy rather than silently
 * corrupt the request. */
export async function putToSignedUrl(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  try {
    await putOnce(signedUrl, file, contentType, onProgress, signal);
  } catch (err) {
    if (!(err instanceof CorsLikeError)) throw err;
    const fallback = proxiedUrl(signedUrl);
    if (!fallback) {
      throw new Error(
        "upload blocked by CORS and no same-origin fallback is available for this URL — the storage bucket needs a CORS policy for direct uploads"
      );
    }
    onProgress(0);
    await putOnce(fallback, file, contentType, onProgress, signal);
  }
}
