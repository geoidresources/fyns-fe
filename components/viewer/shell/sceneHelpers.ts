// Shared module-level helpers, constants and layer-handle types for the viewer
// shell. MOVED VERBATIM from SurveyViewer.tsx:101-239 (viewer-shell §2.3 — a
// relocation, not a rewrite): the url/bbox/lens/proxy helpers, the ACCENT +
// DEFAULT_CENTER constants, the LayerHandle union and the PendingDraw shape.
// Consumed by ViewerRuntime and the moved effect hooks; every declaration is
// re-exported so those files import instead of re-declaring. The bodies are
// byte-identical to the original (only a leading `export` was added).

import {
  Cesium3DTileset,
  Color,
  GeoJsonDataSource,
  ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
} from "cesium";
import type { Manifest, Measurement } from "@/lib/api/assetSvc";
import type { DrawMode } from "@/components/viewer/MeasurementPanel";

/** A thin DXF site model is a CAD surface (floats/cliffs, single-sided) — NOT a
 * complete photogrammetry reality mesh. Everything else (3mx/osgb/obj/3tz/…, or
 * unknown) is treated as a real mesh that renders crisp on terrain. */
export function isThinSurfaceMesh(sourceFormat?: string): boolean {
  return (sourceFormat || "").trim().toLowerCase() === "dxf";
}

/** A design's format determines whether we can draw it client-side. */
export function designIsGeoJson(format?: string, url?: string): boolean {
  const f = (format || "").toLowerCase();
  if (f.includes("geojson") || f.includes("json")) return true;
  return !!url && /\.geojson(\?|$)/i.test(url);
}

// Default camera target (Kalinga Vihar) when neither layer bbox nor project
// center is available yet.
export const DEFAULT_CENTER = { lat: 20.2587, lng: 85.7571, height: 3000 };

export const ACCENT = Color.fromCssColorString("#C97A4E");

// Global terrain base. With a Cesium ion token set, the viewer uses Cesium World
// Terrain as the base so a survey sits inside real surrounding elevation — the
// textured reality mesh renders ON the ground (no floating/cliff), the
// "digital-twin" look. Without a token it stays the flat ellipsoid + DSM-drape.
// Ion token is applied by loadCesium() before the page renders this component.

// ------------------------------------------------------------- url helpers

/** Picks an XYZ {z}/{x}/{y} template from a processor's output_urls bundle. */
export function pickXyzTemplate(urls?: Record<string, string>): string | null {
  if (!urls) return null;
  if (urls.template) return urls.template;
  for (const v of Object.values(urls)) {
    if (typeof v === "string" && v.includes("{z}")) return v;
  }
  if (urls.directory) return urls.directory.replace(/\/+$/, "") + "/{z}/{x}/{y}.png";
  return null;
}

/** Picks the 3D Tiles tileset.json URL from a pointcloud output_urls bundle. */
export function pickTilesetUrl(urls?: Record<string, string>): string | null {
  if (!urls) return null;
  if (urls.tileset_json) return urls.tileset_json;
  for (const v of Object.values(urls)) {
    if (typeof v === "string" && v.includes("tileset.json")) return v;
  }
  return null;
}

/** lens_slope_tiles -> "Slope" */
export function lensLabel(key: string): string {
  const name = key.replace(/^lens_/, "").replace(/_tiles$/, "").replace(/_/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** lens_elevation_viridis_tiles -> viridis; lens_hillshade_tiles -> hillshade */
export function parseLensRamp(outputKey: string): string | undefined {
  const m = outputKey.match(/^lens_elevation_(\w+)_tiles$/);
  if (m) return m[1];
  if (outputKey === "lens_hillshade_tiles") return "hillshade";
  return undefined;
}

export function contourVectorRole(role: string): boolean {
  return role === "contours" || role.startsWith("contours_");
}

export const ELEVATION_RAMPS = ["viridis", "terrain", "plasma", "grayscale"] as const;

// proxyGcsUrls deep-rewrites storage.googleapis.com URLs onto the app's /gcs
// same-origin proxy (next.config.ts rewrites) — the bucket has no CORS policy
// and Cesium's WebGL fetches require it. Applied once at manifest load so
// every consumer (imagery, terrain, tilesets, GeoJSON) sees proxied URLs.
export const GCS_PREFIX = "https://storage.googleapis.com/";
export function proxyGcsUrls<T>(value: T): T {
  if (typeof value === "string") {
    return (value.startsWith(GCS_PREFIX)
      ? "/gcs/" + value.slice(GCS_PREFIX.length)
      : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(proxyGcsUrls) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = proxyGcsUrls(v);
    }
    return out as T;
  }
  return value;
}

export function bboxToRectangle(bbox?: number[]): Rectangle | undefined {
  if (!bbox || bbox.length !== 4) return undefined;
  const [west, south, east, north] = bbox;
  if ([west, south, east, north].some((n) => typeof n !== "number" || isNaN(n))) return undefined;
  // Reject degenerate boxes (a processor that didn't compute a bbox emits
  // [0,0,0,0]); unioning one into the camera target drags the view to null
  // island and the survey ends up framed with a quarter of the planet.
  if (west >= east || south >= north) return undefined;
  try {
    return Rectangle.fromDegrees(west, south, east, north);
  } catch {
    return undefined;
  }
}

/** Build a single-tile imagery provider from a colorized cut/fill canvas. The
 * synchronous constructor lazily loads the PNG data-URL on first `requestImage`
 * (no network — it's in-memory), so this returns instantly and the swap in
 * `handleCutfillSettings` needs no await. The image is treated as EPSG:4326 and
 * draped over `rectangle`. */
export function makeCutfillProvider(
  canvas: HTMLCanvasElement,
  rectangle: Rectangle
): SingleTileImageryProvider {
  return new SingleTileImageryProvider({
    url: canvas.toDataURL(),
    rectangle,
    tileWidth: canvas.width,
    tileHeight: canvas.height,
  });
}

export function manifestLayersEmpty(m: Manifest | null): boolean {
  if (!m) return true;
  const l = m.layers;
  return (
    !(l.terrain?.length) &&
    !(l.ortho?.length) &&
    !(l.pointcloud?.length) &&
    !(l.lenses?.length) &&
    !(l.vectors?.length) &&
    !(l.site_models?.length)
  );
}

// ------------------------------------------------------------ layer handles

export type LayerHandle =
  | { type: "imagery"; layer: ImageryLayer }
  | { type: "terrain"; url: string }
  | { type: "tileset"; tileset: Cesium3DTileset }
  | { type: "datasource"; ds: GeoJsonDataSource }
  // Large GeoJSON (contours) parses + batches into big typed arrays — done
  // lazily on first toggle so opening the viewer never pays that cost.
  | { type: "geojson-lazy"; url: string; loading?: boolean };

export interface PendingDraw {
  mode: DrawMode;
  coords: [number, number][]; // [lng, lat]
  // Backend measurement kind. Widened to `Measurement["kind"]` (the template
  // seam, viewer-shell §3.3/§4.3). Safe to widen here: `sceneHelpers` is new, so
  // this `PendingDraw` never fed the frozen SurveyViewer (which has its own
  // inline narrow copy). `DrawOptions.kind` in MeasurementPanel widens later,
  // once SurveyViewer — whose :1737 pins it narrow — is deleted (§7 1.3c).
  kind: Measurement["kind"];
  folder?: string;
  slope?: boolean;
  // Pre-filled compute params carried from a template (§4.3); merged verbatim
  // into `createMeasurement` at save time.
  params?: Record<string, unknown>;
}
