// Client-side loader for the whole-site cut/fill Δz diff-raster (a Float32
// GeoTIFF on the baseline DSM grid, nodata −9999). Fetches + decodes the raster
// down-sampled to a light preview resolution, derives the color-scale stats
// (p98/max of |Δ|), and resolves the raster's own georeferencing to a geographic
// (lon/lat) bounding box so Cesium can drape it as a single tile.
//
// PURE of Cesium (returns a plain degree bbox — the caller builds the Rectangle)
// so it never pulls the webpack-externalised `cesium` global into a module that
// might be evaluated server-side. `geotiff` (heavy) and `proj4` (only needed for
// projected rasters) are dynamic-imported off the critical path, mirroring
// `projection.ts` — nothing loads until a cut/fill layer is actually rendered.

import { getWorkingTransform } from "@/lib/viewer/projection";

export const CUTFILL_NODATA = -9999;

export interface CutFillRaster {
  /** Row-major Δz samples, north-up (row 0 = northmost), length width·height. */
  data: Float32Array;
  width: number;
  height: number;
  /** Geographic extent `[west, south, east, north]` in degrees, or null when the
   * raster's CRS couldn't be resolved (caller falls back to the survey bbox). */
  bbox: [number, number, number, number] | null;
  noData: number;
  /** 98th percentile of |Δ| over valid pixels — the auto symmetric range. */
  absP98: number;
  /** Max |Δ| over valid pixels — the manual-range slider ceiling. */
  absMax: number;
}

interface LoadOptions {
  /** Cap on the larger output dimension (keeps a ~70 MPx raster light). */
  maxDim?: number;
}

/** True when a bbox already reads as lon/lat degrees (EPSG:4326 rasters). */
function looksLikeLonLat(b: number[]): boolean {
  return (
    Math.abs(b[0]) <= 180 &&
    Math.abs(b[2]) <= 180 &&
    Math.abs(b[1]) <= 90 &&
    Math.abs(b[3]) <= 90
  );
}

/** p98 + max of |Δ| via a two-pass histogram (avoids sorting millions of floats).
 * nodata / non-finite pixels are excluded. */
function computeAbsStats(data: ArrayLike<number>, noData: number): { absP98: number; absMax: number } {
  const n = data.length;
  let absMax = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v === noData || !Number.isFinite(v)) continue;
    valid++;
    const a = Math.abs(v);
    if (a > absMax) absMax = a;
  }
  if (valid === 0 || absMax === 0) return { absP98: 0, absMax: 0 };

  const BINS = 1024;
  const hist = new Int32Array(BINS);
  const scale = (BINS - 1) / absMax;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v === noData || !Number.isFinite(v)) continue;
    hist[(Math.abs(v) * scale) | 0]++;
  }
  const target = valid * 0.98;
  let cum = 0;
  let p98 = absMax;
  for (let b = 0; b < BINS; b++) {
    cum += hist[b];
    if (cum >= target) {
      p98 = (b + 1) / scale; // upper edge of the reaching bin
      break;
    }
  }
  return { absP98: Math.min(p98, absMax), absMax };
}

/**
 * Load + downsample the diff-raster. Uses the smallest embedded overview whose
 * larger side still ≥ `maxDim` when present (a light range-read), otherwise
 * resamples the full image via `readRasters({width,height})`. Nearest-neighbour
 * resampling is deliberate — bilinear would smear the −9999 nodata sentinel into
 * neighbouring real values.
 */
export async function loadCutfillRaster(url: string, opts: LoadOptions = {}): Promise<CutFillRaster> {
  const maxDim = opts.maxDim ?? 1500;
  const { fromUrl } = await import("geotiff");
  const tiff = await fromUrl(url);

  // Prefer an overview near the target size so a huge base image is never fully
  // decoded; index 0 is full-res, higher indices are progressively smaller.
  const count = await tiff.getImageCount();
  let image = await tiff.getImage(0);
  let bestDim = Math.max(image.getWidth(), image.getHeight());
  for (let i = 1; i < count; i++) {
    const candidate = await tiff.getImage(i);
    const dim = Math.max(candidate.getWidth(), candidate.getHeight());
    if (dim >= maxDim && dim < bestDim) {
      image = candidate;
      bestDim = dim;
    }
  }

  const srcW = image.getWidth();
  const srcH = image.getHeight();
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const noData = image.getGDALNoData() ?? CUTFILL_NODATA;

  const rasters = await image.readRasters({
    width: outW,
    height: outH,
    samples: [0],
    fillValue: noData,
    interleave: false,
  });
  const band = rasters[0];
  const data = band instanceof Float32Array ? band : Float32Array.from(band as ArrayLike<number>);

  const { absP98, absMax } = computeAbsStats(data, noData);
  const bbox = await resolveGeographicBbox(image);

  return { data, width: outW, height: outH, bbox, noData, absP98, absMax };
}

/** Resolve the raster's extent to a lon/lat degree bbox, inverting a projected
 * CRS with proj4 when needed. Returns null if the CRS can't be resolved. */
async function resolveGeographicBbox(
  image: import("geotiff").GeoTIFFImage
): Promise<[number, number, number, number] | null> {
  let raw: number[];
  try {
    raw = image.getBoundingBox(); // [minX, minY, maxX, maxY] in the raster CRS
  } catch {
    return null;
  }
  const [minX, minY, maxX, maxY] = raw;
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null;

  const gk = image.getGeoKeys() ?? {};
  const projCode = gk.ProjectedCSTypeGeoKey as number | undefined;
  const modelType = gk.GTModelTypeGeoKey as number | undefined; // 1 = projected, 2 = geographic

  // Projected raster (e.g. UTM) — invert the two corners to lon/lat.
  if (projCode && projCode !== 32767 && modelType !== 2 && !looksLikeLonLat(raw)) {
    try {
      const transform = await getWorkingTransform(`EPSG:${projCode}`);
      if (transform) {
        const [west, south] = transform.inverse([minX, minY]);
        const [east, north] = transform.inverse([maxX, maxY]);
        if ([west, south, east, north].every((n) => Number.isFinite(n))) {
          return [west, south, east, north];
        }
      }
    } catch {
      // fall through to the geographic / heuristic path
    }
  }

  // Geographic raster (EPSG:4326 — the Mine Site case) or coords already in
  // degrees: the bbox IS lon/lat.
  if (looksLikeLonLat(raw)) return [minX, minY, maxX, maxY];

  return null;
}
