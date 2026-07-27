// On-demand contour generation — the pure, Cesium-free, React-free glue for the
// `contour-generate` processor: the dispatch payload builder and the manifest
// poll URL-diff over layers.vectors (mirrors GridExportDialog's pointsUrlSet /
// freshPointsExport and changeDetect's changesUrlSet / freshChangeEntry). Kept in
// one module so the wire logic is a single source of truth and can be unit-tested
// without React or Cesium (node --test strips the `import type` below, so
// assetSvc's runtime deps never load).
//
// Server is the source of numbers (§4): the isolines are RENDERED from the
// server's GeoJSON sidecar, never traced here. The interval is a VERTICAL
// elevation step (metres in the DSM's vertical datum) — unlike grid-extract's
// horizontal `spacing_m` it needs NO metres→degrees CRS bridge, so there is no
// client-side sampling in this flow at all.

import type { GenerateArtifactRef, VectorLayer } from "@/lib/api/assetSvc";

/** Contour vector roles the processor emits: bare "contours" (single set, from a
 * legacy scalar `interval_m` request) or "contours_<N>m" (one artifact per
 * interval, so multiple intervals coexist and the interval-select is meaningful).
 * Mirrors sceneHelpers.contourVectorRole — duplicated here (a one-liner) so this
 * module stays Cesium-free; sceneHelpers imports cesium at module load. */
function isContourRole(role: string | undefined): boolean {
  return typeof role === "string" && (role === "contours" || role.startsWith("contours_"));
}

export interface ContourGeneratePayloadInput {
  /** Canonical (un-proxied) DSM raster URL — workflow-geo-svc reads the bucket
   * with its own credentials, not the app's /gcs proxy. */
  url: string;
  crs?: string;
  /** Vertical contour interval in metres (elevation step between isolines). */
  intervalM: number;
}

/** The frozen contour-generate payload:
 * `{ source:<DSM ref>, intervals_m:[interval], format:"geojson" }`. `intervals_m`
 * is deliberately an ARRAY (not a scalar `interval_m`): the processor then tags
 * the artifact role `contours_<N>m`, distinct per interval, so re-running at a
 * new interval ADDS a set instead of overwriting the single "contours" role. Pure
 * so the captured shape is unit-testable; the dialog wraps it in the generate
 * envelope `{ processor_type:"contour-generate", version:"v1", payload }`. */
export function buildContourGeneratePayload(input: ContourGeneratePayloadInput): {
  source: GenerateArtifactRef;
  intervals_m: number[];
  format: "geojson";
} {
  return {
    source: { url: input.url, kind: "terrain", crs: input.crs },
    intervals_m: [input.intervalM],
    format: "geojson",
  };
}

/** Every contour vector's geojson_url currently on the manifest — snapshotted
 * before dispatch so the poll can tell the FRESH set from a prior run's (the
 * output URL carries the workflow id, so it changes per run). Mirrors
 * GridExportDialog.pointsUrlSet / changeDetect.changesUrlSet. */
export function contoursUrlSet(vectors: VectorLayer[] | null | undefined): Set<string> {
  const urls = new Set<string>();
  for (const v of vectors ?? []) {
    if (isContourRole(v.role) && v.geojson_url) urls.add(v.geojson_url);
  }
  return urls;
}

export interface FreshContour {
  url: string;
  /** Vertical interval (m) from the artifact metadata — selects the fresh set. */
  intervalM?: number;
  role: string;
  featureCount: number;
}

/** The first contour vector whose geojson_url is NOT in `before` — the result of
 * the just-dispatched run. Carries interval_m + feature_count so the caller can
 * select the fresh interval and report the isoline count. Mirrors
 * GridExportDialog.freshPointsExport / changeDetect.freshChangeEntry. */
export function freshContourVector(
  vectors: VectorLayer[] | null | undefined,
  before: Set<string>
): FreshContour | null {
  for (const v of vectors ?? []) {
    if (isContourRole(v.role) && v.geojson_url && !before.has(v.geojson_url)) {
      return {
        url: v.geojson_url,
        intervalM: v.interval_m,
        role: v.role,
        featureCount: v.feature_count,
      };
    }
  }
  return null;
}
