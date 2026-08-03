// Contour generation — pure logic, no React, no Cesium, no network. Mirrors the
// lib/upload/planner.ts contract style: builds the exact `generate` request the
// deployed `contour-generate` processor expects, and suggests a sensible
// interval from a surface's elevation stats. Field names are validated
// server-side (asset-svc dtos / workflow-geo-svc framework schema) — they matter.
//
// The dispatch is async: asset-svc persists the result and it reappears in the
// render manifest as a VectorLayer with a "contours" role and an `interval_m`.
// The existing LayerPanel contour rendering picks it up — this module only
// shapes the REQUEST and the default interval; it never renders.

import type { GenerateArtifactRef, GenerateRequest } from "@/lib/api/assetSvc";

/**
 * Suggests a "nice" contour interval (meters) for a surface whose elevations
 * span [minElev, maxElev], targeting roughly 20 contour bands.
 *
 * The raw step is range/20, snapped to the nearest 1/2/5×10ⁿ value (the
 * Heckbert "nice numbers" rounding used for graph ticks) so the pre-filled
 * value reads as a round number a surveyor would pick. Returns null when the
 * range is not a usable positive, finite number (missing/degenerate stats) so
 * the caller leaves the field blank instead of showing NaN.
 */
export function suggestContourInterval(minElev: number, maxElev: number): number | null {
  const range = maxElev - minElev;
  if (!Number.isFinite(range) || range <= 0) return null;
  return niceStep(range / 20);
}

/** Round a positive magnitude to the nearest 1/2/5×10ⁿ step. */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const pow = 10 ** exp;
  const frac = raw / pow; // normalized into [1, 10)
  let niceFrac: number;
  if (frac < 1.5) niceFrac = 1;
  else if (frac < 3) niceFrac = 2;
  else if (frac < 7) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * pow;
}

/**
 * Builds the POST /surveys/:id/generate body that dispatches a contour job,
 * lock-step with the deployed `contour-generate` v1 processor:
 *
 *   processor_type: "contour-generate", version: "v1",
 *   payload: { source: { url, kind: "terrain", crs }, interval_m },
 *   inputs:  [{ url, kind: "terrain", crs }]
 *
 * `sourceUrl` is the DSM/DTM surface's `raw_raster_url` and `crs` that layer's
 * `crs`, both read from the manifest. `crs` is only emitted when present (a
 * co-registered surface always carries one; the key is omitted otherwise so the
 * wire shape stays clean).
 */
export function buildContourRequest(opts: {
  sourceUrl: string;
  crs?: string;
  intervalM: number;
}): GenerateRequest {
  const source: GenerateArtifactRef = { url: opts.sourceUrl, kind: "terrain" };
  if (opts.crs) source.crs = opts.crs;
  return {
    processor_type: "contour-generate",
    version: "v1",
    payload: { source, interval_m: opts.intervalM },
    inputs: [source],
  };
}

// ------------------------------------------------------- contour tile pyramid

/** The validated XYZ tile descriptor extracted from a contour layer's manifest
 * `properties`. `template` is a `{z}/{x}/{y}` URL; `minZoom`/`maxZoom` bound the
 * pyramid's request depth (undefined = let Cesium decide). */
export interface ContourTileInfo {
  template: string;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Reads a contour VectorLayer's untyped manifest `properties` bag and returns
 * its XYZ PNG tile descriptor when the backend emitted one, else null.
 *
 * A contour layer now MAY carry a Web-Mercator tile pyramid beside the heavy
 * GeoJSON (contour-generate v1+):
 *
 *   properties.output_urls = { template: ".../{z}/{x}/{y}.png", directory: "…" }
 *   properties.tile_min_zoom, properties.tile_max_zoom : number
 *   properties.tile_crs : "EPSG:3857"
 *
 * When a usable `{z}/{x}/{y}` template is present the caller renders it as a
 * constant-cost Cesium ImageryLayer; when it is absent/malformed (older
 * contours, or a non-Web-Mercator grid we can't project) this returns null and
 * the caller keeps the existing GeoJSON path. Pure + defensive so it is
 * unit-testable and safe over the `Record<string, unknown>` bag — no Cesium,
 * no network. The `template` string is used verbatim, so it already carries
 * whatever CORS proxying was applied at manifest load (proxyGcsUrls).
 */
export function contourTileTemplate(
  properties?: Record<string, unknown>
): ContourTileInfo | null {
  if (!properties || typeof properties !== "object") return null;

  // Our imagery provider speaks only Web Mercator (EPSG:3857 — the default
  // UrlTemplateImageryProvider tiling scheme, the same gdal2tiles grid the ortho
  // pyramids use). If the backend ever tags a different grid, fall back to
  // GeoJSON rather than mis-projecting the tiles. Absent tile_crs is accepted
  // (the contract's only value is 3857).
  const crs = properties.tile_crs;
  if (typeof crs === "string" && crs.trim() && crs.trim().toUpperCase() !== "EPSG:3857") {
    return null;
  }

  const urls = properties.output_urls;
  if (!urls || typeof urls !== "object") return null;
  const template = (urls as Record<string, unknown>).template;
  if (typeof template !== "string" || !template.includes("{z}")) return null;

  const asZoom = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

  return {
    template,
    minZoom: asZoom(properties.tile_min_zoom),
    maxZoom: asZoom(properties.tile_max_zoom),
  };
}
