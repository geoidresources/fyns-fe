"use client";

// Per-mount viewer store (viewer-shell §3). One vanilla Zustand store is
// created per `ViewerShell` mount and shared through React context; zones
// subscribe with precise selectors via `useViewerStore(selector)`, and the URL
// writer subscribes out-of-React through `store.subscribe` (§5.4). Survey
// switches remount the page, so a per-mount store is semantically identical to
// today's full unmount (§3.1).
//
// Containment (§3.2, normative): serializable-ish UI/domain state only. Cesium
// handles (Viewer / Entity / DataSource / ImageryLayer / handlers / tilesets)
// MUST NOT enter this store — they live in refs inside `CesiumViewerProvider`
// and the moved effect hooks. Immutable value objects (`Cartesian3` draft
// points) MAY be stored, but are replaced, never mutated.

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  createContext,
  createElement,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { Cartesian3 } from "cesium";

import type { Manifest, Measurement } from "@/lib/api/assetSvc";
import type { Project } from "@/lib/api/userSvc";
import type { LayerControl, DesignControl } from "@/components/viewer/LayerPanel";
import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";
import type { LngLatHeight } from "@/lib/viewer/measure";

// ------------------------------------------------------------------ value types

export type ModuleKey =
  | "measure"
  | "survey"
  | "designs"
  | "media"
  | "outputs"
  | "hydro"
  | "crew"
  | "machines";

/** Camera pose in the URL/bookmark/preset serialization format: degrees,
 * meters, ellipsoidal height. Serde lives in `lib/viewer/camera.ts` (§5.3). */
export interface CameraPose {
  lon: number;
  lat: number;
  h: number;
  heading: number;
  pitch: number;
  roll: number;
}

/** Unified selection (replaces SurveyViewer's split
 * selectedMeasurement/pickedFeature). Phase 1 selects at most one measurement
 * (§5.2), but the id list is plural for multi-select in later phases. */
export interface Selection {
  kind: "measurement" | "feature";
  measurementIds: string[];
  feature?: Record<string, unknown>;
}

export interface ViewSettings {
  baseMap: "satellite" | "streets" | "dark";
  colorMap: string;
  shading: string;
  contourIntervalM: number | null;
  terrainExaggeration: number;
  digitalTwinEnabled: boolean;
  sunLightingEnabled: boolean;
  sunHour: number;
  volumeMethod: string;
  // Calculation config picked in the right panel (RE-PIVOT): what to compute
  // (calcType → the saved measurement's kind, lib/viewer/calc.ts) and the
  // base-method inputs consumed at save/compute time. calcType null = the
  // geometry's default calc.
  calcType: string | null;
  refMode: "custom" | "lowest_vertex" | "highest_vertex";
  refElevation: number | null;
  baseDesignId: string | null;
}

/** Field-wise URL restore payload (§5.6). The 1.4 codec parses the query
 * string into this shape and hands it to `applyUrlState`; every field is
 * optional so a malformed param drops out without clobbering the rest. */
export interface UrlState {
  camera?: CameraPose | null;
  module?: ModuleKey;
  measurementIds?: string[];
  layerVisibility?: Record<string, boolean>;
  baseMap?: ViewSettings["baseMap"];
}

// ------------------------------------------------------------------ state shape

/** Domain + UI state (the serializable-ish half, §3.2). */
export interface ViewerShellData {
  surveyId: string;
  hydrated: boolean;

  activeModule: ModuleKey;
  treePanelOpen: boolean;
  detailPanel: "measure" | "inspect" | null;

  activeToolKey: string | null;
  drawMode: DrawMode | null;
  activeDrawOpts: DrawOptions | null;
  activeTemplateId: string | null;
  probing: boolean;
  probePoint: LngLatHeight | null;

  draft: { points: Cartesian3[]; hover: Cartesian3 | null };

  selection: Selection | null;
  isInspectingNew: boolean;
  /** Transient fly-to intent set by `selectMeasurement({fly})`; the
   * ViewerCanvas framing hook (1.3c) consumes it via `clearPendingFly`. Kept
   * as a plain id (not a Cesium handle) so it honors §3.2 containment. */
  pendingFlyToId: string | null;

  cameraPose: CameraPose | null;

  manifest: Manifest | null;
  manifestError: string | null;
  project: Project | null;

  measurements: Measurement[];
  layerControls: LayerControl[];
  designControls: DesignControl[];

  busyIds: Set<string>;
  saving: boolean;
  measurementSearch: string;
  searchingMeasurements: boolean;

  view: ViewSettings;
}

/** The single mutation surface (§3.3). */
export interface ViewerShellActions {
  setActiveModule: (module: ModuleKey) => void;
  setTreePanelOpen: (open: boolean) => void;

  startDraw: (mode: DrawMode, opts?: DrawOptions) => void;
  startProbe: (toolKey?: string) => void;
  cancelDraw: () => void;
  setActiveTemplateId: (id: string | null) => void;

  selectMeasurement: (id: string, opts?: { fly?: boolean }) => void;
  selectFeature: (props: Record<string, unknown>) => void;
  clearSelection: () => void;
  clearPendingFly: () => void;

  openDetail: (mode: "measure" | "inspect") => void;
  closeDetail: () => void;

  setLayerVisible: (key: string, visible: boolean) => void;
  setLayerOpacity: (key: string, opacity: number) => void;
  setView: (patch: Partial<ViewSettings>) => void;
  setCameraPose: (pose: CameraPose | null) => void;

  applyUrlState: (u: UrlState) => void;
  markHydrated: () => void;

  // Data actions — the mechanical write-side of the SurveyViewer effect hooks
  // moved in 1.3c (§2.3). Bodies stay trivial setters so the store remains the
  // single mutation surface; the async/Cesium work stays in the hooks.
  setManifest: (manifest: Manifest | null) => void;
  setManifestError: (error: string | null) => void;
  setProject: (project: Project | null) => void;
  setMeasurements: (measurements: Measurement[]) => void;
  setLayerControls: (layers: LayerControl[]) => void;
  setDesignControls: (designs: DesignControl[]) => void;
  setBusy: (id: string, busy: boolean) => void;
  setSaving: (saving: boolean) => void;
  setMeasurementSearch: (search: string) => void;
  setSearchingMeasurements: (searching: boolean) => void;
  setDraft: (points: Cartesian3[], hover: Cartesian3 | null) => void;
  setProbePoint: (point: LngLatHeight | null) => void;
  setIsInspectingNew: (isNew: boolean) => void;
}

export type ViewerShellState = ViewerShellData & ViewerShellActions;

// ------------------------------------------------------------------ defaults

/** Initial data values. View-setting defaults mirror SurveyViewer's current
 * useState seeds so 1.3c re-parents without behavior churn. */
function defaultData(surveyId: string): ViewerShellData {
  return {
    surveyId,
    hydrated: false,

    activeModule: "measure",
    treePanelOpen: true,
    detailPanel: null,

    activeToolKey: null,
    drawMode: null,
    activeDrawOpts: null,
    activeTemplateId: null,
    probing: false,
    probePoint: null,

    draft: { points: [], hover: null },

    selection: null,
    isInspectingNew: false,
    pendingFlyToId: null,

    cameraPose: null,

    manifest: null,
    manifestError: null,
    project: null,

    measurements: [],
    layerControls: [],
    designControls: [],

    busyIds: new Set<string>(),
    saving: false,
    measurementSearch: "",
    searchingMeasurements: false,

    view: {
      baseMap: "satellite",
      colorMap: "None",
      shading: "None",
      contourIntervalM: null,
      terrainExaggeration: 1,
      digitalTwinEnabled: false,
      sunLightingEnabled: false,
      sunHour: 12,
      volumeMethod: "smart-base",
      calcType: null,
      refMode: "lowest_vertex",
      refElevation: null,
      baseDesignId: null,
    },
  };
}

// ------------------------------------------------------------------ store factory

export function createViewerStore(
  surveyId: string,
  seed?: Partial<ViewerShellData>
): StoreApi<ViewerShellState> {
  const store = createStore<ViewerShellState>((set, get) => ({
    ...defaultData(surveyId),

    setActiveModule: (module) => set({ activeModule: module }),
    setTreePanelOpen: (open) => set({ treePanelOpen: open }),

    // Module switching MUST NOT cancel an active draw (§4.1) — startDraw is the
    // only entry that touches drawMode/activeDrawOpts.
    startDraw: (mode, opts) =>
      set({
        drawMode: mode,
        activeDrawOpts: opts ?? null,
        activeToolKey: opts?.toolKey ?? null,
        probing: false,
        probePoint: null,
        draft: { points: [], hover: null },
      }),

    startProbe: (toolKey) =>
      set({
        probing: true,
        probePoint: null,
        drawMode: null,
        activeDrawOpts: null,
        activeToolKey: toolKey ?? null,
        draft: { points: [], hover: null },
      }),

    // Cancel clears the transient draw/probe state but keeps activeTemplateId
    // (the last-used-template seed for the split buttons, §4.3).
    cancelDraw: () =>
      set({
        drawMode: null,
        activeDrawOpts: null,
        probing: false,
        probePoint: null,
        activeToolKey: null,
        draft: { points: [], hover: null },
      }),

    setActiveTemplateId: (id) => set({ activeTemplateId: id }),

    selectMeasurement: (id, opts) =>
      set({
        selection: { kind: "measurement", measurementIds: [id] },
        detailPanel: "inspect",
        isInspectingNew: false,
        pendingFlyToId: opts?.fly === false ? null : id,
      }),

    selectFeature: (props) =>
      set({
        selection: { kind: "feature", measurementIds: [], feature: props },
        detailPanel: "inspect",
        isInspectingNew: false,
        pendingFlyToId: null,
      }),

    clearSelection: () =>
      set({
        selection: null,
        isInspectingNew: false,
        pendingFlyToId: null,
        detailPanel: get().detailPanel === "inspect" ? null : get().detailPanel,
      }),

    clearPendingFly: () => set({ pendingFlyToId: null }),

    openDetail: (mode) => set({ detailPanel: mode }),
    closeDetail: () => set({ detailPanel: null }),

    setLayerVisible: (key, visible) =>
      set({
        layerControls: get().layerControls.map((l) =>
          l.key === key ? { ...l, visible } : l
        ),
      }),

    setLayerOpacity: (key, opacity) =>
      set({
        layerControls: get().layerControls.map((l) =>
          l.key === key ? { ...l, opacity } : l
        ),
      }),

    setView: (patch) => set({ view: { ...get().view, ...patch } }),
    setCameraPose: (pose) => set({ cameraPose: pose }),

    // Field-wise restore (§5.6): each present field overrides, absent fields
    // leave the store untouched. Matching url.s against loaded measurements and
    // the fly-suppression when a camera is also present are the load-sequence
    // hook's job (1.3c); here we only seed selection from the ids.
    applyUrlState: (u) => {
      const patch: Partial<ViewerShellData> = {};
      if (u.module) patch.activeModule = u.module;
      if (u.camera !== undefined) patch.cameraPose = u.camera;
      if (u.baseMap) patch.view = { ...get().view, baseMap: u.baseMap };
      if (u.measurementIds && u.measurementIds.length > 0) {
        patch.selection = {
          kind: "measurement",
          measurementIds: u.measurementIds,
        };
      }
      if (u.layerVisibility) {
        const vis = u.layerVisibility;
        patch.layerControls = get().layerControls.map((l) =>
          l.key in vis ? { ...l, visible: vis[l.key] } : l
        );
      }
      set(patch);
    },

    markHydrated: () => set({ hydrated: true }),

    setManifest: (manifest) => set({ manifest }),
    setManifestError: (error) => set({ manifestError: error }),
    setProject: (project) => set({ project }),
    setMeasurements: (measurements) => set({ measurements }),
    setLayerControls: (layers) => set({ layerControls: layers }),
    setDesignControls: (designs) => set({ designControls: designs }),

    setBusy: (id, busy) => {
      const next = new Set(get().busyIds);
      if (busy) next.add(id);
      else next.delete(id);
      set({ busyIds: next });
    },

    setSaving: (saving) => set({ saving }),
    setMeasurementSearch: (search) => set({ measurementSearch: search }),
    setSearchingMeasurements: (searching) =>
      set({ searchingMeasurements: searching }),
    setDraft: (points, hover) => set({ draft: { points, hover } }),
    setProbePoint: (point) => set({ probePoint: point }),
    setIsInspectingNew: (isNew) => set({ isInspectingNew: isNew }),
  }));

  if (seed) store.setState(seed);
  return store;
}

// ------------------------------------------------------------------ react binding

const ViewerStoreContext = createContext<StoreApi<ViewerShellState> | null>(
  null
);

/** Per-mount provider (§3.1). The store is created once via a ref and never
 * recreated on re-render; a fresh mount (e.g. survey switch) gets a fresh
 * store. `seed` carries URL > prefs > default field overrides (§5.6), applied
 * in 1.3c/1.4. */
export function ViewerStoreProvider({
  surveyId,
  seed,
  children,
}: {
  surveyId: string;
  seed?: Partial<ViewerShellData>;
  children: ReactNode;
}) {
  // A lazy useState initializer creates the store exactly once per mount (a
  // fresh mount — e.g. a survey switch — gets a fresh store; §3.1). useState
  // rather than a ref keeps the value off the "ref access during render" path
  // (react-hooks/refs).
  const [store] = useState<StoreApi<ViewerShellState>>(() =>
    createViewerStore(surveyId, seed)
  );
  return createElement(ViewerStoreContext.Provider, { value: store }, children);
}

/** Selector-scoped subscription — the per-zone read hook (§3.6). */
export function useViewerStore<T>(selector: (state: ViewerShellState) => T): T {
  const store = useContext(ViewerStoreContext);
  if (store === null) {
    throw new Error("useViewerStore must be used within a ViewerStoreProvider");
  }
  return useStore(store, selector);
}

/** Escape hatch for the out-of-React URL writer (§5.4) and other
 * `store.subscribe`/`getState` consumers that need the raw store api. */
export function useViewerStoreApi(): StoreApi<ViewerShellState> {
  const store = useContext(ViewerStoreContext);
  if (store === null) {
    throw new Error(
      "useViewerStoreApi must be used within a ViewerStoreProvider"
    );
  }
  return store;
}
