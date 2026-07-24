// Client-side colormap for the whole-site cut/fill Δ heatmap. PURE MODULE — no
// Cesium, no geotiff, no React. It owns the diverging palettes, the per-pixel
// colorize pass (the "instant" recolor: a CPU loop over the already-loaded
// Float32 Δz array), the settings shape, and the legend/format helpers. The
// raster fetch/decode lives in `cutfillRaster.ts`; the Cesium wiring in
// `useLayerLifecycle` + `ViewerCanvas`. Keeping this leaf pure means the store
// and LayerPanel can import the types/palette list without dragging Cesium
// (webpack-externalised to a browser global) into an SSR-eval'd module.

/** Δz convention: cut (ground removed → Δz < 0) maps to the LOW/first stop,
 * fill (ground added → Δz > 0) to the HIGH/last stop. So the diverging palettes
 * below are authored red(cut) → neutral → blue/green(fill), matching the baked
 * ramp's "red=cut / blue=fill". */
export type CutFillPaletteId = "rdbu" | "rdylbu" | "turbo" | "redgreen";

export interface CutFillPalette {
  id: CutFillPaletteId;
  label: string;
  /** Evenly-spaced RGB control points, low→high; interpolated at colorize time. */
  stops: readonly [number, number, number][];
}

// ColorBrewer RdBu (11-class), low index = red = cut, high = blue = fill.
const RDBU: CutFillPalette["stops"] = [
  [103, 0, 31], [178, 24, 43], [214, 96, 77], [244, 165, 130], [253, 219, 199],
  [247, 247, 247],
  [209, 229, 240], [146, 197, 222], [67, 147, 195], [33, 102, 172], [5, 48, 97],
];

// ColorBrewer RdYlBu (11-class): red → yellow(neutral) → blue.
const RDYLBU: CutFillPalette["stops"] = [
  [165, 0, 38], [215, 48, 39], [244, 109, 67], [253, 174, 97], [254, 224, 144],
  [255, 255, 191],
  [224, 243, 248], [171, 217, 233], [116, 173, 209], [69, 117, 180], [49, 54, 149],
];

// Google Turbo (coarse control points). A sequential rainbow used here as a
// high-contrast magnitude ramp: cut → dark purple, fill → dark red.
const TURBO: CutFillPalette["stops"] = [
  [48, 18, 59], [66, 100, 205], [56, 166, 240], [29, 221, 190], [96, 252, 105],
  [179, 246, 42], [240, 192, 42], [240, 95, 26], [122, 4, 3],
];

// Bold cut=red / fill=green diverging (red → white → green).
const REDGREEN: CutFillPalette["stops"] = [
  [103, 0, 31], [178, 24, 43], [214, 96, 77], [244, 165, 130],
  [247, 247, 247],
  [166, 219, 160], [90, 174, 97], [27, 120, 55], [0, 68, 27],
];

export const CUTFILL_PALETTES: readonly CutFillPalette[] = [
  { id: "rdbu", label: "Red → Blue", stops: RDBU },
  { id: "rdylbu", label: "Red → Yellow → Blue", stops: RDYLBU },
  { id: "turbo", label: "Turbo", stops: TURBO },
  { id: "redgreen", label: "Cut red / Fill green", stops: REDGREEN },
];

const PALETTE_BY_ID: Record<CutFillPaletteId, CutFillPalette> = Object.fromEntries(
  CUTFILL_PALETTES.map((p) => [p.id, p])
) as Record<CutFillPaletteId, CutFillPalette>;

export function paletteById(id: CutFillPaletteId): CutFillPalette {
  return PALETTE_BY_ID[id] ?? PALETTE_BY_ID.rdbu;
}

/** Per-cut/fill-layer render settings. `absP98`/`absMax` are raster-derived and
 * immutable per load (seeded when the raster resolves); the rest are user knobs.
 * The effective color range is always `[min, max]` — in `auto` mode the UI keeps
 * those pinned to the symmetric ±p98 of |Δ|. */
export interface CutFillSettings {
  palette: CutFillPaletteId;
  rangeMode: "auto" | "manual";
  min: number; // color-ramp low bound (negative = deepest cut shown)
  max: number; // color-ramp high bound (positive = deepest fill shown)
  opacity: number; // 0..1
  deadbandM: number; // |Δ| below this → transparent
  absP98: number; // 98th percentile of |Δ| (auto range half-width)
  absMax: number; // max |Δ| over valid pixels (slider upper bound)
}

/** Magnitude-aware rounding for seeded/displayed Δ values. */
export function roundDelta(x: number): number {
  const a = Math.abs(x);
  const d = a >= 10 ? 0 : a >= 1 ? 1 : 2;
  return Number(x.toFixed(d));
}

/** Round a magnitude UP to a clean slider ceiling (1/2/5 × 10ⁿ). */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * pow;
}

/** Default settings for a freshly-loaded raster: RdBu, auto ±p98, α0.85. */
export function defaultCutfillSettings(stats: { absP98: number; absMax: number }): CutFillSettings {
  const p98 = roundDelta(Math.max(stats.absP98, 0.01));
  return {
    palette: "rdbu",
    rangeMode: "auto",
    min: -p98,
    max: p98,
    opacity: 0.85,
    deadbandM: 0,
    absP98: stats.absP98,
    absMax: stats.absMax,
  };
}

function sampleStops(stops: CutFillPalette["stops"], t: number): [number, number, number] {
  const n = stops.length;
  if (n === 1) return stops[0] as [number, number, number];
  const f = t * (n - 1);
  let i = Math.floor(f);
  if (i < 0) i = 0;
  else if (i > n - 2) i = n - 2;
  const frac = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
}

export interface ColorizeOptions {
  min: number;
  max: number;
  deadbandM: number;
  palette: CutFillPaletteId;
  noData: number;
}

/**
 * Colorize a Δz raster into a straight (non-premultiplied) RGBA buffer suitable
 * for `new ImageData(...)`. Pure CPU — this is the pass that makes palette/range/
 * deadband changes feel instant (no re-fetch). nodata / non-finite / |Δ| below the
 * deadband → transparent; transparent texels keep the neutral mid-palette RGB so
 * Cesium's linear texture filtering fades cleanly at the data edge instead of
 * bleeding a dark or extreme-color halo.
 *
 * @param out optional reusable buffer (length must be width·height·4).
 */
export function colorizeCutfill(
  data: ArrayLike<number>,
  width: number,
  height: number,
  opts: ColorizeOptions,
  out?: Uint8ClampedArray
): Uint8ClampedArray {
  const count = width * height;
  const rgba = out && out.length === count * 4 ? out : new Uint8ClampedArray(count * 4);
  const stops = paletteById(opts.palette).stops;
  const min = opts.min;
  const span = opts.max - min || 1e-9;
  const dead = Math.max(0, opts.deadbandM);
  const noData = opts.noData;
  const neutral = sampleStops(stops, 0.5);
  const nr = neutral[0];
  const ng = neutral[1];
  const nb = neutral[2];

  for (let i = 0; i < count; i++) {
    const v = data[i];
    const o = i * 4;
    if (v === noData || !Number.isFinite(v) || Math.abs(v) < dead) {
      rgba[o] = nr;
      rgba[o + 1] = ng;
      rgba[o + 2] = nb;
      rgba[o + 3] = 0;
      continue;
    }
    let t = (v - min) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const c = sampleStops(stops, t);
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

/** CSS `linear-gradient(...)` for the legend strip (low→high, left→right). */
export function paletteCssGradient(id: CutFillPaletteId): string {
  const stops = paletteById(id).stops;
  const n = stops.length;
  const parts = stops.map((c, i) => {
    const pct = n === 1 ? 0 : (i / (n - 1)) * 100;
    return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** Signed Δ endpoint label, e.g. `-5 m` / `+2.3 m` / `0 m`. */
export function formatDelta(v: number): string {
  const r = roundDelta(v);
  if (r === 0) return "0 m";
  return `${r > 0 ? "+" : ""}${r} m`;
}
