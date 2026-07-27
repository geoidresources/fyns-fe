// AI change-detection (P0) — the pure, Cesium-free, React-free glue for the
// `change-detect` processor: the classified cut/fill change-polygon FeatureCollection
// (parse + summarize), the manifest poll URL-diff (mirrors GridExportDialog's
// pointsUrlSet/freshPointsExport), the dispatch payload builder, and the cut/fill
// class palette. Kept in one module so the numeric/wire logic has a single source
// of truth and can be unit-tested without React or Cesium (node --test strips the
// `import type`s below, so assetSvc's runtime deps never load).
//
// Server is the source of numbers (§4): volumes/areas here are RENDERED from the
// change-detect payload, never computed. The only derivations are display
// summaries over server-provided values.

import type {
  ChangeSetEntry,
  GenerateArtifactRef,
  GeoJsonGeometry,
} from "@/lib/api/assetSvc";

// ------------------------------------------------------------------ class palette

/** The two change classes the processor emits (feature `properties.class`). */
export type ChangeClass = "cut" | "fill";

/** Cut = red, fill = blue — matching the cut/fill heatmap's RdBu semantics
 * (cutfillColormap: "red=cut / blue=fill"). Hex strings so this module stays
 * Cesium-free; the scene hook wraps them in `Color.fromCssColorString`, the card
 * uses them directly for the class chips. */
export const CHANGE_COLORS: Record<ChangeClass, string> = {
  cut: "#EF4444", // red-500
  fill: "#3B82F6", // blue-500
};

/** Semi-transparent polygon fill; the outline ring is drawn solid (full alpha). */
export const CHANGE_FILL_ALPHA = 0.35;

// ------------------------------------------------------------------ geojson shape

/** One classified change region (GeoJSON Feature). Volumes are POSITIVE
 * magnitudes; `mean_dz_m` is SIGNED (negative for cut). All values are the
 * server's. */
export interface ChangeFeatureProps {
  class: ChangeClass;
  area_m2: number;
  volume_m3: number; // positive magnitude
  mean_dz_m: number; // signed — negative for cut
  max_dz_m: number;
}

export interface ChangeFeature {
  type: "Feature";
  geometry: GeoJsonGeometry; // Polygon (EPSG:4326)
  properties: ChangeFeatureProps;
}

export interface ChangeFeatureCollection {
  type: "FeatureCollection";
  features: ChangeFeature[];
}

/** A loaded change set: the manifest entry (server metrics) + its fetched,
 * validated change-polygon features. Held in the viewer store so the scene layer
 * and the Changes card share one fetch. */
export interface ChangeSet {
  entry: ChangeSetEntry;
  features: ChangeFeature[];
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate + narrow a raw FeatureCollection into typed change features. Skips
 * anything without a `cut`/`fill` class or a geometry — defensive against a
 * malformed sidecar; never throws. */
export function parseChangeFeatures(fc: unknown): ChangeFeature[] {
  const raw = (fc as { features?: unknown } | null)?.features;
  if (!Array.isArray(raw)) return [];
  const out: ChangeFeature[] = [];
  for (const f of raw) {
    const feat = f as {
      geometry?: GeoJsonGeometry;
      properties?: Record<string, unknown>;
    };
    const geometry = feat?.geometry;
    const props = feat?.properties;
    if (!geometry || !geometry.type || !geometry.coordinates || !props) continue;
    const cls = props.class;
    if (cls !== "cut" && cls !== "fill") continue;
    out.push({
      type: "Feature",
      geometry,
      properties: {
        class: cls,
        area_m2: isFiniteNumber(props.area_m2) ? props.area_m2 : 0,
        volume_m3: isFiniteNumber(props.volume_m3) ? props.volume_m3 : 0,
        mean_dz_m: isFiniteNumber(props.mean_dz_m) ? props.mean_dz_m : 0,
        max_dz_m: isFiniteNumber(props.max_dz_m) ? props.max_dz_m : 0,
      },
    });
  }
  return out;
}

/** The exterior ring ([lng,lat] pairs) of a change feature's geometry. Handles
 * Polygon (ring 0) and, defensively, MultiPolygon (first polygon's ring 0);
 * empty for anything else. Used by the scene hook to draw the solid outline and
 * by fly-to-region centroids. */
export function exteriorRing(geometry: GeoJsonGeometry): [number, number][] {
  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as number[][][])[0];
    return Array.isArray(ring) ? (ring as [number, number][]) : [];
  }
  if (geometry.type === "MultiPolygon") {
    const ring = (geometry.coordinates as number[][][][])[0]?.[0];
    return Array.isArray(ring) ? (ring as [number, number][]) : [];
  }
  return [];
}

// ------------------------------------------------------------------ summaries

export interface ChangeSummary {
  regionCount: number;
  cutVolumeM3: number;
  fillVolumeM3: number;
  netM3: number;
  thresholdM: number;
}

/** Headline totals for the Changes card / dialog success line — read straight
 * off the server's manifest entry (never re-summed from features). */
export function summarizeChangeEntry(entry: ChangeSetEntry): ChangeSummary {
  return {
    regionCount: entry.region_count,
    cutVolumeM3: entry.cut_volume_m3,
    fillVolumeM3: entry.fill_volume_m3,
    netM3: entry.net_m3,
    thresholdM: entry.threshold_m,
  };
}

// ------------------------------------------------------------------ manifest poll

/** True for a change-detect entry that actually carries a polygon sidecar. */
function isRenderableChange(e: ChangeSetEntry): boolean {
  return e.processor_type === "change-detect" && !!e.geojson_url;
}

/** Every change-detect polygon URL currently on the manifest — snapshotted
 * before dispatch so the poll can tell the FRESH set from a prior run's (the
 * output URL carries the workflow id, so it changes per run). Mirrors
 * GridExportDialog.pointsUrlSet. */
export function changesUrlSet(changes: ChangeSetEntry[] | null | undefined): Set<string> {
  const urls = new Set<string>();
  for (const e of changes ?? []) {
    if (isRenderableChange(e) && e.geojson_url) urls.add(e.geojson_url);
  }
  return urls;
}

/** The first change-detect entry whose geojson_url is NOT in `before` — the
 * result of the just-dispatched run. Mirrors GridExportDialog.freshPointsExport. */
export function freshChangeEntry(
  changes: ChangeSetEntry[] | null | undefined,
  before: Set<string>
): ChangeSetEntry | null {
  for (const e of changes ?? []) {
    if (isRenderableChange(e) && e.geojson_url && !before.has(e.geojson_url)) return e;
  }
  return null;
}

/** The change-detect entry to RENDER for a survey on load (task 4): the last
 * renderable entry, so a re-run's result wins over the original. Null when the
 * survey has no computed change set. */
export function currentChangeEntry(
  changes: ChangeSetEntry[] | null | undefined
): ChangeSetEntry | null {
  let found: ChangeSetEntry | null = null;
  for (const e of changes ?? []) {
    if (isRenderableChange(e)) found = e;
  }
  return found;
}

// ------------------------------------------------------------------ dispatch payload

/** One DSM ArtifactRef, EXACTLY as GridExportDialog builds its `source`:
 * `{ url, kind:"terrain", crs }`. The caller passes an already-un-proxied
 * (canonical storage.googleapis.com) URL — workflow-geo-svc reads the bucket
 * with its own credentials, not the app's /gcs proxy. */
export function changeArtifactRef(url: string, crs?: string): GenerateArtifactRef {
  return { url, kind: "terrain", crs };
}

export interface ChangeDetectPayloadInput {
  fromUrl: string; // canonical DSM url (survey A / reference / older)
  fromCrs?: string;
  toUrl: string; // canonical DSM url (current survey / newer)
  toCrs?: string;
  thresholdM: number;
  minAreaM2: number;
}

/** The frozen change-detect payload:
 * `{ from:<A DSM ref>, to:<B DSM ref>, threshold_m, min_area_m2 }`. Pure so the
 * exact captured shape is unit-testable; the dialog wraps it in the generate
 * envelope `{ processor_type:"change-detect", version:"v1", payload }`. */
export function buildChangeDetectPayload(input: ChangeDetectPayloadInput): {
  from: GenerateArtifactRef;
  to: GenerateArtifactRef;
  threshold_m: number;
  min_area_m2: number;
} {
  return {
    from: changeArtifactRef(input.fromUrl, input.fromCrs),
    to: changeArtifactRef(input.toUrl, input.toCrs),
    threshold_m: input.thresholdM,
    min_area_m2: input.minAreaM2,
  };
}
