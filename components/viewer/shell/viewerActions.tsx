"use client";

// Viewer action seam (viewer-shell §3.6). The zone hosts (TreePanel, TopToolbar,
// DetailPanel) are laid out as siblings in the grid, but the imperative
// Cesium-bound callbacks they invoke (`handleToggle`, `startDraw`, `compute`,
// …) close over the viewer refs that live in `ViewerCanvas` (§2.3 rule 4 — Cesium
// handles never enter the Zustand store). `ViewerCanvas` builds these callbacks
// once, memoises them, and publishes them here so descendants read them by
// `useViewerActions()`. DATA still flows through the store selectors (§3.6); this
// context carries only the action surface that needs the refs.
//
// Rationale: the pure store actions (`setLayerVisible`, `startDraw`, …) mutate
// serialisable state only; the versions here wrap them with the scene side
// effects (terrain swaps, lazy GeoJSON loads, draft-entity lifecycle) that the
// relocation keeps imperative (§2.3 — the layer/draw callbacks stay callbacks,
// only the *effects* became hooks).

import { createContext, useContext } from "react";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

export interface ViewerActions {
  // Draw / probe lifecycle. Probe/point still ride startProbe (legacy) until the
  // machine gains a probing mode; line/polygon draw + all edit are v2 (below).
  startProbe: (toolKey?: string) => void;
  cancelDraw: () => void;
  /** Edit the SELECTED measurement's geometry (v2 edit plane): EDIT_SHAPE seeds
   * the machine → drag/insert/delete handles; Enter / "Done" / double-click PATCHes. */
  editGeometry: () => void;
  /** Commit the active geometry edit (Enter / "Done editing"); blocks a
   * self-intersecting shape with a toast. */
  commitGeometry: () => void;
  /** Redraw the SELECTED measurement: place a fresh outline (REDRAW_SHAPE) over
   * the still-visible original as a tracing reference; commit PATCHes it in place. */
  redrawGeometry: () => void;

  // Measurement CRUD + framing.
  selectMeasurementRow: (m: PanelMeasurement) => void;
  /** `override` is a partial params object (e.g. {volume_method, from, to})
   * deep-merged + persisted by the backend before dispatch (§6.1). */
  triggerCompute: (id: string, override?: Record<string, unknown>) => void;
  removeMeasurement: (id: string) => void;
  /** PROMOTES a draw-first draft: PATCH {name, draft:false} (draft-first flow —
   * the row/geometry/params/result already exist). */
  saveMeasurement: (id: string, name: string) => void;
  /** Generic partial update (rename / re-kind / units / style): PATCH + refresh.
   * `params` deep-merges server-side (§6.1). Resolves when the list refreshed. */
  patchMeasurement: (
    id: string,
    body: { name?: string; folder?: string; kind?: string; params?: Record<string, unknown>; draft?: boolean }
  ) => Promise<void>;
  /** Download the measurement table as GeoJSON (geometry + metrics). */
  exportMeasurements: () => void;
  /** Download the measurement table as RFC-4180 CSV (one metric column per key). */
  exportMeasurementsCsv: () => void;
  /** Open the printable, client-facing Site Report overlay. */
  openSiteReport: () => void;

  // Layer / view interaction (scene side effects live in ViewerCanvas).
  handleToggle: (key: string) => void;
  handleOpacity: (key: string, opacity: number) => void;
  handleToggleDesign: (key: string) => void;
  setTerrainExaggeration: (value: number) => void;
  setBaseMap: (value: string) => void;
  handleColorMapChange: (value: string) => void;
  handleShadingChange: (value: string) => void;
  handleContourIntervalChange: (intervalM: number) => void;
  /** Patch a live cut/fill layer's colormap settings and re-colorize in place. */
  handleCutfillSettings: (
    key: string,
    patch: Partial<import("@/lib/viewer/cutfillColormap").CutFillSettings>
  ) => void;
  handleToggleImages: () => void;
  handleToggleGcps: () => void;
  handleToggleDigitalTwin: () => void;
  handleSunLightingChange: (enabled: boolean, hour: number) => void;
  setVolumeMethod: (value: string) => void;
}

const ViewerActionsContext = createContext<ViewerActions | null>(null);

export const ViewerActionsProvider = ViewerActionsContext.Provider;

/** Read the imperative viewer actions (§3.6). Must be under a `ViewerCanvas`. */
export function useViewerActions(): ViewerActions {
  const ctx = useContext(ViewerActionsContext);
  if (ctx === null) {
    throw new Error("useViewerActions must be used within a ViewerCanvas");
  }
  return ctx;
}
