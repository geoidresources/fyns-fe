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
