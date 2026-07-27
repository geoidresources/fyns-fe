// Cross-section (elevation profile) support — the last piece of the Survey/CAD
// exports bundle. Three PURE, testable concerns; the frontend never computes
// elevations, it only shapes the compute INPUT and renders the server's samples
// (§4 "server is the source of numbers").
//
//   1. buildCrossSectionPolyline — turn a WGS84 lon/lat LineString into the
//      profile-extract `polyline` param, expressed in the DSM's CRS. A GEOGRAPHIC
//      DSM (EPSG:4326 — the Mine Site case) already measures in lon/lat, so the
//      coords pass through unchanged (identity); a PROJECTED DSM reprojects
//      lon/lat → easting/northing via proj4. Spacing is plain metres — the
//      processor computes ground-metric chainage for both DSM kinds, so there is
//      NO metres→degrees bridge here (unlike GridExportDialog's grid spacing).
//   2. parseProfileDoc — narrow the sidecar JSON the processor writes.
//   3. profileChartGeometry — SVG-space paths for the station-vs-elevation chart,
//      with DSM-nodata (`z === null`) samples broken out as gaps.

import type { GeoJsonGeometry } from "@/lib/api/assetSvc";
// Runtime sibling import via a relative .ts path — the node test runner strips
// type-only `@/` imports but can't resolve the alias on a value import (the
// pattern the tested interaction modules follow).
import { getWorkingTransform, isGeographicCrs } from "./projection.ts";

// --------------------------------------------------------------- compute input

/** Ordered `[lon, lat]` vertices of a LineString, or null when it isn't a line
 * with ≥2 valid vertices (the processor 422s below two). A 3rd ordinate (Z) is
 * tolerated and dropped — the DSM supplies elevations, the input line is 2D. */
export function lineStringCoords(
  geometry: GeoJsonGeometry | undefined | null
): [number, number][] | null {
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const out: [number, number][] = [];
  for (const c of geometry.coordinates) {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      out.push([c[0], c[1]]);
    }
  }
  return out.length >= 2 ? out : null;
}

/** Build the profile-extract `polyline` param: the measurement's lon/lat
 * LineString expressed in the DSM's CRS. Returns null when the geometry isn't a
 * ≥2-vertex line, or when a PROJECTED DSM CRS can't be resolved to a proj4
 * transform — the caller then bails with a toast rather than send lon/lat coords
 * to a projected raster (which would sample far off-site). */
export async function buildCrossSectionPolyline(
  geometry: GeoJsonGeometry | undefined | null,
  dsmCrs: string | null | undefined
): Promise<number[][] | null> {
  const coords = lineStringCoords(geometry);
  if (!coords) return null;
  // Geographic DSM: lon/lat already IS the raster's unit — identity, no proj4.
  if (isGeographicCrs(dsmCrs)) return coords.map(([lon, lat]) => [lon, lat]);
  // Projected DSM: reproject lon/lat → easting/northing.
  const transform = await getWorkingTransform(dsmCrs ?? null);
  if (!transform) return null;
  return coords.map((c) => transform.forward(c));
}

// ----------------------------------------------------------------- result doc

/** One sampled station along the profile. `z` is null at DSM nodata (rendered as
 * a gap, never plotted as 0). `distance_m` is ground-metric chainage from the
 * line start; `x`/`y` are the sample's DSM-CRS coordinates. */
export interface ProfileSample {
  distance_m: number;
  x: number;
  y: number;
  z: number | null;
}

/** The profile-extract sidecar JSON: ordered samples + total length (metres). */
export interface ProfileDoc {
  samples: ProfileSample[];
  length_m: number;
}

/** Narrow the fetched sidecar JSON. Returns null on a shape mismatch so the
 * chart shows an error rather than throwing. Samples with a non-finite
 * `distance_m` are dropped; a non-finite `z` becomes null (a nodata gap). When
 * `length_m` is missing it falls back to the last sample's distance. */
export function parseProfileDoc(raw: unknown): ProfileDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.samples)) return null;

  const samples: ProfileSample[] = [];
  for (const s of obj.samples) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const distance_m = typeof r.distance_m === "number" ? r.distance_m : NaN;
    if (!Number.isFinite(distance_m)) continue;
    const z = typeof r.z === "number" && Number.isFinite(r.z) ? r.z : null;
    samples.push({
      distance_m,
      x: typeof r.x === "number" ? r.x : NaN,
      y: typeof r.y === "number" ? r.y : NaN,
      z,
    });
  }

  const length_m =
    typeof obj.length_m === "number" && Number.isFinite(obj.length_m)
      ? obj.length_m
      : samples.length
        ? samples[samples.length - 1].distance_m
        : 0;

  return { samples, length_m };
}

// --------------------------------------------------------------- chart geometry

export interface ProfileChartDims {
  width: number;
  height: number;
  padX: number;
  padY: number;
}

export interface ProfileChartGeometry {
  /** One SVG polyline `points` string per contiguous non-null run (line path). */
  lineSegments: string[];
  /** Matching area `d` paths — each run filled down to the baseline. */
  areaSegments: string[];
  /** Y of the chart floor (area fills close to it). */
  baselineY: number;
  /** Faint horizontal gridline Ys at the max / mid / min elevation levels. */
  gridYs: number[];
  /** Elevation extent actually plotted (metres). */
  minZ: number;
  maxZ: number;
  /** X-domain max (line length, metres). */
  lengthM: number;
  /** False when every sample is nodata (nothing to plot → empty state). */
  hasData: boolean;
}

/** Project a parsed profile into SVG-space paths. Samples are scaled to the
 * [padX, width-padX] × [padY, height-padY] plot box; nodata (`z === null`)
 * samples break the line into separate runs so gaps read as gaps, never as a
 * dive to 0. A dead-flat profile is padded ±0.5 m to avoid a divide-by-zero. */
export function profileChartGeometry(
  doc: ProfileDoc,
  dims: ProfileChartDims
): ProfileChartGeometry {
  const { width, height, padX, padY } = dims;
  const plotW = width - 2 * padX;
  const plotH = height - 2 * padY;
  const baselineY = height - padY;

  const zs: number[] = [];
  for (const s of doc.samples) if (s.z !== null) zs.push(s.z);
  const hasData = zs.length > 0;

  const lastDist = doc.samples.length ? doc.samples[doc.samples.length - 1].distance_m : 0;
  const lengthM = doc.length_m > 0 ? doc.length_m : lastDist;
  const domainX = lengthM > 0 ? lengthM : 1;

  let minZ = hasData ? Math.min(...zs) : 0;
  let maxZ = hasData ? Math.max(...zs) : 0;
  if (minZ === maxZ) {
    minZ -= 0.5;
    maxZ += 0.5;
  }
  const spanZ = maxZ - minZ;

  const xOf = (d: number) => padX + (d / domainX) * plotW;
  const yOf = (z: number) => padY + (1 - (z - minZ) / spanZ) * plotH;

  const lineSegments: string[] = [];
  const areaSegments: string[] = [];
  let run: { d: number; z: number }[] = [];
  const flush = () => {
    if (run.length === 0) return;
    lineSegments.push(run.map((p) => `${xOf(p.d).toFixed(1)},${yOf(p.z).toFixed(1)}`).join(" "));
    const first = run[0];
    const last = run[run.length - 1];
    areaSegments.push(
      `M ${xOf(first.d).toFixed(1)},${baselineY.toFixed(1)} ` +
        run.map((p) => `L ${xOf(p.d).toFixed(1)},${yOf(p.z).toFixed(1)}`).join(" ") +
        ` L ${xOf(last.d).toFixed(1)},${baselineY.toFixed(1)} Z`
    );
    run = [];
  };
  for (const s of doc.samples) {
    if (s.z === null) flush();
    else run.push({ d: s.distance_m, z: s.z });
  }
  flush();

  const gridYs = [yOf(maxZ), yOf((maxZ + minZ) / 2), yOf(minZ)];

  return { lineSegments, areaSegments, baselineY, gridYs, minZ, maxZ, lengthM, hasData };
}
