// Working-CRS projection (viewer-shell §4.6, decision D5). The status bar shows
// projected northing/easting in the survey's working CRS; this resolves a proj4
// definition for that CRS and exposes a lon/lat → [E, N] forward transform.
//
// proj4 (~13 KB gz) is dynamic-imported off the critical path on first call.
// Def resolution chain (first hit wins):
//   1. manifest `working_crs_def`            (SHOULD go-api extension)
//   2. computed UTM                          (326xx north / 327xx south)
//   3. curated table                         (MGA94, MGA2020, NZTM, OSGB, ETRS-UTM)
//   4. epsg.io/{code}.proj4, localStorage-cached
//   5. null                                  (caller degrades to LAT/LNG, never blank)
//
// Browser-only steps (localStorage, epsg.io fetch) are guarded so the module is
// import-safe and unit-testable under node (the computed-UTM path needs no I/O).

import type { GeoJsonGeometry } from "@/lib/api/assetSvc";

// proj4 ships CommonJS types (`export = proj4`, a function+namespace merge), so
// the module type IS the callable. Node/webpack ESM interop exposes it at
// runtime under `.default`; we resolve that defensively so the code works under
// both.
type Proj4 = typeof import("proj4");

/** A resolved forward projection for the working CRS. `forward([lon, lat])`
 * returns projected `[easting, northing]` in the CRS's units; `inverse([E, N])`
 * returns geographic `[lon, lat]` (used to place a projected raster's corners). */
export interface WorkingTransform {
  code: number | null;
  def: string;
  source: "manifest" | "utm" | "curated" | "epsg.io";
  forward(lonLat: [number, number]): [number, number];
  inverse(projected: [number, number]): [number, number];
}

let proj4Promise: Promise<Proj4> | null = null;

/** Memoized dynamic import — proj4 loads at most once per session (§4.6). */
function loadProj4(): Promise<Proj4> {
  if (proj4Promise === null) {
    proj4Promise = import("proj4").then((m) => {
      const mod = m as unknown as { default?: Proj4 };
      return typeof mod.default === "function"
        ? mod.default
        : (m as unknown as Proj4);
    });
  }
  return proj4Promise;
}

/** Pull the numeric EPSG code out of a working_crs string
 * ("EPSG:32756", "epsg:32756", "32756", "EPSG:32756 - …"). */
function parseEpsgCode(crs: string): number | null {
  const match = /(?:EPSG:)?\s*(\d{4,6})/i.exec(crs.trim());
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

/** Step 2 — a UTM EPSG code maps directly to a proj4 def with no lookup.
 * 326zz = WGS84 / UTM zone zz N; 327zz = zone zz S. */
function computedUtmDef(code: number): string | null {
  if (code >= 32601 && code <= 32660) {
    return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
  }
  if (code >= 32701 && code <= 32760) {
    return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
  }
  return null;
}

/** Step 3 — the curated table for the CRSs GEOID surveys actually use that are
 * NOT plain WGS84/UTM: Australian MGA94 & MGA2020, NZTM2000, British National
 * Grid, and ETRS89/UTM (Europe). */
function curatedDef(code: number): string | null {
  // GDA94 / MGA zone 48–56 (EPSG 28348–28356), GRS80, southern hemisphere.
  if (code >= 28348 && code <= 28356) {
    return `+proj=utm +zone=${code - 28300} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  }
  // GDA2020 / MGA zone 46–59 (EPSG 7846–7859), GRS80, southern hemisphere.
  if (code >= 7846 && code <= 7859) {
    return `+proj=utm +zone=${code - 7800} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  }
  // ETRS89 / UTM zone 28–38 N (EPSG 25828–25838), GRS80, northern hemisphere.
  if (code >= 25828 && code <= 25838) {
    return `+proj=utm +zone=${code - 25800} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  }
  switch (code) {
    case 2193: // NZGD2000 / New Zealand Transverse Mercator 2000.
      return "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
    case 27700: // OSGB36 / British National Grid.
      return "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs";
    default:
      return null;
  }
}

/** localStorage access, fully guarded: absent (SSR), partially-implemented
 * (Node's experimental global), or access-throwing (Safari private mode) all
 * degrade to no-op rather than throwing. */
function readCachedDef(cacheKey: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(cacheKey);
  } catch {
    return null;
  }
}

function writeCachedDef(cacheKey: string, def: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(cacheKey, def);
  } catch {
    // Quota / disabled storage — the cache is best-effort.
  }
}

/** Step 4 — cached epsg.io lookup. localStorage-first, then network; both are
 * guarded so this is a no-op (returns null) outside the browser. */
async function epsgIoDef(code: number): Promise<string | null> {
  const cacheKey = `geoid:crs-def:${code}`;
  const cached = readCachedDef(cacheKey);
  if (cached) return cached;

  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch(`https://epsg.io/${code}.proj4`);
    if (!res.ok) return null;
    const def = (await res.text()).trim();
    if (!def || !def.includes("+proj")) return null;
    writeCachedDef(cacheKey, def);
    return def;
  } catch {
    return null; // Network failure → caller degrades to LAT/LNG.
  }
}

/** Build the forward transform from a resolved proj4 def string. `proj4(def)`
 * is a converter from WGS84 lon/lat to the target CRS, so `.forward([lon, lat])`
 * yields `[E, N]` (§4.6 pipeline). */
function buildTransform(
  proj4: Proj4,
  def: string,
  code: number | null,
  source: WorkingTransform["source"]
): WorkingTransform {
  const converter = proj4(def);
  return {
    code,
    def,
    source,
    forward: (lonLat) => converter.forward(lonLat) as [number, number],
    inverse: (projected) => converter.inverse(projected) as [number, number],
  };
}

/**
 * Resolve a forward projection for the working CRS, or null if none can be
 * found (caller falls back to LAT/LNG, never blank — §4.6).
 *
 * @param crs           working_crs string, e.g. "EPSG:32756" (or a raw
 *                      "+proj=…" def).
 * @param workingCrsDef optional manifest `working_crs_def` (chain step 1).
 */
export async function getWorkingTransform(
  crs: string | null | undefined,
  workingCrsDef?: string | null
): Promise<WorkingTransform | null> {
  if (!crs && !workingCrsDef) return null;
  const proj4 = await loadProj4();

  const code = crs ? parseEpsgCode(crs) : null;

  // Step 1 — an explicit def from the manifest (or a raw def passed as `crs`).
  const explicitDef =
    workingCrsDef && workingCrsDef.includes("+proj")
      ? workingCrsDef
      : crs && crs.includes("+proj")
        ? crs
        : null;
  if (explicitDef) {
    return buildTransform(proj4, explicitDef, code, "manifest");
  }

  if (code === null) return null;

  // Step 2 — computed UTM.
  const utm = computedUtmDef(code);
  if (utm) return buildTransform(proj4, utm, code, "utm");

  // Step 3 — curated table.
  const curated = curatedDef(code);
  if (curated) return buildTransform(proj4, curated, code, "curated");

  // Step 4 — epsg.io, localStorage-cached.
  const fetched = await epsgIoDef(code);
  if (fetched) return buildTransform(proj4, fetched, code, "epsg.io");

  // Step 5 — give up; caller degrades gracefully.
  return null;
}

/** Recursively reproject a GeoJSON geometry's coordinates from WGS84 lon/lat to
 * the working CRS via `forward` (a `WorkingTransform.forward`). A leaf position
 * — an array whose first two entries are numbers — maps `[lon, lat, …rest]` →
 * `[E, N, …rest]`: the 3rd element (Z / elevation) and anything beyond pass
 * through untouched, so heights survive into LandXML CgPoints / CSV. Nested
 * coordinate arrays (LineString, Polygon rings, Multi*) recurse; the geometry
 * `type` is preserved. Used to turn a lon/lat measurement FeatureCollection into
 * projected metres before a CAD/survey export (a lon/lat DXF is useless in CAD).
 */
export function reprojectGeometry(
  geometry: GeoJsonGeometry,
  forward: (lonLat: [number, number]) => [number, number]
): GeoJsonGeometry {
  return { ...geometry, coordinates: reprojectCoordinates(geometry.coordinates, forward) };
}

function reprojectCoordinates(
  node: unknown,
  forward: (lonLat: [number, number]) => [number, number]
): unknown {
  if (!Array.isArray(node)) return node;
  if (typeof node[0] === "number" && typeof node[1] === "number") {
    const [e, n] = forward([node[0], node[1]]);
    return node.length > 2 ? [e, n, ...node.slice(2)] : [e, n];
  }
  return node.map((child) => reprojectCoordinates(child, forward));
}
