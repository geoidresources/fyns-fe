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
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`upload failed (${xhr.status}): ${xhr.responseText?.slice(0, 200) || "no body"}`));
      }
    };
    // status 0 / onerror: network-level failure — for cross-origin PUTs this
    // is how a missing bucket CORS policy presents.
    xhr.onerror = () => reject(new CorsLikeError("upload blocked (network/CORS)"));
    xhr.ontimeout = () => reject(new Error("upload timed out"));
    xhr.send(file);
  });
}

class CorsLikeError extends Error {}

/** PUTs `file` to the signed URL, falling back to the same-origin /gcs proxy
 * when the direct PUT is CORS-blocked. Reports progress as 0..1. */
export async function putToSignedUrl(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  try {
    await putOnce(signedUrl, file, contentType, onProgress);
  } catch (err) {
    const fallback = err instanceof CorsLikeError ? proxiedUrl(signedUrl) : null;
    if (!fallback) throw err;
    onProgress(0);
    await putOnce(fallback, file, contentType, onProgress);
  }
}
