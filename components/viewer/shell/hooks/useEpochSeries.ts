"use client";

// Trajectory-series orchestration for the ComparisonCard sparkline. Given a
// temporal-compare measurement (its geometry is fixed; only the surfaces vary)
// and the project's chronological survey list, this fires one instant estimate
// per CONSECUTIVE epoch pair — re-diffing the SAME shape against each
// (surveys[i], surveys[i+1]) — and folds the per-pair net changes into a
// cumulative "relative volume over time" series.
//
// Inert until asked: it only fetches when `enabled` (the card is showing a
// temporal compare) AND there are ≥3 surveys (≥2 pairs — the sparkline's whole
// point over the A→B headline). The estimates run in parallel via
// Promise.allSettled; a rejected/fallback pair becomes a gap (null) and the
// others still land. A cancelled flag guards the async write against races.
//
// State discipline (React Compiler is on): the ONLY setState is the async
// setDeltas inside the settle callback (a real side effect, like
// useCompareSurveys' listSurveys().then). `loading` is DERIVED, never stored —
// a stored loading flag would need a synchronous setState in the effect body
// (a cascading render). A render-phase reset drops the stale series the instant
// the measurement or epoch set changes, so no prior trajectory flashes.

import { useEffect, useMemo, useState } from "react";

import { estimateMeasurement, type Survey } from "@/lib/api/assetSvc";
import { crossSurveyRefs, LEAN_RENDER } from "@/lib/viewer/calc";
import {
  cumulativeEpochSeries,
  netChangeFromMetrics,
  validEpochPrefix,
  type ComputedEpochPoint,
} from "@/lib/viewer/compare";

/** ≥3 surveys ⇒ ≥2 consecutive pairs ⇒ a trajectory worth more than the A→B
 * headline. Below this the card shows only the headline. */
const MIN_SURVEYS = 3;

export interface EpochSeriesState {
  /** True while the consecutive-pair estimates are in flight. */
  loading: boolean;
  /** The resolved cumulative trajectory (contiguous prefix), or [] when fewer
   * than two epochs came back — the caller then renders nothing. */
  points: ComputedEpochPoint[];
}

export function useEpochSeries({
  surveyId,
  measurementId,
  surveys,
  enabled,
}: {
  /** The survey the measurement lives on (all estimate calls route through it). */
  surveyId: string;
  /** The temporal-compare measurement's id; null keeps the hook inert. */
  measurementId: string | null;
  /** Project surveys, chronological (from useCompareSurveys); null = loading. */
  surveys: Survey[] | null;
  /** Only fetch when the card is showing a temporal compare. */
  enabled: boolean;
}): EpochSeriesState {
  // Per-consecutive-pair net changes (null = a pair we couldn't estimate);
  // null overall = not resolved yet (⇒ loading while active).
  const [deltas, setDeltas] = useState<(number | null)[] | null>(null);

  // A stable identity for the work: the measurement plus the ordered epoch ids.
  const epochIds = useMemo(() => (surveys ? surveys.map((s) => s.id).join(",") : ""), [surveys]);
  const active = enabled && !!measurementId && !!surveys && surveys.length >= MIN_SURVEYS;

  // Render-phase reset (the repo's approved adjustment pattern): a new
  // measurement or a changed epoch set invalidates the trajectory synchronously,
  // so the memo below never plots a stale prefix before the effect refetches.
  const workKey = `${measurementId ?? ""}|${epochIds}`;
  const [seenKey, setSeenKey] = useState(workKey);
  if (seenKey !== workKey) {
    setSeenKey(workKey);
    setDeltas(null);
  }

  useEffect(() => {
    if (!active || !surveys || !measurementId) return;
    let cancelled = false;

    const pairs: Array<[Survey, Survey]> = [];
    for (let i = 0; i < surveys.length - 1; i++) pairs.push([surveys[i], surveys[i + 1]]);

    Promise.allSettled(
      pairs.map(([a, b]) =>
        estimateMeasurement(surveyId, measurementId, {
          params: { ...crossSurveyRefs(a.id, b.id), render: LEAN_RENDER },
        })
      )
    ).then((settled) => {
      if (cancelled) return;
      setDeltas(
        settled.map((r) => (r.status === "fulfilled" ? netChangeFromMetrics(r.value.metrics) : null))
      );
    });

    return () => {
      cancelled = true;
    };
  }, [active, surveys, surveyId, measurementId]);

  const points = useMemo<ComputedEpochPoint[]>(() => {
    if (!active || !surveys || !deltas) return [];
    const prefix = validEpochPrefix(cumulativeEpochSeries(surveys, deltas));
    // Two resolved epochs is the minimum that reads as a trajectory (0 → Δ).
    return prefix.length >= 2 ? prefix : [];
  }, [active, surveys, deltas]);

  // Derived: in flight whenever the card is active but the settle hasn't landed.
  return { loading: active && deltas === null, points };
}
