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

import { ArrowRight, CalendarClock, TrendingUp } from "lucide-react";

import type { Measurement } from "@/lib/api/assetSvc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";
import { metricsOf, resultForKind } from "@/lib/viewer/calc";
import { sparklineGeometry, type ComputedEpochPoint } from "@/lib/viewer/compare";
import { formatSurveyDate } from "@/lib/utils";
import { useViewerStore } from "@/lib/viewer/state/store";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";
import { useEpochSeries } from "@/components/viewer/shell/hooks/useEpochSeries";

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

// Hand-rolled SVG dimensions (logical units; the element scales to the panel
// width via viewBox + w-full). Kept small so the sparkline reads as a caption,
// not a chart.
const SPARK_W = 200;
const SPARK_H = 32;
const SPARK_PAD_X = 8;
const SPARK_PAD_Y = 6;

/** Compact trajectory sparkline: the shape's cumulative volume change across all
 * consecutive epochs, computed by useEpochSeries. Renders a shimmer while the
 * per-pair estimates are in flight; renders NOTHING once settled with fewer than
 * two resolved epochs (the A→B headline already stands alone — no error state). */
function EpochSparkline({ loading, points }: { loading: boolean; points: ComputedEpochPoint[] }) {
  // Settled but not enough to draw a trajectory → defer entirely to the headline.
  if (!loading && points.length < 2) return null;

  if (points.length < 2) {
    // In flight, nothing resolved yet — a subtle "computing" placeholder.
    return (
      <div className="mt-2.5 border-t border-white/[0.08] pt-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-gray-500">
          <TrendingUp size={11} className="text-[#C97A4E]" />
          <span className="animate-pulse">Computing trend…</span>
        </div>
        <div className="h-8 w-full animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  const geom = sparklineGeometry(
    points.map((p) => p.cumulative),
    { width: SPARK_W, height: SPARK_H, padX: SPARK_PAD_X, padY: SPARK_PAD_Y }
  );
  const gp = geom.points;
  const first = gp[0];
  const last = gp[gp.length - 1];
  const linePts = gp.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    `M ${first.x.toFixed(1)},${geom.baselineY.toFixed(1)} ` +
    gp.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L ${last.x.toFixed(1)},${geom.baselineY.toFixed(1)} Z`;

  const latest = points[points.length - 1].cumulative;
  const latestColor =
    latest > 0 ? "text-green-400" : latest < 0 ? "text-red-400" : "text-gray-300";

  return (
    <div className="mt-2.5 border-t border-white/[0.08] pt-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <TrendingUp size={11} className="shrink-0 text-[#C97A4E]" />
          Volume change across {points.length} surveys
        </span>
        <span className={`font-mono text-[11px] ${latestColor}`}>{formatSignedVolume(latest)}</span>
      </div>

      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Cumulative volume change across ${points.length} surveys, latest ${formatSignedVolume(latest)}`}
      >
        {/* Faint accent area under the trajectory, referenced to the y=0 baseline. */}
        <path d={areaPath} fill="#C97A4E" fillOpacity={0.12} />
        {/* The value-0 baseline (relative-volume origin). */}
        <line
          x1={SPARK_PAD_X}
          y1={geom.baselineY}
          x2={SPARK_W - SPARK_PAD_X}
          y2={geom.baselineY}
          stroke="#ffffff"
          strokeOpacity={0.15}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        {/* Trajectory polyline in the brand accent. */}
        <polyline
          points={linePts}
          fill="none"
          stroke="#C97A4E"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* One dot per epoch, coloured by sign (gain green / loss red / origin accent). */}
        {gp.map((p, i) => (
          <circle
            key={points[i].surveyId}
            cx={p.x}
            cy={p.y}
            r={2.2}
            fill={p.value > 0 ? "#4ade80" : p.value < 0 ? "#f87171" : "#C97A4E"}
          />
        ))}
      </svg>

      <div className="mt-0.5 flex items-baseline justify-between text-[9px] text-gray-600">
        <span>{formatSurveyDate(points[0].date)}</span>
        <span>{formatSurveyDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
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
  const { surveys, dateOf } = useCompareSurveys(projectId);
  const surveyId = useViewerStore((s) => s.surveyId);

  // Trajectory across ALL consecutive epochs (inert until ≥3 surveys exist).
  const trajectory = useEpochSeries({
    surveyId,
    measurementId: measurement.id,
    surveys,
    enabled: true, // the card only mounts for a temporal compare
  });

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

      {/* Trajectory sparkline — the pile's relative volume across every epoch,
          not just A→B. Self-gating: renders nothing for &lt;3 surveys or when
          fewer than two epochs resolve. */}
      <EpochSparkline loading={trajectory.loading} points={trajectory.points} />
    </div>
  );
}
