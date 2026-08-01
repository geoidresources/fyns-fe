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
//
// Timeouts (ORB-38): `xhr.timeout` was never assigned, so it defaulted to 0
// (never) and `ontimeout` was dead code — a stalled TCP connection hung the
// upload forever, which pinned the page in its non-cancellable "working" phase.
// A single wall-clock cap is the wrong instrument here: a 2 GB raster on a slow
// uplink legitimately takes hours, so any cap tight enough to catch a stall
// would kill real uploads. The primary mechanism is therefore a STALL watchdog
// on upload-progress events (bytes must keep moving), with `xhr.timeout` set as
// a coarse absolute backstop so no request can live forever.

const GCS_HOST = "https://storage.googleapis.com/";

/** No upload-progress event for this long → the connection is stalled. */
const STALL_TIMEOUT_MS = 60_000;
/** After the body is fully sent, how long to wait for GCS to answer. */
const RESPONSE_TIMEOUT_MS = 120_000;
/** Coarse per-attempt ceiling. Deliberately generous — the stall watchdog is
 * what actually catches hung connections; this only stops a pathological
 * request from outliving the page. */
const ABSOLUTE_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** A stalled / timed-out upload. Distinct from CorsLikeError so the caller does
 * NOT burn a second full timeout retrying through the proxy, and distinct from
 * a generic Error so the UI can offer a resumable retry. */
export class UploadTimeoutError extends Error {}

class CorsLikeError extends Error {}

function proxiedUrl(signedUrl: string): string | null {
  if (!signedUrl.startsWith(GCS_HOST)) return null;
  return "/gcs/" + signedUrl.slice(GCS_HOST.length);
}

function putOnce(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let stalledMessage: string | null = null;

    const clearWatchdog = () => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };
    /** (Re)arm the watchdog. Each progress event pushes the deadline out, so a
     * slow-but-moving upload never trips it. */
    const arm = (ms: number, message: string) => {
      clearWatchdog();
      watchdog = setTimeout(() => {
        stalledMessage = message;
        xhr.abort(); // → onabort below
      }, ms);
    };

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.timeout = ABSOLUTE_TIMEOUT_MS;

    xhr.upload.onprogress = (e) => {
      arm(STALL_TIMEOUT_MS, `upload stalled — no data sent for ${STALL_TIMEOUT_MS / 1000}s`);
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    // Body fully sent: from here we are waiting on GCS, and no further upload
    // progress will fire — swap to the response deadline or the watchdog would
    // abort a perfectly healthy request.
    xhr.upload.onload = () => {
      arm(RESPONSE_TIMEOUT_MS, `upload timed out waiting for a response after ${RESPONSE_TIMEOUT_MS / 1000}s`);
    };

    xhr.onload = () => {
      clearWatchdog();
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
      clearWatchdog();
      reject(new CorsLikeError("upload blocked (network/CORS)"));
    };
    xhr.ontimeout = () => {
      clearWatchdog();
      reject(new UploadTimeoutError("upload timed out"));
    };
    // The watchdog aborts through here; a caller-driven abort would too.
    xhr.onabort = () => {
      clearWatchdog();
      reject(
        stalledMessage ? new UploadTimeoutError(stalledMessage) : new Error("upload aborted")
      );
    };

    // Arm before send: a connection that never opens produces no progress
    // events at all, and must still trip the watchdog.
    arm(STALL_TIMEOUT_MS, `upload stalled — no data sent for ${STALL_TIMEOUT_MS / 1000}s`);
    xhr.send(file);
  });
}

/** PUTs `file` to the signed URL, falling back to the same-origin /gcs proxy
 * when the direct PUT is CORS-blocked. Reports progress as 0..1.
 * Throws `UploadTimeoutError` when the connection stalls. */
export async function putToSignedUrl(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  try {
    await putOnce(signedUrl, file, contentType, onProgress);
  } catch (err) {
    // Only a CORS-shaped failure is worth the proxy hop. A timeout retried
    // through the proxy would just stall for another full watchdog period.
    const fallback = err instanceof CorsLikeError ? proxiedUrl(signedUrl) : null;
    if (!fallback) throw err;
    onProgress(0);
    await putOnce(fallback, file, contentType, onProgress);
  }
}
