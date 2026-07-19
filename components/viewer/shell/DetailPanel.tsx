"use client";

// Zone 5 — DetailPanel + DetailContent (viewer-shell §4.5). `DetailContent` is
// the inner switch — MeasurePalette (`measure`) or FeatureInspector (`inspect`)
// plus the derived live readout and resolved inspector target. DetailPanel is
// a draggable floating overlay. Collapse hides the body but keeps the same
// 320px chrome + title row mounted, so width/position do not jump.
//
// The live readout + inspector target are derived HERE (not in ViewerCanvas) so
// the ~10 Hz draft mirror re-renders only this leaf, keeping ViewerCanvas off
// the per-vertex render path (§3.2). DRAFT-FIRST (2026-07-16): a finished shape
// is persisted immediately as a draft row, so the inspector target is always
// id-based store selection — the old draftMeasurement prop threading is gone.

import React, { useMemo, useRef } from "react";
import { AnimatePresence, motion, useDragControls, useIsPresent } from "framer-motion";

import { estimateKey, useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { MeasurePalette, type LiveReadout } from "@/components/viewer/MeasurePalette";
import { FeatureInspector } from "@/components/viewer/FeatureInspector";
import {
  computeAreaSquareMeters,
  computeDistanceMeters,
  computeGrade,
  computePerimeterMeters,
} from "@/lib/viewer/measure";

const PANEL_WIDTH = 320;

const PANEL_SURFACE =
  "border border-white/[0.06] bg-[#111114]/85 shadow-[0_4px_24px_rgba(0,0,0,0.5)] backdrop-blur-md";

function useLiveReadout(): LiveReadout {
  const probing = useViewerStore((s) => s.probing);
  const probePoint = useViewerStore((s) => s.probePoint);
  const drawMode = useViewerStore((s) => s.drawMode);
  const draft = useViewerStore((s) => s.draft);
  const activeDrawOpts = useViewerStore((s) => s.activeDrawOpts);

  return useMemo<LiveReadout>(() => {
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
}

/** The inner detail switch, host-agnostic. `mode` is passed by the host (which
 * already reads `detailPanel` to decide whether to render it) so this leaf does
 * not double-subscribe. */
export function DetailContent({
  mode,
  readout,
  onCollapse,
  collapsed,
}: {
  mode: "measure" | "inspect";
  readout: LiveReadout;
  onCollapse?: () => void;
  collapsed?: boolean;
}) {
  const selection = useViewerStore((s) => s.selection);
  const measurements = useViewerStore((s) => s.measurements);
  const saving = useViewerStore((s) => s.saving);
  const busyIds = useViewerStore((s) => s.busyIds);
  const estimates = useViewerStore((s) => s.estimates);
  const clearEstimate = useViewerStore((s) => s.clearEstimate);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? null);

  const actions = useViewerActions();

  // Resolve the inspector target: the selected measurement by id (drafts are
  // rows too, draft-first), else null.
  const inspectMeasurement =
    selection?.kind === "measurement"
      ? measurements.find((m) => m.id === selection.measurementIds[0]) ?? null
      : null;
  const inspectFeature = selection?.kind === "feature" ? selection.feature ?? null : null;
  const busyId = inspectMeasurement?.id;
  // The instant estimate for the inspected measurement's CURRENT kind (the type
  // dropdown is a per-kind view switch); superseded once the worker doc lands.
  const estimate = inspectMeasurement
    ? estimates[estimateKey(inspectMeasurement.id, inspectMeasurement.kind)] ?? null
    : null;

  if (mode === "measure") {
    return (
      <MeasurePalette
        readout={readout}
        onClose={actions.cancelDraw}
        onCollapse={onCollapse}
        collapsed={collapsed}
      />
    );
  }
  return (
    <FeatureInspector
      measurement={inspectMeasurement}
      feature={inspectFeature}
      projectId={projectId}
      onClose={actions.cancelDraw}
      onCollapse={onCollapse}
      collapsed={collapsed}
      onSave={actions.saveMeasurement}
      onPatch={actions.patchMeasurement}
      onDelete={actions.removeMeasurement}
      onCompute={actions.triggerCompute}
      onEditGeometry={actions.editGeometry}
      estimate={estimate}
      onClearEstimate={
        inspectMeasurement ? () => clearEstimate(inspectMeasurement.id) : undefined
      }
      saving={saving}
      busy={busyId ? busyIds.has(busyId) : false}
    />
  );
}

/** The keyed AnimatePresence child, extracted so useIsPresent (which must be
 * called INSIDE the presence boundary) can drive pointer-events from React
 * presence state — synchronously "none" the moment exit begins (the fading
 * ghost must not swallow canvas clicks) and "auto" again on (re)entry. This
 * deliberately does NOT ride the animation targets: non-animatable values
 * there apply on driver frames, and a missed/throttled frame would leave an
 * invisible panel blocking the canvas — or a reopened one inert. */
function DetailPanelSurface({
  mode,
  readout,
  collapsed,
  onToggleCollapse,
  constraintsRef,
}: {
  mode: "measure" | "inspect";
  readout: LiveReadout;
  collapsed: boolean;
  onToggleCollapse: () => void;
  constraintsRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dragControls = useDragControls();
  const isPresent = useIsPresent();

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={constraintsRef}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      style={{ width: PANEL_WIDTH, pointerEvents: isPresent ? "auto" : "none" }}
      className={`absolute right-3 top-3 flex flex-col rounded-xl ${PANEL_SURFACE} ${
        collapsed ? "" : "max-h-[calc(100%-1.5rem)]"
      }`}
    >
      {/* Centered drag highlighter — only grab target for move. */}
      <div className="flex shrink-0 items-center justify-center px-2 pt-1.5 pb-0.5">
        <button
          type="button"
          aria-label="Drag to move"
          onPointerDown={(e) => dragControls.start(e)}
          className="h-1.5 w-10 cursor-grab rounded-full bg-white/20 transition-colors hover:bg-white/35 active:cursor-grabbing active:bg-white/45"
        />
      </div>

      <div className={collapsed ? "shrink-0" : "min-h-0 flex-1 overflow-y-auto"}>
        <DetailContent
          mode={mode}
          readout={readout}
          collapsed={collapsed}
          onCollapse={onToggleCollapse}
        />
      </div>
    </motion.div>
  );
}

/** Draggable floating overlay. Collapse only drops the body — width stays
 * 320px and the title row stays mounted. MUST NOT resize the canvas (D10). */
export function DetailPanel() {
  const detailPanel = useViewerStore((s) => s.detailPanel);
  const collapsed = useViewerStore((s) => s.detailPanelCollapsed);
  const setCollapsed = useViewerStore((s) => s.setDetailPanelCollapsed);

  const readout = useLiveReadout();
  const constraintsRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={constraintsRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <AnimatePresence>
        {detailPanel && (
          <DetailPanelSurface
            key="detail-panel"
            mode={detailPanel}
            readout={readout}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
            constraintsRef={constraintsRef}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
