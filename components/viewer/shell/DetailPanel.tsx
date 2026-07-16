"use client";

// Zone 5 — DetailPanel + DetailContent (viewer-shell §4.5, amended by the
// PIVOT 2026-07-16). `DetailContent` is the inner switch — MeasurePalette
// (`measure`) or FeatureInspector (`inspect`) plus the derived live readout and
// resolved inspector target. It is reused by TWO hosts:
//   • DetailPanel — the slide-in overlay, kept for NON-measure modules (a
//     feature picked on the survey module still inspects here).
//   • MeasureSidebar — the persistent RIGHT panel on the measure module, where
//     the pivot puts the selected-measurement detail beneath the list.
//
// The live readout + inspector target are derived HERE (not in ViewerCanvas) so
// the ~10 Hz draft mirror re-renders only this leaf, keeping ViewerCanvas off
// the per-vertex render path (§3.2). `draftMeasurement` is the just-drawn shape
// being named — it has no id in the measurements list, so it cannot live in the
// store's id-based selection (§3.3) and is passed as a prop from ViewerCanvas.

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { MeasurePalette, type LiveReadout } from "@/components/viewer/MeasurePalette";
import { FeatureInspector } from "@/components/viewer/FeatureInspector";
import {
  computeAreaSquareMeters,
  computeDistanceMeters,
  computeGrade,
  computePerimeterMeters,
} from "@/lib/viewer/measure";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

/** The inner detail switch, host-agnostic. `mode` is passed by the host (which
 * already reads `detailPanel` to decide whether to render it) so this leaf does
 * not double-subscribe. */
export function DetailContent({
  mode,
  draftMeasurement,
}: {
  mode: "measure" | "inspect";
  draftMeasurement: PanelMeasurement | null;
}) {
  const selection = useViewerStore((s) => s.selection);
  const isInspectingNew = useViewerStore((s) => s.isInspectingNew);
  const measurements = useViewerStore((s) => s.measurements);
  const saving = useViewerStore((s) => s.saving);
  const busyIds = useViewerStore((s) => s.busyIds);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? null);

  // Draft mirror + probe read at ~10 Hz — subscribing here isolates the churn.
  const probing = useViewerStore((s) => s.probing);
  const probePoint = useViewerStore((s) => s.probePoint);
  const drawMode = useViewerStore((s) => s.drawMode);
  const draft = useViewerStore((s) => s.draft);
  const activeDrawOpts = useViewerStore((s) => s.activeDrawOpts);

  const actions = useViewerActions();

  // Live palette readout — the ported measurement math over committed vertices
  // plus the rubber-band vertex (SurveyViewer :1977-1997).
  const readout = useMemo<LiveReadout>(() => {
    if (probing) return { mode: "probe", vertexCount: 0, point: probePoint };
    if (drawMode) {
      const pts = draft.hover ? [...draft.points, draft.hover] : draft.points;
      if (drawMode === "polygon") {
        return {
          mode: "polygon",
          vertexCount: draft.points.length,
          areaSquareMeters: computeAreaSquareMeters(pts),
          perimeterMeters: computePerimeterMeters(pts),
        };
      }
      return {
        mode: "polyline",
        vertexCount: draft.points.length,
        lengthMeters: computeDistanceMeters(pts),
        gradePercent: activeDrawOpts?.slope ? computeGrade(pts)?.percent : undefined,
      };
    }
    return { mode: "idle", vertexCount: 0 };
  }, [probing, probePoint, drawMode, draft, activeDrawOpts]);

  // Resolve the inspector target: a freshly-drawn draft (isInspectingNew), else
  // the selected measurement by id, else null.
  const inspectMeasurement = isInspectingNew
    ? draftMeasurement
    : selection?.kind === "measurement"
      ? measurements.find((m) => m.id === selection.measurementIds[0]) ?? null
      : null;
  const inspectFeature = selection?.kind === "feature" ? selection.feature ?? null : null;
  const busyId = inspectMeasurement?.id;

  if (mode === "measure") {
    return <MeasurePalette readout={readout} onClose={actions.cancelDraw} />;
  }
  return (
    <FeatureInspector
      measurement={inspectMeasurement}
      feature={inspectFeature}
      projectId={projectId}
      onClose={actions.cancelDraw}
      onSave={actions.saveMeasurement}
      onDelete={actions.removeMeasurement}
      onCompute={actions.triggerCompute}
      isNew={isInspectingNew}
      saving={saving}
      busy={busyId ? busyIds.has(busyId) : false}
    />
  );
}

/** Slide-in overlay host — kept for NON-measure modules (the pivot routes the
 * measure module's detail into MeasureSidebar instead, §PIVOT). Floating-surface
 * recipe (§8) at `right-3 top-3 bottom-8 w-[320px]`; springs in from the right
 * (§4.5). MUST NOT resize the canvas (D10) — it is `absolute` in the canvas cell. */
export function DetailPanel({ draftMeasurement }: { draftMeasurement: PanelMeasurement | null }) {
  const detailPanel = useViewerStore((s) => s.detailPanel);

  return (
    <AnimatePresence>
      {detailPanel && (
        // One stable key: the panel slides on open/close only; switching
        // measure ⇄ inspect swaps content in place without re-animating.
        <motion.div
          key="detail-panel"
          initial={{ x: 344, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 344, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="pointer-events-auto absolute right-3 top-3 bottom-8 z-20 flex w-[320px] flex-col overflow-y-auto rounded-xl border border-white/[0.06] bg-[#111114]/85 shadow-[0_4px_24px_rgba(0,0,0,0.5)] backdrop-blur-md"
        >
          <DetailContent mode={detailPanel} draftMeasurement={draftMeasurement} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
