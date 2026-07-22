"use client";

// Loads a project's sibling surveys, chronologically sorted, for the compare
// feature. Shared by the bottom SurveyCompare control, the FloatingToolbar's
// Compare split-button, and the comparison card so they agree on the epoch
// list and its date lookup. The render-phase reset (not an effect-setState) is
// the repo's approved adjustment pattern — an effect-setState would cascade a
// re-render (React Compiler is on). A null projectId is derived to the stable
// empty list rather than written from the effect, for the same reason.

import { useEffect, useMemo, useState } from "react";

import { listSurveys, type Survey } from "@/lib/api/assetSvc";
import { sortSurveysChronological } from "@/lib/viewer/compare";

/** Stable empty reference so the null-project path doesn't churn the memo. */
const EMPTY: Survey[] = [];

export interface CompareSurveys {
  /** null while loading; [] once loaded (or on failure / no project). */
  surveys: Survey[] | null;
  /** survey id → raw survey_date, for label resolution. */
  dateOf: Map<string, string>;
}

export function useCompareSurveys(projectId: string | null): CompareSurveys {
  const [surveys, setSurveys] = useState<Survey[] | null>(null);

  // Reset the moment projectId changes so a stale list never flashes.
  const [loadedProjectId, setLoadedProjectId] = useState(projectId);
  if (loadedProjectId !== projectId) {
    setLoadedProjectId(projectId);
    setSurveys(null);
  }

  useEffect(() => {
    if (!projectId) return; // nothing to load — derived to EMPTY below
    let cancelled = false;
    listSurveys(projectId)
      .then((res) => {
        if (cancelled) return;
        setSurveys(sortSurveysChronological(res.surveys || []));
      })
      .catch(() => {
        if (!cancelled) setSurveys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // A null project has nothing to compare; treat it as loaded-empty (stable
  // reference) so callers hide, without a synchronous setState in the effect.
  const effectiveSurveys = projectId ? surveys : EMPTY;

  const dateOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of effectiveSurveys ?? []) map.set(s.id, s.survey_date);
    return map;
  }, [effectiveSurveys]);

  return { surveys: effectiveSurveys, dateOf };
}
