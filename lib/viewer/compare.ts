// Compare Mode helpers (survey-compare feature) — the pure, Cesium-free glue
// shared by the two entry points (the bottom-center `SurveyCompare` swipe
// control and the FloatingToolbar's Compare split-button) plus the comparison
// card. Kept in one module so the epoch-sorting, activation-seeding, and
// temporal-pair detection have a single source of truth and can be unit-tested
// without React. The cross-survey SurfaceRef pair itself lives in calc.ts
// (`crossSurveyRefs`) next to the other param-wiring.

import type { Survey } from "@/lib/api/assetSvc";

/** Chronological (oldest → newest) so "before"/"after" reads naturally; drops
 * undated surveys (they can't be placed on the timeline). Copies before sort. */
export function sortSurveysChronological(surveys: Survey[]): Survey[] {
  return surveys
    .filter((s) => s.survey_date)
    .slice()
    .sort((a, b) => a.survey_date.localeCompare(b.survey_date));
}

/** Default A ("before") for a freshly-activated compare: the epoch immediately
 * earlier than the current survey. If the current survey is the earliest (no
 * earlier epoch exists) fall back to the next-newer sibling so A never collides
 * with B — a self-comparison would render identical orthos on both sides. */
export function defaultBeforeId(
  sortedOldestFirst: Survey[],
  currentId: string
): string | null {
  if (sortedOldestFirst.length === 0) return null;
  const i = sortedOldestFirst.findIndex((s) => s.id === currentId);
  if (i < 0) return sortedOldestFirst[sortedOldestFirst.length - 1]?.id ?? null;
  if (i > 0) return sortedOldestFirst[i - 1].id; // immediately-earlier epoch
  return sortedOldestFirst[1]?.id ?? sortedOldestFirst[0].id; // earliest → next-newer
}

export interface CompareSeedInput {
  surveyId: string;
  surveys: Survey[];
  compareA: string | null;
  compareB: string | null;
}

/** The A/B ids to write when compare is toggled ON. Idempotent: an already-set
 * A/B is preserved (the user's pick survives a toggle off→on), otherwise B seeds
 * to the current survey and A to the immediately-earlier epoch. Shared by both
 * activation entry points so their seeding never drifts. */
export function nextCompareSeed({
  surveyId,
  surveys,
  compareA,
  compareB,
}: CompareSeedInput): { a: string | null; b: string } {
  return {
    b: compareB ?? surveyId,
    a: compareA ?? defaultBeforeId(surveys, surveyId),
  };
}

/** Detects a TEMPORAL compare measurement: params whose `from` and `to` both
 * name explicit — and different — surveys via `survey_terrain` refs (what a
 * draw-to-compare commit writes, `crossSurveyRefs`). Returns the ordered
 * before/after survey ids, or null for a single-survey measurement (whose `to`
 * carries no survey_id and whose `from` is a base-surface ref). The comparison
 * card keys off this. */
export function temporalComparePair(
  params: Record<string, unknown> | null | undefined
): { aId: string; bId: string } | null {
  if (!params) return null;
  const from = params.from as Record<string, unknown> | undefined;
  const to = params.to as Record<string, unknown> | undefined;
  const aId =
    from && from.type === "survey_terrain" && typeof from.survey_id === "string"
      ? from.survey_id
      : null;
  const bId =
    to && to.type === "survey_terrain" && typeof to.survey_id === "string"
      ? to.survey_id
      : null;
  if (!aId || !bId || aId === bId) return null;
  return { aId, bId };
}

// ------------------------------------------------- progress sparkline (trajectory)
// Pure series math for the ComparisonCard's trajectory sparkline: the shape's
// cumulative volume change across ALL consecutive epochs (not just the A→B
// headline). The React orchestration (firing the per-pair instant estimates)
// lives in components/viewer/shell/hooks/useEpochSeries.ts; everything numeric
// stays here so it is unit-testable without React or Cesium.

/** One epoch on the trajectory. `cumulative` is the net volume change relative
 * to the earliest epoch (0 at index 0); null once an upstream gap breaks the
 * running total (see cumulativeEpochSeries). */
export interface EpochPoint {
  surveyId: string;
  date: string;
  cumulative: number | null;
}

/** A resolved epoch (non-null cumulative) — what the sparkline actually plots. */
export interface ComputedEpochPoint {
  surveyId: string;
  date: string;
  cumulative: number;
}

/** Net volume change for one consecutive-pair estimate. Prefers the server's
 * `net_change_m3`; falls back to `fill − cut` when net is absent (older diff
 * docs). Returns null when neither is derivable, so the pair becomes a gap in
 * the trajectory rather than a fabricated zero. */
export function netChangeFromMetrics(
  metrics: Record<string, number> | null | undefined
): number | null {
  if (!metrics) return null;
  const net = metrics.net_change_m3;
  if (typeof net === "number" && Number.isFinite(net)) return net;
  const fill = metrics.fill_volume_m3;
  const cut = metrics.cut_volume_m3;
  if (
    typeof fill === "number" &&
    Number.isFinite(fill) &&
    typeof cut === "number" &&
    Number.isFinite(cut)
  ) {
    return fill - cut;
  }
  return null;
}

/** Cumulative trajectory across consecutive epochs. `deltas[i]` is the net
 * change surveys[i] → surveys[i+1] (null = a pair the instant tier couldn't
 * serve). y0 = 0 at the earliest survey; the running total can't cross an
 * unknown delta, so a gap nulls that epoch AND every later one. That keeps the
 * resolved points a contiguous prefix (see validEpochPrefix), so the polyline
 * is never broken by an interior hole. */
export function cumulativeEpochSeries(
  surveys: readonly { id: string; survey_date: string }[],
  deltas: readonly (number | null)[]
): EpochPoint[] {
  const points: EpochPoint[] = [];
  let running: number | null = 0;
  for (let i = 0; i < surveys.length; i++) {
    if (i > 0) {
      const d = deltas[i - 1] ?? null;
      running = running !== null && d !== null ? running + d : null;
    }
    points.push({ surveyId: surveys[i].id, date: surveys[i].survey_date, cumulative: running });
  }
  return points;
}

/** The leading run of resolved epochs (cumulative non-null). Because a gap
 * nulls every later epoch, the resolved set is always a contiguous prefix, so
 * this both narrows the type and enforces "a hole ends the plotted line". */
export function validEpochPrefix(points: readonly EpochPoint[]): ComputedEpochPoint[] {
  const out: ComputedEpochPoint[] = [];
  for (const p of points) {
    if (p.cumulative === null) break;
    out.push({ surveyId: p.surveyId, date: p.date, cumulative: p.cumulative });
  }
  return out;
}

export interface SparklinePoint {
  x: number;
  y: number;
  value: number;
}

export interface SparklineGeometry {
  /** Per-epoch screen coordinates for the polyline + dots. */
  points: SparklinePoint[];
  /** Screen y of the value-0 baseline. */
  baselineY: number;
}

/** Map cumulative values to SVG coordinates in a `width`×`height` box. The
 * domain always includes 0 (the baseline) so a monotonic climb still shows its
 * zero origin at the bottom and a negative excursion pushes the baseline up.
 * `pad*` inset the dots from the edges. A degenerate (all-equal) domain
 * collapses to the vertical middle; a single point centers horizontally. */
export function sparklineGeometry(
  values: readonly number[],
  opts: { width: number; height: number; padX: number; padY: number }
): SparklineGeometry {
  const { width, height, padX, padY } = opts;
  const innerW = Math.max(1, width - 2 * padX);
  const innerH = Math.max(1, height - 2 * padY);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo;
  const n = values.length;
  const yFor = (v: number) => (span === 0 ? height / 2 : padY + ((hi - v) / span) * innerH);
  const xFor = (i: number) => (n <= 1 ? width / 2 : padX + (i / (n - 1)) * innerW);
  return {
    points: values.map((v, i) => ({ x: xFor(i), y: yFor(v), value: v })),
    baselineY: yFor(0),
  };
}
