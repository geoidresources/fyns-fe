"use client";

// Comparison card (Compare Mode, Task 3) — the inspector headline for a
// TEMPORAL compare measurement (a polygon drawn while compare was active, whose
// params.from/to name two different surveys via survey_terrain refs). Renders
//   [A survey_date] → [B survey_date]   cut X m³ · fill Y m³ · net Δ m³
// pulling cut_volume_m3 / fill_volume_m3 / net_change_m3 from the result doc.
// Δ (net) is green when positive (net fill / gain) and red when negative (net
// cut / loss). Dates resolve from the project's survey list. Mounted by
// FeatureInspector ONLY when temporalComparePair(params) is truthy, so the
// survey fetch never fires for ordinary single-survey measurements.

import { ArrowRight, CalendarClock } from "lucide-react";

import type { Measurement } from "@/lib/api/assetSvc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";
import { metricsOf, resultForKind } from "@/lib/viewer/calc";
import { formatSurveyDate } from "@/lib/utils";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";

/** Server-computed volumes only — the frontend renders, never derives. */
function formatVolume(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} m³`;
}

/** Signed net change, kept explicit so a gain reads "+…" against a loss "−…". */
function formatSignedVolume(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} m³`;
}

export function ComparisonCard({
  measurement,
  projectId,
  pair,
}: {
  measurement: Measurement | PanelMeasurement;
  projectId: string | null;
  /** The ordered before/after survey ids (from temporalComparePair). */
  pair: { aId: string; bId: string };
}) {
  const { dateOf } = useCompareSurveys(projectId);

  const aDate = dateOf.get(pair.aId);
  const bDate = dateOf.get(pair.bId);

  const metrics = metricsOf(resultForKind(measurement));
  const cut = metrics.cut_volume_m3;
  const fill = metrics.fill_volume_m3;
  const net = metrics.net_change_m3;
  const hasResult =
    typeof cut === "number" || typeof fill === "number" || typeof net === "number";

  const netColor =
    typeof net !== "number" || net === 0
      ? "text-gray-100"
      : net > 0
        ? "text-green-400"
        : "text-red-400";

  return (
    <div className="rounded-lg border border-[#C97A4E]/25 bg-[#19191d] p-3">
      {/* A → B epoch header. */}
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <CalendarClock size={13} className="shrink-0 text-[#C97A4E]" />
        <span className="text-gray-200">{aDate ? formatSurveyDate(aDate) : "Survey A"}</span>
        <ArrowRight size={12} className="shrink-0 text-gray-500" />
        <span className="text-gray-200">{bDate ? formatSurveyDate(bDate) : "Survey B"}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-500">Compare</span>
      </div>

      {hasResult ? (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-mono text-[13px]">
          <span className="text-gray-400">
            cut <span className="text-gray-100">{formatVolume(cut)}</span>
          </span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">
            fill <span className="text-gray-100">{formatVolume(fill)}</span>
          </span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">
            net <span className={netColor}>{formatSignedVolume(net)}</span>
          </span>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          Awaiting compute — cut / fill / net will appear when the diff finishes.
        </p>
      )}
    </div>
  );
}
