"use client";

// Survey compare — the IN-MODE controls for the swipe comparison: a draggable
// vertical divider over the two epochs' orthos, plus a bottom-center pill with
// the A/B epoch pickers and an exit. It renders ONLY while compare mode is
// active; the FloatingToolbar's Compare tool is the sole entry point (it seeds
// A/B + flips the store), so there is no always-on launcher here. The split
// imagery layers live in useCompareLayers; this owns the divider + pill chrome.

import { useRef } from "react";
import { ArrowLeftRight, GripVertical, X } from "lucide-react";

import { type Survey } from "@/lib/api/assetSvc";
import { formatSurveyDate } from "@/lib/utils";
import { useViewerStore } from "@/lib/viewer/state/store";
import { useCompareSurveys } from "@/components/viewer/shell/hooks/useCompareSurveys";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Clamp the divider to a visible band so the handle never slips fully behind an
// edge (mirrors the hook's inert-when-no-split contract — this is purely UI).
const MIN_SPLIT = 0.05;
const MAX_SPLIT = 0.95;

/** Compact epoch picker: a letter tag + a date-labelled Select. */
function EpochPicker({
  tag,
  value,
  surveys,
  onChange,
}: {
  tag: string;
  value: string | null;
  surveys: Survey[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[#C97A4E]/20 text-[9px] font-semibold text-[#C97A4E]">
        {tag}
      </span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-[128px]" aria-label={`Survey ${tag}`}>
          <SelectValue placeholder="Select survey" />
        </SelectTrigger>
        <SelectContent>
          {surveys.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {formatSurveyDate(s.survey_date)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SurveyCompare({ projectId }: { projectId: string }) {
  const compareActive = useViewerStore((s) => s.compareActive);
  const compareA = useViewerStore((s) => s.compareA);
  const compareB = useViewerStore((s) => s.compareB);
  const splitPosition = useViewerStore((s) => s.splitPosition);
  const setCompareActive = useViewerStore((s) => s.setCompareActive);
  const setCompareA = useViewerStore((s) => s.setCompareA);
  const setCompareB = useViewerStore((s) => s.setCompareB);
  const setSplitPosition = useViewerStore((s) => s.setSplitPosition);

  const { surveys, dateOf } = useCompareSurveys(projectId);

  // Full-canvas measuring wrapper + a plain dragging flag (a ref, not state, so
  // dragging never re-renders — the store's splitPosition drives the UI).
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Nothing here unless compare mode is ON (the toolbar tool turns it on) and
  // the project actually has ≥2 epochs to compare.
  if (!compareActive || !surveys || surveys.length < 2) return null;

  const deactivate = () => setCompareActive(false);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const t = (e.clientX - rect.left) / rect.width;
    setSplitPosition(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, t)));
  };
  const endDrag = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const aDate = compareA ? dateOf.get(compareA) : undefined;
  const bDate = compareB ? dateOf.get(compareB) : undefined;

  return (
    <>
      {/* Split divider over the canvas. The wrapper fills the canvas and is
          click-through (pointer-events-none) so the camera stays usable; only
          the thin strip captures the pointer. */}
      <div ref={canvasRef} className="pointer-events-none absolute inset-0 z-20">
        {/* Epoch labels pinned to the top corners (A left, B right). */}
        {aDate && (
          <span className="absolute left-3 top-3 rounded-md border border-white/[0.08] bg-[#141417]/85 px-2 py-1 text-[11px] font-medium text-gray-200 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md">
            {formatSurveyDate(aDate)}
          </span>
        )}
        {bDate && (
          <span className="absolute right-3 top-3 rounded-md border border-white/[0.08] bg-[#141417]/85 px-2 py-1 text-[11px] font-medium text-gray-200 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md">
            {formatSurveyDate(bDate)}
          </span>
        )}
        {/* Draggable strip: a hairline + a round grab handle. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Compare divider"
          className="pointer-events-auto absolute inset-y-0 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
          style={{ left: `${splitPosition * 100}%` }}
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
        >
          <div className="h-full w-px bg-white/70 shadow-[0_0_6px_rgba(0,0,0,0.65)]" />
          <div className="absolute flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.14] bg-[#141417]/90 text-gray-200 shadow-[0_4px_16px_rgba(0,0,0,0.55)] backdrop-blur-md">
            <GripVertical size={15} />
          </div>
        </div>
      </div>

      {/* Bottom-center A/B pickers + exit — present only in compare mode. The
          toolbar's Compare tool is what turns the mode on; this is the in-mode
          epoch chooser, not a launcher. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#141417]/90 px-3 py-2 shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <EpochPicker tag="A" value={compareA} surveys={surveys} onChange={setCompareA} />
          <ArrowLeftRight size={13} className="shrink-0 text-gray-500" />
          <EpochPicker tag="B" value={compareB} surveys={surveys} onChange={setCompareB} />
          <div className="h-5 w-px bg-white/[0.08]" />
          <button
            type="button"
            aria-label="Exit compare"
            onClick={deactivate}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-100"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </>
  );
}
