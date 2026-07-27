"use client";

// Changes card (AI change-detection, P0 task 3). A floating analytics card —
// bottom-left of the canvas — that surfaces the current survey's loaded change
// set: the epoch pair, the server's headline cut / fill / net totals + threshold,
// a per-region list (class chip + area + volume, click to fly the camera to the
// region), and the scene-layer visibility toggle. Mirrors the ComparisonCard
// analytics panel's structure/style (rounded card, mono numbers, server-only
// values). Renders nothing until a change set is loaded (task 4: also on reload).
//
// Server is the source of numbers (§4): every figure is read from the loaded
// ChangeSet (manifest entry + parsed feature props); nothing is computed here.

import { EyeIcon, EyeOffIcon, GitCompareArrows, ArrowRight, Crosshair } from "lucide-react";

import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";
import { formatSurveyDate } from "@/lib/utils";
import {
  CHANGE_COLORS,
  summarizeChangeEntry,
  type ChangeClass,
} from "@/lib/viewer/changeDetect";

function fmtVolume(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} m³`;
}

function fmtSignedVolume(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} m³`;
}

function fmtArea(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²`;
}

/** cut → red, fill → blue (the scene layer's palette). */
function ClassChip({ cls }: { cls: ChangeClass }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `${CHANGE_COLORS[cls]}22`, color: CHANGE_COLORS[cls] }}
    >
      {cls}
    </span>
  );
}

export function ChangesCard() {
  const changeSet = useViewerStore((s) => s.changeSet);
  const changeLayerVisible = useViewerStore((s) => s.changeLayerVisible);
  const setChangeLayerVisible = useViewerStore((s) => s.setChangeLayerVisible);
  const compareA = useViewerStore((s) => s.compareA);
  const compareB = useViewerStore((s) => s.compareB);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? null);
  const currentDate = useViewerStore((s) => s.manifest?.survey.survey_date ?? null);

  const actions = useViewerActions();
  const { dateOf } = useCompareSurveys(projectId);

  // Nothing to show until a change set is loaded.
  if (!changeSet) return null;

  const { regionCount, cutVolumeM3, fillVolumeM3, netM3, thresholdM } = summarizeChangeEntry(
    changeSet.entry
  );

  // Epoch labels from the LOCAL compare slice (from_survey/to_survey are null in
  // P0) — the reference (A) and the current "to" survey (B ≈ current).
  const fromLabel = compareA && dateOf.get(compareA) ? formatSurveyDate(dateOf.get(compareA)!) : "Survey A";
  const toLabel =
    compareB && dateOf.get(compareB)
      ? formatSurveyDate(dateOf.get(compareB)!)
      : currentDate
        ? formatSurveyDate(currentDate)
        : "Current";

  const netColor = netM3 > 0 ? CHANGE_COLORS.fill : netM3 < 0 ? CHANGE_COLORS.cut : "#e5e7eb";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="pointer-events-auto absolute bottom-8 left-4 flex w-72 max-w-[calc(100%-2rem)] flex-col rounded-xl border border-[#C97A4E]/25 bg-[#111114]/90 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
        {/* Header — title + region count + visibility toggle. */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <GitCompareArrows size={14} className="shrink-0 text-[#C97A4E]" />
          <span className="text-xs font-medium text-gray-100">Changes</span>
          <span className="rounded bg-white/[0.06] px-1.5 py-px text-[10px] text-gray-300">
            {regionCount} region{regionCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            aria-label={changeLayerVisible ? "Hide change layer" : "Show change layer"}
            aria-pressed={changeLayerVisible}
            onClick={() => setChangeLayerVisible(!changeLayerVisible)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-100"
          >
            {changeLayerVisible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
          </button>
        </div>

        <div className="flex flex-col gap-2 px-3 py-2.5">
          {/* Epoch pair. */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-200">{fromLabel}</span>
            <ArrowRight size={11} className="shrink-0 text-gray-500" />
            <span className="text-gray-200">{toLabel}</span>
            <span className="ml-auto text-[10px] text-gray-500">≥ {thresholdM} m</span>
          </div>

          {/* Server totals. */}
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-mono text-[12px]">
            <span className="text-gray-400">
              cut <span style={{ color: CHANGE_COLORS.cut }}>{fmtVolume(cutVolumeM3)}</span>
            </span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-400">
              fill <span style={{ color: CHANGE_COLORS.fill }}>{fmtVolume(fillVolumeM3)}</span>
            </span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-400">
              net <span style={{ color: netColor }}>{fmtSignedVolume(netM3)}</span>
            </span>
          </div>
        </div>

        {/* Per-region list — click a row to fly the camera to that region. */}
        {changeSet.features.length > 0 && (
          <div className="max-h-52 overflow-y-auto border-t border-white/[0.06]">
            {changeSet.features.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => actions.flyToChangeRegion(i)}
                className="group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
              >
                <ClassChip cls={f.properties.class} />
                <span className="font-mono text-[11px] text-gray-300">
                  {fmtVolume(f.properties.volume_m3)}
                </span>
                <span className="font-mono text-[10px] text-gray-500">
                  {fmtArea(f.properties.area_m2)}
                </span>
                <Crosshair
                  size={12}
                  className="ml-auto shrink-0 text-gray-600 transition-colors group-hover:text-[#C97A4E]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
