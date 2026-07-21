"use client";

// ViewerCanvas — the viewer runtime (viewer-shell §2.2/§2.3; "what ViewerRuntime
// was trying to be"). It owns every mutable Cesium ref (§3.2 — handles NEVER
// enter the Zustand store), the imperative scene callbacks MOVED from
// SurveyViewer (layer toggle/opacity/lens/terrain, draw/probe lifecycle, CRUD),
// and it invokes the six relocated effect hooks (§2.3). The serialisable state
// lives in the store; each callback below is the SurveyViewer body with its
// `useState` reads/writes swapped to store selectors/actions (§2.3 permitted
// edit (a)) and its viewer refs sourced from `CesiumViewerProvider`.
//
// It renders the PIVOT grid (2026-07-16) and publishes its ref-bound callbacks
// through `ViewerActionsProvider` so the zone hosts (which are its descendants)
// can invoke them while reading DATA from the store directly (§3.6). Chrome in
// place: FLOATING toolbar over the canvas top-center (measure module), the LEFT
// dock (measurements list / layers), floating DetailPanel overlay (calc/inspect
// on measure, feature inspect elsewhere), docked StatusBar spanning cols 2–3,
// and the CameraJoystick overlay with a detail-panel-aware right offset.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewer } from "resium";
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  Cesium3DTileStyle,
  Cesium3DTileset,
  CesiumTerrainProvider,
  ClippingPolygonCollection,
  Color,
  EllipsoidTerrainProvider,
  Entity,
  GeoJsonDataSource,
  HeadingPitchRange,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventHandler,
  type TerrainProvider,
  createWorldTerrainAsync,
} from "cesium";
import { toast } from "sonner";

import {
  computeMeasurement,
  deleteMeasurement,
  estimateMeasurement,
  getManifest,
  listMeasurements,
  updateMeasurement,
} from "@/lib/api/assetSvc";
import { ApiError } from "@/lib/api/client";
import {
  geometryPositions,
  geometryToRectangle,
} from "@/lib/viewer/measure";
import { useActorRef } from "@xstate/react";
import { INTERACTION_V2 } from "@/lib/viewer/interaction/flag";
import { hasSelfIntersection } from "@/lib/viewer/interaction/validity";
import { attachStoreBridge } from "@/lib/viewer/interaction/bridge";
import { machineWithCommit } from "@/lib/viewer/commitMeasurement";
import { useInteractionAdapter } from "@/components/viewer/shell/hooks/useInteractionAdapter";
import { useDraftRenderer } from "@/components/viewer/shell/hooks/useDraftRenderer";
import {
  useSelectionHandles,
  type SelectionSeed,
} from "@/components/viewer/shell/hooks/useSelectionHandles";
import { InteractionProvider } from "@/components/viewer/shell/interactionContext";
import { MeasurementContextMenu } from "@/components/viewer/shell/MeasurementContextMenu";
import { ShortcutSheet } from "@/components/viewer/shell/ShortcutSheet";
import { useViewerHotkeys } from "@/components/viewer/shell/hooks/useViewerHotkeys";
import {
  isVolumeKind,
  metricsOf,
  resultForKind,
} from "@/lib/viewer/calc";
import { buildPointCloudStyle } from "@/lib/viewer/pointcloud";
import { USE_WORLD_TERRAIN } from "@/lib/viewer/cesiumIon";
import {
  DEFAULT_CENTER,
  bboxToRectangle,
  isThinSurfaceMesh,
  manifestLayersEmpty,
  proxyGcsUrls,
  type LayerHandle,
} from "@/components/viewer/shell/sceneHelpers";
import {
  useViewerStore,
  useViewerStoreApi,
  type ViewSettings,
} from "@/lib/viewer/state/store";
import { useCesiumViewer } from "@/lib/viewer/state/cesiumContext";
import {
  ViewerActionsProvider,
  type ViewerActions,
} from "@/components/viewer/shell/viewerActions";
import type { LayerControl, DesignControl } from "@/components/viewer/LayerPanel";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

import { ModuleRail } from "@/components/viewer/shell/ModuleRail";
import { TreePanel } from "@/components/viewer/shell/TreePanel";
import { FloatingToolbar } from "@/components/viewer/shell/FloatingToolbar";
import { DetailPanel } from "@/components/viewer/shell/DetailPanel";
import { StatusBar } from "@/components/viewer/shell/StatusBar";
import { CameraJoystick } from "@/components/viewer/CameraJoystick";

import { useManifestLoad } from "@/components/viewer/shell/hooks/useManifestLoad";
import { useMeasurementsPoll } from "@/components/viewer/shell/hooks/useMeasurementsPoll";
import {
  useCameraFraming,
  type CameraTarget,
} from "@/components/viewer/shell/hooks/useCameraFraming";
import { useDrawInteraction } from "@/components/viewer/shell/hooks/useDrawInteraction";
import { useScenePicking } from "@/components/viewer/shell/hooks/useScenePicking";
import { useLayerLifecycle } from "@/components/viewer/shell/hooks/useLayerLifecycle";

// Zoom-button step: a fraction of the camera's CURRENT altitude, not a fixed
// meter amount, so one click feels the same whether orbiting the whole site or
// already close to the ground — mirrors scroll-wheel zoom.
const ZOOM_STEP_FACTOR = 0.4;


export function ViewerCanvas() {
  const { viewerRef, viewerReady, handleViewerRef, baseImageryRef } = useCesiumViewer();
  const store = useViewerStoreApi();

  // -------------------------------------------- interaction v2 (plan §P1)
  // The machine actor lives here because the commit impl needs this
  // component's CRUD closures. Deps flow through a latest-ref so the actor
  // (created once) never sees stale callbacks. Hooks below self-no-op when
  // the flag is off — the legacy path stays byte-identical.
  // Machine + latest-deps setter, created once. The deps slot lives inside
  // machineWithCommit's closure (neither a ref nor state — compiler-safe);
  // the effect below re-points it after every render so commits never stale.
  const [{ machine: providedMachine, setDeps: setCommitDeps }] = useState(machineWithCommit);
  const interactionActor = useActorRef(providedMachine);
  useEffect(() => {
    if (!INTERACTION_V2) return;
    return attachStoreBridge(interactionActor, store);
  }, [interactionActor, store]);
  // Edit handles + midpoint ghosts the renderer draws + the adapter GPU-picks
  // (shared refs; vertex order / edge order).
  const editHandleEntitiesRef = useRef<Entity[]>([]);
  const editGhostEntitiesRef = useRef<Entity[]>([]);
  // Selection-overlay handles on a selected (not-yet-editing) measurement, and
  // the edit seed the adapter sends when one is grabbed (P2c-2b). Populated by
  // useSelectionHandles (called after liftToTerrain is defined); the adapter
  // reads them at event time, so creating the refs here is fine.
  const selectionHandlesRef = useRef<Entity[]>([]);
  const selectionSeedRef = useRef<SelectionSeed | null>(null);
  const adapterRefs = useInteractionAdapter(
    viewerRef,
    viewerReady,
    interactionActor,
    store,
    editHandleEntitiesRef,
    editGhostEntitiesRef,
    selectionHandlesRef,
    selectionSeedRef
  );
  useDraftRenderer(
    viewerRef,
    viewerReady,
    interactionActor,
    adapterRefs,
    editHandleEntitiesRef,
    editGhostEntitiesRef
  );

  // -------------------------------------------------------- reactive reads
  const surveyId = useViewerStore((s) => s.surveyId);
  const manifest = useViewerStore((s) => s.manifest);
  const measurements = useViewerStore((s) => s.measurements);
  const measurementVisibility = useViewerStore((s) => s.measurementVisibility);
  const layerControls = useViewerStore((s) => s.layerControls);
  const designControls = useViewerStore((s) => s.designControls);
  const measurementSearch = useViewerStore((s) => s.measurementSearch);
  const drawMode = useViewerStore((s) => s.drawMode);
  const probing = useViewerStore((s) => s.probing);
  const detailPanel = useViewerStore((s) => s.detailPanel);
  const treePanelOpen = useViewerStore((s) => s.treePanelOpen);
  const activeModule = useViewerStore((s) => s.activeModule);
  const selectionKind = useViewerStore((s) => s.selection?.kind ?? null);
  const baseMap = useViewerStore((s) => s.view.baseMap);
  const terrainExaggeration = useViewerStore((s) => s.view.terrainExaggeration);
  const sunLightingEnabled = useViewerStore((s) => s.view.sunLightingEnabled);
  const sunHour = useViewerStore((s) => s.view.sunHour);
  // Stable store actions passed straight to the relocated hooks.
  const setProject = useViewerStore((s) => s.setProject);
  const setSearchingMeasurements = useViewerStore((s) => s.setSearchingMeasurements);
  const setProbePoint = useViewerStore((s) => s.setProbePoint);
  const selectMeasurement = useViewerStore((s) => s.selectMeasurement);
  const selectFeature = useViewerStore((s) => s.selectFeature);
  const clearSelection = useViewerStore((s) => s.clearSelection);
  const openContextMenu = useViewerStore((s) => s.openContextMenu);
  const closeContextMenu = useViewerStore((s) => s.closeContextMenu);
  const setLayerControls = useViewerStore((s) => s.setLayerControls);
  const setDesignControls = useViewerStore((s) => s.setDesignControls);

  const layersEmpty = manifestLayersEmpty(manifest);

  // -------------------------------------------------------- local state
  const [clipInputsVersion, setClipInputsVersion] = useState(0);

  // -------------------------------------------------------- refs (§3.2)
  const handlesRef = useRef<Map<string, LayerHandle>>(new Map());
  const visibleRef = useRef<Map<string, boolean>>(new Map());
  const layersSignatureRef = useRef<string>("");
  const cameraTargetRef = useRef<CameraTarget>("none");
  const drawHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const draftPositionsRef = useRef<Cartesian3[]>([]);
  const draftEntityRef = useRef<Entity | null>(null);
  const draftVertexEntitiesRef = useRef<Entity[]>([]);
  const draftSegmentLabelEntitiesRef = useRef<Entity[]>([]);
  /** Undo/redo as GEOMETRY SNAPSHOTS (positions + ring open/closed), not a
   * per-vertex stack — so it covers EVERY mutation (place, drag, erase), each of
   * which snapshots the prior state before mutating. */
  const undoHistoryRef = useRef<{ positions: Cartesian3[]; open: boolean }[]>([]);
  const redoHistoryRef = useRef<{ positions: Cartesian3[]; open: boolean }[]>([]);
  const hoverPositionRef = useRef<Cartesian3 | null>(null);
  /** True after right-click locked the draft for calc selection (no vertex placement). */
  const awaitingCalcRef = useRef(false);
  /** Restores vertex-placement clicks when leaving eraser mode mid-draw. */
  const bindDrawClickRef = useRef<(() => void) | null>(null);
  /** Arms segment-pick clicks while the eraser is active. */
  const bindEraseClickRef = useRef<(() => void) | null>(null);
  /** Arms vertex-drag handles while the geometry editor is active. */
  const bindVertexEditClickRef = useRef<(() => void) | null>(null);
  /** Index (into draftPositionsRef) of the vertex being dragged, or null. */
  const draggingVertexRef = useRef<number | null>(null);
  /** Binds double-click → finish (the measurement-edit eraser needs it bound
   * WITHOUT going through releaseForCalc). */
  const bindFinishDblClickRef = useRef<(() => void) | null>(null);
  /** True once the eraser opened a polygon ring — the draft preview stops
   * auto-closing so the erased edge actually disappears until finish. */
  const polygonOpenRef = useRef(false);
  const eraseHighlightRef = useRef<Entity | null>(null);
  /** Vertex-to-vertex eraser: index of the FIRST picked vertex (anchor), or null
   * when no anchor is set yet. The second adjacent pick deletes the edge. */
  const eraseVertexARef = useRef<number | null>(null);
  /** Halo entity over the eraser's anchor vertex while one is picked. */
  const eraseAnchorHaloRef = useRef<Entity | null>(null);
  /** Arms the point/identify tool (highlight a vertex/edge, click to select). */
  /** Transient hover highlight under the point tool's cursor (vertex or edge). */
  const pointHoverRef = useRef<Entity | null>(null);
  /** Persistent highlight over the point tool's SELECTED vertex/edge. */
  const pointSelectHighlightRef = useRef<Entity | null>(null);
  /** What the point tool has selected (identify readout / act-on hook), or null. */
  const pointSelectionRef = useRef<{ kind: "vertex" | "edge"; index: number } | null>(null);
  /** Cursor is hovering the FIRST draft vertex (snap-to-close-the-ring cue). */
  const nearOriginRef = useRef(false);
  /** Halo entity over the origin vertex while `nearOriginRef` is true. */
  const originHaloRef = useRef<Entity | null>(null);
  /** Snapshot (at startDraw) of every measurement's vertices — the pool a placed
   * vertex snaps onto ("Any nearby vertex"). Own draft verts are added live. */
  const snapTargetsRef = useRef<Cartesian3[]>([]);
  /** The non-origin vertex the cursor is currently snapping to (halo target). */
  const snapPreviewRef = useRef<Cartesian3 | null>(null);
  /** Cyan ring shown over `snapPreviewRef` — "you're snapping to this vertex". */
  const snapHaloRef = useRef<Entity | null>(null);
  /** Self-handle so in-session handlers can RESTART the draw session (the
   * Line→polygon close-out) without a recursive self-reference inside the
   * startDraw useCallback; assigned in an effect below. */
  const previousToolKeyRef = useRef<string | null>(null);
  /** Seed vertices into the next startDraw (edit existing / revive session). */
  /** When set, finish() PATCHes this measurement instead of creating a new one. */
  const editingMeasurementIdRef = useRef<string | null>(null);
  const probeEntityRef = useRef<Entity | null>(null);
  const measurementDsRef = useRef<GeoJsonDataSource | null>(null);
  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  const measurementsSigRef = useRef<string>("");
  const searchRef = useRef<string>("");
  const appliedSearchRef = useRef<string>("");
  const footprintsRef = useRef<Map<string, Cartesian3[]>>(new Map());
  const meshReadyRef = useRef<Set<string>>(new Set());
  const meshPreloadWaiverRef = useRef<Set<string>>(new Set());
  const clipCollectionRef = useRef<ClippingPolygonCollection | null>(null);
  const surveyBoundsRef = useRef<BoundingSphere | null>(null);
  const tilesetFramedRef = useRef(false);
  const baseTerrainRef = useRef<TerrainProvider | null>(null);
  const terrainSeqRef = useRef(0);
  const defaultTerrainSigRef = useRef<string | null>(null);

  // Always-current mirrors of the control arrays — the toggle/opacity handlers
  // read these to compute the next state and run their Cesium side effects
  // OUTSIDE any setState updater (SurveyViewer :392-399).
  const layerControlsRef = useRef<LayerControl[]>([]);
  const designControlsRef = useRef<DesignControl[]>([]);
  useEffect(() => {
    layerControlsRef.current = layerControls;
  }, [layerControls]);
  useEffect(() => {
    designControlsRef.current = designControls;
  }, [designControls]);

  // ------------------------------------------------------------- data load
  const loadManifest = useCallback(async () => {
    try {
      const m = await getManifest(surveyId);
      store.getState().setManifest(proxyGcsUrls(m));
      store.getState().setManifestError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        store.getState().setManifestError(err.message);
      }
    }
  }, [surveyId, store]);

  const refreshMeasurements = useCallback(async () => {
    try {
      const res = await listMeasurements(surveyId, searchRef.current);
      const list = res.measurements || [];
      for (const m of list) {
        const prev = prevStatusesRef.current.get(m.id);
        if (prev === "computing" && m.status === "completed") {
          toast.success(`Measurement "${m.name}" computed`);
        } else if (prev === "computing" && m.status === "failed") {
          toast.error(`Measurement "${m.name}" failed to compute`);
        }
      }
      prevStatusesRef.current = new Map(list.map((m) => [m.id, m.status]));
      const sig = list.map((m) => `${m.id}:${m.status}:${m.updated_at}`).join("|");
      if (sig === measurementsSigRef.current) return;
      measurementsSigRef.current = sig;
      store.getState().setMeasurements(list);
    } catch (err) {
      console.error("Failed to fetch measurements:", err);
    }
  }, [surveyId, store]);

  const patchControl = useCallback(
    (key: string, patch: Partial<LayerControl>) => {
      const cur = store.getState().layerControls;
      store.getState().setLayerControls(cur.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    },
    [store]
  );

  const updateCloudPreload = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    for (const [key, vis] of visibleRef.current) {
      if (
        key.startsWith("sitemodel-") &&
        vis &&
        !meshReadyRef.current.has(key) &&
        !meshPreloadWaiverRef.current.has(key)
      ) {
        return;
      }
    }
    for (const [key, handle] of handlesRef.current) {
      if (key.startsWith("pointcloud-") && handle.type === "tileset") {
        handle.tileset.preloadWhenHidden = true;
      }
    }
  }, [viewerRef]);

  const registerSurveyBounds = useCallback(
    (tileset: Cesium3DTileset) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      surveyBoundsRef.current = surveyBoundsRef.current
        ? BoundingSphere.union(surveyBoundsRef.current, tileset.boundingSphere, new BoundingSphere())
        : BoundingSphere.clone(tileset.boundingSphere);
      if (cameraTargetRef.current === "bbox" || tilesetFramedRef.current) return;
      tilesetFramedRef.current = true;
      cameraTargetRef.current = "tileset";
      const sphere = surveyBoundsRef.current;
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.8,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), sphere.radius * 2.8),
      });
    },
    [viewerRef]
  );

  // ------------------------------------------------------------ camera
  const flyToRectangle = useCallback(
    (rect: Rectangle) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      viewer.camera.flyTo({ destination: rect, duration: 2.0 });
    },
    [viewerRef]
  );

  /** Reset to the survey's first framing (bbox → tileset bounds → default center). */
  const goHome = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (manifest) {
      const rects = [
        ...(manifest.layers.terrain || []).map((l) => bboxToRectangle(l.bbox)),
        ...(manifest.layers.ortho || []).map((l) => bboxToRectangle(l.bbox)),
        ...(manifest.layers.lenses || []).map((l) => bboxToRectangle(l.bbox)),
        ...(manifest.layers.pointcloud || []).map((l) => bboxToRectangle(l.bbox)),
      ].filter((r): r is Rectangle => !!r);
      if (rects.length > 0) {
        const union = rects.reduce(
          (acc, r) => Rectangle.union(acc, r, new Rectangle()),
          rects[0]
        );
        flyToRectangle(union);
        return;
      }
    }

    const sphere = surveyBoundsRef.current;
    if (sphere) {
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.8,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), sphere.radius * 2.8),
      });
      return;
    }

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        DEFAULT_CENTER.lng,
        DEFAULT_CENTER.lat,
        DEFAULT_CENTER.height
      ),
      duration: 2.0,
    });
  }, [viewerRef, manifest, flyToRectangle]);

  const zoomIn = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const camera = viewer.scene.camera;
    camera.zoomIn(Math.max(camera.positionCartographic.height, 1) * ZOOM_STEP_FACTOR);
    viewer.scene.requestRender(); // requestRenderMode is on
  }, [viewerRef]);
  const zoomOut = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const camera = viewer.scene.camera;
    camera.zoomOut(Math.max(camera.positionCartographic.height, 1) * ZOOM_STEP_FACTOR);
    viewer.scene.requestRender();
  }, [viewerRef]);

  // Fullscreen toggle for the whole viewer shell (toolbar/panels stay usable,
  // matching Cesium's own fullscreenButton target convention) — replaces it
  // since it's disabled below (`fullscreenButton={false}`) in favor of this
  // themed control. State tracks the browser's actual fullscreenElement so it
  // stays correct if the user exits via Esc instead of the button.
  const shellRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void shellRef.current?.requestFullscreen();
    }
  }, []);

  // ------------------------------------------------------- terrain plumbing
  const ensureBaseTerrain = useCallback(async (): Promise<TerrainProvider> => {
    if (baseTerrainRef.current) return baseTerrainRef.current;
    if (USE_WORLD_TERRAIN) {
      try {
        baseTerrainRef.current = await createWorldTerrainAsync();
        return baseTerrainRef.current;
      } catch (err) {
        console.error("Cesium World Terrain failed (check ion token); using ellipsoid:", err);
        return new EllipsoidTerrainProvider();
      }
    }
    baseTerrainRef.current = new EllipsoidTerrainProvider();
    return baseTerrainRef.current;
  }, []);

  const applyTerrain = useCallback(
    async (url: string | null): Promise<boolean> => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return false;
      const seq = ++terrainSeqRef.current;
      if (!url) {
        const base = await ensureBaseTerrain();
        if (viewer.isDestroyed() || seq !== terrainSeqRef.current) return false;
        viewer.terrainProvider = base;
        viewer.scene.requestRender();
        return true;
      }
      try {
        const provider = await CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true });
        if (viewer.isDestroyed() || seq !== terrainSeqRef.current) return false;
        viewer.terrainProvider = provider;
        viewer.scene.requestRender();
        return true;
      } catch (err) {
        console.error("Failed to load terrain:", err);
        toast.error("Failed to load terrain tiles");
        return false;
      }
    },
    [viewerRef, ensureBaseTerrain]
  );

  // ----------------------------------------------------- layer interaction
  const handleToggle = useCallback(
    (key: string) => {
      const prev = layerControlsRef.current;
      const target = prev.find((l) => l.key === key);
      if (!target) return;
      const turningOn = !target.visible;
      const isSiteModel = key.startsWith("sitemodel-");
      const next = prev.map((l) => {
        if (l.key === key) return { ...l, visible: !l.visible };
        if (target.category === "terrain" && l.category === "terrain" && turningOn) {
          return { ...l, visible: false };
        }
        if (turningOn && isSiteModel && l.category === "terrain" && l.visible) {
          return { ...l, visible: false };
        }
        if (turningOn && target.category === "terrain" && l.key.startsWith("sitemodel-") && l.visible) {
          return { ...l, visible: false };
        }
        return l;
      });

      const handle = handlesRef.current.get(key);
      const nowVisible = !target.visible;
      const viewer = viewerRef.current;
      visibleRef.current.set(key, nowVisible);
      updateCloudPreload();
      if (nowVisible && isSiteModel) {
        for (const l of prev) {
          if (l.category === "terrain" && l.visible) visibleRef.current.set(l.key, false);
        }
        applyTerrain(null);
      }
      if (nowVisible && target.category === "terrain") {
        for (const l of prev) {
          if (!l.key.startsWith("sitemodel-") || !l.visible) continue;
          visibleRef.current.set(l.key, false);
          const h = handlesRef.current.get(l.key);
          if (h?.type === "tileset") h.tileset.show = false;
        }
      }
      if (target.category === "terrain") {
        const h = handle?.type === "terrain" ? handle : null;
        applyTerrain(nowVisible && h ? h.url : null);
      } else if (handle) {
        if (handle.type === "imagery") handle.layer.show = nowVisible;
        else if (handle.type === "tileset") handle.tileset.show = nowVisible;
        else if (handle.type === "datasource") handle.ds.show = nowVisible;
        else if (handle.type === "geojson-lazy" && nowVisible && !handle.loading) {
          handle.loading = true;
          patchControl(key, { loading: true, error: null });
          GeoJsonDataSource.load(handle.url, {
            clampToGround: true,
            stroke: Color.fromCssColorString("#7DD3FC"),
            fill: Color.fromCssColorString("#7DD3FC").withAlpha(0.15),
            strokeWidth: 2,
          })
            .then((ds) => {
              if (!viewer || viewer.isDestroyed()) return;
              ds.show = visibleRef.current.get(key) ?? false;
              viewer.dataSources.add(ds);
              handlesRef.current.set(key, { type: "datasource", ds });
              viewer.scene.requestRender();
              patchControl(key, { loading: false });
            })
            .catch((err) => {
              handle.loading = false;
              console.error("Failed to load vector layer:", err);
              patchControl(key, { loading: false, error: "Failed to load vector data" });
            });
        }
      }
      if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      layerControlsRef.current = next;
      store.getState().setLayerControls(next);
    },
    [store, viewerRef, applyTerrain, patchControl, updateCloudPreload]
  );

  const handleOpacity = useCallback(
    (key: string, opacity: number) => {
      const cur = store.getState().layerControls;
      store.getState().setLayerControls(cur.map((l) => (l.key === key ? { ...l, opacity } : l)));
      const handle = handlesRef.current.get(key);
      if (!handle) return;
      const viewer = viewerRef.current;
      if (handle.type === "imagery") {
        handle.layer.alpha = opacity;
        if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      } else if (handle.type === "tileset") {
        handle.tileset.style = key.startsWith("pointcloud-")
          ? buildPointCloudStyle(opacity)
          : opacity >= 0.99
            ? undefined
            : new Cesium3DTileStyle({ color: `color('white', ${opacity.toFixed(2)})` });
        if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      } else if (handle.type === "terrain") {
        if (viewer && !viewer.isDestroyed()) {
          const t = viewer.scene.globe.translucency;
          t.enabled = opacity < 0.99;
          t.frontFaceAlpha = opacity;
          t.backFaceAlpha = opacity;
          viewer.scene.requestRender();
        }
      }
    },
    [store, viewerRef]
  );

  const applyLensVisibility = useCallback(
    (ramp: string | null, show: boolean) => {
      const next = layerControlsRef.current.map((l) => {
        if (l.lensRamp !== ramp) return l;
        const handle = handlesRef.current.get(l.key);
        if (handle?.type === "imagery") handle.layer.show = show;
        visibleRef.current.set(l.key, show);
        return { ...l, visible: show };
      });
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      layerControlsRef.current = next;
      store.getState().setLayerControls(next);
    },
    [store, viewerRef]
  );

  const handleColorMapChange = useCallback(
    (value: string) => {
      store.getState().setView({ colorMap: value });
      const selected = value.toLowerCase();
      const next = layerControlsRef.current.map((l) => {
        if (!l.lensRamp || !["viridis", "terrain", "plasma", "grayscale"].includes(l.lensRamp)) return l;
        const show = value !== "None" && l.lensRamp === selected;
        const handle = handlesRef.current.get(l.key);
        if (handle?.type === "imagery") handle.layer.show = show;
        visibleRef.current.set(l.key, show);
        return { ...l, visible: show };
      });
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      layerControlsRef.current = next;
      store.getState().setLayerControls(next);
    },
    [store, viewerRef]
  );

  const handleShadingChange = useCallback(
    (value: string) => {
      store.getState().setView({ shading: value });
      applyLensVisibility("hillshade", value === "Hillshade");
    },
    [store, applyLensVisibility]
  );

  const handleContourIntervalChange = useCallback(
    (intervalM: number) => {
      store.getState().setView({ contourIntervalM: intervalM });
      const viewer = viewerRef.current;
      const next = layerControlsRef.current.map((l) => {
        if (!l.vectorRole || !(l.vectorRole === "contours" || l.vectorRole.startsWith("contours_"))) {
          return l;
        }
        const show = l.intervalM === intervalM;
        const handle = handlesRef.current.get(l.key);
        if (handle?.type === "datasource") {
          handle.ds.show = show;
        } else if (handle?.type === "geojson-lazy" && show && !handle.loading) {
          handle.loading = true;
          patchControl(l.key, { loading: true, error: null });
          GeoJsonDataSource.load(handle.url, {
            clampToGround: true,
            stroke: Color.fromCssColorString("#7DD3FC"),
            fill: Color.fromCssColorString("#7DD3FC").withAlpha(0.15),
            strokeWidth: 2,
          })
            .then((ds) => {
              if (!viewer || viewer.isDestroyed()) return;
              ds.show = visibleRef.current.get(l.key) ?? false;
              viewer.dataSources.add(ds);
              handlesRef.current.set(l.key, { type: "datasource", ds });
              viewer.scene.requestRender();
              patchControl(l.key, { loading: false });
            })
            .catch((err) => {
              handle.loading = false;
              console.error("Failed to load contour layer:", err);
              patchControl(l.key, { loading: false, error: "Failed to load contour data" });
            });
        }
        visibleRef.current.set(l.key, show);
        return { ...l, visible: show };
      });
      if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      layerControlsRef.current = next;
      store.getState().setLayerControls(next);
    },
    [store, viewerRef, patchControl]
  );

  const handleToggleDigitalTwin = useCallback(() => {
    if (!USE_WORLD_TERRAIN) return;
    const next = !store.getState().view.digitalTwinEnabled;
    const viewer = viewerRef.current;
    const layers = layerControlsRef.current;
    const manifestNow = store.getState().manifest;
    if (next) {
      applyTerrain(null);
      const updated = layers.map((l) => {
        if (l.category === "terrain" && l.visible) {
          visibleRef.current.set(l.key, false);
          return { ...l, visible: false };
        }
        if (l.key.startsWith("sitemodel-")) {
          const hero = manifestNow?.layers.site_models?.some(
            (sm, i) => `sitemodel-${i}` === l.key && !isThinSurfaceMesh(sm.source_format)
          );
          if (hero) {
            const h = handlesRef.current.get(l.key);
            if (h?.type === "tileset") h.tileset.show = true;
            visibleRef.current.set(l.key, true);
            return { ...l, visible: true };
          }
        }
        return l;
      });
      layerControlsRef.current = updated;
      store.getState().setLayerControls(updated);
    } else {
      const dsm = layers.find(
        (l) => l.category === "terrain" && l.label.toLowerCase() === "dsm"
      );
      if (dsm) {
        const h = handlesRef.current.get(dsm.key);
        if (h?.type === "terrain") applyTerrain(h.url);
        visibleRef.current.set(dsm.key, true);
        const updated = layers.map((l) => {
          if (l.key === dsm.key) return { ...l, visible: true };
          if (l.key.startsWith("sitemodel-") && l.visible) {
            const h2 = handlesRef.current.get(l.key);
            if (h2?.type === "tileset") h2.tileset.show = false;
            visibleRef.current.set(l.key, false);
            return { ...l, visible: false };
          }
          return l;
        });
        layerControlsRef.current = updated;
        store.getState().setLayerControls(updated);
      }
    }
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
    store.getState().setView({ digitalTwinEnabled: next });
  }, [store, viewerRef, applyTerrain]);

  const handleToggleImages = useCallback(() => {
    const v = store.getState().layerControls.find((l) => l.vectorRole === "image_positions");
    if (v) handleToggle(v.key);
  }, [store, handleToggle]);

  const handleToggleGcps = useCallback(() => {
    const v = store.getState().layerControls.find((l) => l.vectorRole === "gcps");
    if (v) handleToggle(v.key);
  }, [store, handleToggle]);

  const handleSunLightingChange = useCallback(
    (enabled: boolean, hour: number) => {
      store.getState().setView({ sunLightingEnabled: enabled, sunHour: hour });
    },
    [store]
  );

  const handleToggleDesign = useCallback(
    (key: string) => {
      const prev = designControlsRef.current;
      const target = prev.find((d) => d.key === key);
      if (!target || !target.renderable) return;
      const nowVisible = !target.visible;
      const viewer = viewerRef.current;
      visibleRef.current.set(key, nowVisible);

      const handle = handlesRef.current.get(key);
      if (handle?.type === "datasource") {
        handle.ds.show = nowVisible;
      } else if (handle?.type === "geojson-lazy" && nowVisible && !handle.loading) {
        handle.loading = true;
        GeoJsonDataSource.load(handle.url, {
          clampToGround: true,
          stroke: Color.fromCssColorString("#A78BFA"),
          fill: Color.fromCssColorString("#A78BFA").withAlpha(0.15),
          strokeWidth: 2,
        })
          .then((ds) => {
            if (!viewer || viewer.isDestroyed()) return;
            ds.show = visibleRef.current.get(key) ?? false;
            viewer.dataSources.add(ds);
            handlesRef.current.set(key, { type: "datasource", ds });
            viewer.scene.requestRender();
          })
          .catch((err) => {
            handle.loading = false;
            console.error("Failed to load design layer:", err);
            toast.error("Failed to load design overlay");
          });
      }
      if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
      const next = prev.map((d) => (d.key === key ? { ...d, visible: nowVisible } : d));
      designControlsRef.current = next;
      store.getState().setDesignControls(next);
    },
    [store, viewerRef]
  );

  // ------------------------------------------------------------- drawing
  const cleanupDraw = useCallback(() => {
    const viewer = viewerRef.current;
    // A teardown mid vertex-drag must hand the camera back.
    if (viewer && !viewer.isDestroyed() && draggingVertexRef.current !== null) {
      viewer.scene.screenSpaceCameraController.enableInputs = true;
    }
    draggingVertexRef.current = null;
    if (drawHandlerRef.current) {
      drawHandlerRef.current.destroy();
      drawHandlerRef.current = null;
    }
    if (viewer && !viewer.isDestroyed() && draftEntityRef.current) {
      viewer.entities.remove(draftEntityRef.current);
    }
    if (viewer && !viewer.isDestroyed()) {
      for (const entity of draftVertexEntitiesRef.current) viewer.entities.remove(entity);
      for (const entity of draftSegmentLabelEntitiesRef.current) viewer.entities.remove(entity);
      if (eraseHighlightRef.current) viewer.entities.remove(eraseHighlightRef.current);
      if (eraseAnchorHaloRef.current) viewer.entities.remove(eraseAnchorHaloRef.current);
      if (pointHoverRef.current) viewer.entities.remove(pointHoverRef.current);
      if (pointSelectHighlightRef.current) viewer.entities.remove(pointSelectHighlightRef.current);
      if (originHaloRef.current) viewer.entities.remove(originHaloRef.current);
      if (snapHaloRef.current) viewer.entities.remove(snapHaloRef.current);
    }
    draftEntityRef.current = null;
    draftVertexEntitiesRef.current = [];
    draftSegmentLabelEntitiesRef.current = [];
    eraseHighlightRef.current = null;
    eraseAnchorHaloRef.current = null;
    eraseVertexARef.current = null;
    pointHoverRef.current = null;
    pointSelectHighlightRef.current = null;
    pointSelectionRef.current = null;
    originHaloRef.current = null;
    nearOriginRef.current = false;
    snapHaloRef.current = null;
    snapPreviewRef.current = null;
    snapTargetsRef.current = [];
    draftPositionsRef.current = [];
    undoHistoryRef.current = [];
    redoHistoryRef.current = [];
    hoverPositionRef.current = null;
    awaitingCalcRef.current = false;
    bindDrawClickRef.current = null;
    bindEraseClickRef.current = null;
    bindVertexEditClickRef.current = null;
    bindFinishDblClickRef.current = null;
    polygonOpenRef.current = false;
    previousToolKeyRef.current = null;
    store.getState().setDraft([], null);
  }, [store, viewerRef]);

  // Lift height-0 geometry positions (2D measurements → alt 0) onto the terrain
  // surface, so seeded edit verts + snap targets sit where the CLAMPED outline
  // and dots render. Without this the raw positions project (screen-space
  // hit-testing for snap/erase/point) OFF the visible dots over elevated
  // terrain. Uses loaded-tile heights (getHeight); leaves a vert at its input
  // height when the tile isn't resident yet (rare for on-screen shapes).
  const liftToTerrain = useCallback(
    (positions: Cartesian3[]): Cartesian3[] => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return positions;
      const globe = viewer.scene.globe;
      return positions.map((p) => {
        const carto = Cartographic.fromCartesian(p);
        if (!carto) return p;
        const h = globe.getHeight(carto);
        return typeof h === "number"
          ? Cartesian3.fromRadians(carto.longitude, carto.latitude, h)
          : p;
      });
    },
    [viewerRef]
  );

  // P2c-2b: draw grab handles on the SELECTED measurement (machine idle); the
  // adapter promotes a grab into a live edit. Wired here (not up top) because it
  // needs liftToTerrain.
  useSelectionHandles(
    viewerRef,
    viewerReady,
    interactionActor,
    store,
    liftToTerrain,
    selectionHandlesRef,
    selectionSeedRef
  );

  const stopProbe = useCallback(() => {
    store.getState().setProbePoint(null);
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed() && probeEntityRef.current) {
      viewer.entities.remove(probeEntityRef.current);
    }
    probeEntityRef.current = null;
  }, [store, viewerRef]);

  const cancelDraw = useCallback(() => {
    // v2: a machine-owned draft cancels through the machine (Esc via the
    // legacy key effect, panel close buttons, toggle-off). The bridge then
    // mirrors the store cleanup + toast; the legacy teardown below still runs
    // for probe/leftover-ref hygiene (idempotent, and its own toast is gated
    // on LEGACY draft state, which is empty under the flag).
    if (INTERACTION_V2 && interactionActor.getSnapshot().value !== "idle") {
      interactionActor.send({ type: "CANCEL" });
    }
    const s = store.getState();
    const editId = editingMeasurementIdRef.current;
    const hadDraft =
      s.drawMode !== null ||
      s.probing ||
      draftPositionsRef.current.length > 0 ||
      !!draftEntityRef.current;
    cleanupDraw();
    stopProbe();
    editingMeasurementIdRef.current = null;
    if (editId) s.setMeasurementVisible(editId, true);
    s.cancelDraw();
    s.closeDetail();
    s.clearSelection();
    if (hadDraft) toast.info("Drawing discarded");
  }, [store, cleanupDraw, stopProbe, interactionActor]);

  const startProbe = useCallback(
    (toolKey?: string) => {
      cleanupDraw();
      const s = store.getState();
      s.startProbe(toolKey);
      s.clearSelection();
      s.openDetail("measure");
    },
    [store, cleanupDraw]
  );

  // Dispatch compute for a measurement (drafts included) — the direct HTTP
  // call into asset-svc; results land on the row via the workflow consumer and
  // the 5s poll picks them up. Declared BEFORE startDraw, whose finish() auto-
  // computes freshly created volume drafts.
  // Best-effort instant estimate for a volume measurement's CURRENT stored
  // params (call AFTER any override is persisted). Sets the ephemeral store
  // estimate on success; a fallback-shaped ApiError (custom_base, unregistered
  // surface, timeout, busy) is swallowed so the authoritative worker stands
  // alone. Superseded by the worker doc once it lands (resultForKind wins).
  const runEstimate = useCallback(
    async (id: string) => {
      const m = store.getState().measurements.find((x) => x.id === id);
      if (!m || !isVolumeKind(m.kind)) return;
      try {
        const est = await estimateMeasurement(surveyId, id);
        store.getState().setEstimate(id, m.kind, est);
      } catch {
        // instant tier can't serve this method/state — worker path continues
      }
    },
    [surveyId, store]
  );

  const triggerCompute = useCallback(
    async (id: string, override?: Record<string, unknown>) => {
      store.getState().setBusy(id, true);
      try {
        // computeMeasurement persists the override (§6.1). A PROMOTED method
        // (§6) returns status "completed" — computed synchronously in PostGIS
        // and already persisted, so the refresh below shows the final doc and no
        // preview is needed. Otherwise the async worker is running: fire the
        // instant estimate so a number appears while it computes.
        const res = await computeMeasurement(
          surveyId,
          id,
          override ? { params: override } : undefined
        );
        if (res.status === "completed") {
          toast.success("Computed");
        } else {
          void runEstimate(id);
          toast.info("Compute dispatched — result will appear when ready");
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          toast.warning(`Compute not available yet: ${err.message}`);
        } else if (err instanceof Error) {
          toast.error(err.message);
        }
      } finally {
        store.getState().setBusy(id, false);
        refreshMeasurements();
      }
    },
    [surveyId, store, refreshMeasurements, runEstimate]
  );

  // Re-point the commit actor's deps slot at the current closures after every
  // render so commits never go stale (created once, above).
  useEffect(() => {
    setCommitDeps({ surveyId, store, refreshMeasurements, triggerCompute });
  });


  // Edit the SELECTED measurement's geometry: seed the machine (v2 edit plane,
  // P2a) → EDIT_SHAPE. Commit (Enter / "Done" / double-click) PATCHes + recomputes.
  const editGeometry = useCallback(() => {
    const sv = store.getState();
    const selId = sv.selection?.kind === "measurement" ? sv.selection.measurementIds[0] : null;
    const sel = selId ? sv.measurements.find((m) => m.id === selId) : null;
    if (!sel?.geometry) {
      toast.info("Select a measurement to edit its shape");
      return;
    }
    const primitive = sel.geometry.type === "Polygon" ? "polygon" : "polyline";
    const geometry = liftToTerrain(geometryPositions(sel.geometry));
    if (geometry.length < 2) {
      toast.info("This measurement has no editable vertices");
      return;
    }
    interactionActor.send({ type: "EDIT_SHAPE", measurementId: sel.id, geometry, primitive });
    toast.info("Drag a vertex to reshape — Enter or double-click when done");
  }, [store, liftToTerrain, interactionActor]);

  // v2 "Done editing" — the inspector-visible twin of Enter/double-click. Same
  // self-intersection guard + toast as the adapter's finish path (the machine's
  // COMMIT guard would otherwise drop the click with no feedback).
  const commitGeometry = useCallback(() => {
    if (!INTERACTION_V2) return;
    const ctx = interactionActor.getSnapshot().context;
    if (hasSelfIntersection(ctx.draft, ctx.primitive === "polygon")) {
      toast.error("Shape can't cross itself — fix the crossing to save");
      return;
    }
    interactionActor.send({ type: "COMMIT" });
  }, [interactionActor]);

  // Redraw editor: draw a FRESH outline that REPLACES the selected measurement's
  // shape (Q1: Replace). Unlike editGeometry (drag existing verts), this starts
  // an empty polygon draw with the edit context set, so finish() PATCHes the
  // geometry in place. The original stays VISIBLE as a tracing reference — its
  // corners are snap targets (computeSnap) — and is replaced on double-click.
  // Redraw the SELECTED measurement: place a FRESH outline over the still-visible
  // original (a tracing reference) → REDRAW_SHAPE. Commit PATCHes the row in place.
  const redrawGeometry = useCallback(() => {
    const sv = store.getState();
    const selId = sv.selection?.kind === "measurement" ? sv.selection.measurementIds[0] : null;
    const sel = selId ? sv.measurements.find((m) => m.id === selId) : null;
    if (!sel?.geometry) {
      toast.info("Select a measurement to redraw its shape");
      return;
    }
    const primitive = sel.geometry.type === "Polygon" ? "polygon" : "polyline";
    interactionActor.send({ type: "REDRAW_SHAPE", measurementId: sel.id, primitive });
    toast.info("Draw the new outline — right-click or Enter to finish. Esc discards.");
  }, [store, interactionActor]);

  // ------------------------------------------------------------ ops (CRUD)
  // saveMeasurement PROMOTES a draw-first draft (draft-first, 2026-07-16):
  // PATCH {name, draft:false}. The row, geometry, params, and any computed
  // result already exist — saving is just "keep it under this name".
  const saveMeasurement = useCallback(
    async (id: string, name: string) => {
      if (!name.trim()) return;
      store.getState().setSaving(true);
      try {
        const updated = await updateMeasurement(surveyId, id, {
          name: name.trim(),
          draft: false,
        });
        toast.success(`Measurement "${updated.name}" saved`);
        await refreshMeasurements();
      } catch (err) {
        if (err instanceof Error) toast.error(err.message);
      } finally {
        store.getState().setSaving(false);
      }
    },
    [surveyId, store, refreshMeasurements]
  );

  // Generic PATCH (rename / re-kind / units / style) + list refresh. Errors
  // toast; rethrown so callers can skip follow-ups (e.g. recompute-after-rekind).
  const patchMeasurement = useCallback(
    async (
      id: string,
      body: { name?: string; folder?: string; kind?: string; params?: Record<string, unknown>; draft?: boolean }
    ) => {
      try {
        await updateMeasurement(surveyId, id, body);
        await refreshMeasurements();
      } catch (err) {
        if (err instanceof Error) toast.error(err.message);
        throw err;
      }
    },
    [surveyId, refreshMeasurements]
  );

  const removeMeasurement = useCallback(
    async (id: string) => {
      store.getState().setBusy(id, true);
      try {
        await deleteMeasurement(surveyId, id);
        toast.success("Measurement deleted");
      } catch (err) {
        if (err instanceof Error) toast.error(err.message);
      } finally {
        store.getState().setBusy(id, false);
        refreshMeasurements();
      }
    },
    [surveyId, store, refreshMeasurements]
  );

  // Tree-row click: inspect the measurement, turn its canvas visibility on,
  // and frame its geometry.
  const selectMeasurementRow = useCallback(
    (m: PanelMeasurement) => {
      const s = store.getState();
      s.selectMeasurement(m.id, { fly: false });
      if (!m.demo) s.setMeasurementVisible(m.id, true);
      if (!m.demo && m.geometry) {
        const rect = geometryToRectangle(m.geometry);
        if (rect) flyToRectangle(rect);
      }
    },
    [store, flyToRectangle]
  );

  const exportMeasurements = useCallback(() => {
    const list = store.getState().measurements;
    const features = list
      .filter((m) => m.geometry)
      .map((m) => ({
        type: "Feature" as const,
        properties: {
          id: m.id,
          name: m.name,
          kind: m.kind,
          folder: m.folder ?? null,
          status: m.status,
          ...metricsOf(resultForKind(m)),
        },
        geometry: m.geometry!,
      }));
    if (features.length === 0) {
      toast.info("No measurements with geometry to export yet");
      return;
    }
    const blob = new Blob(
      [JSON.stringify({ type: "FeatureCollection", features }, null, 2)],
      { type: "application/geo+json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey-${surveyId}-measurements.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${features.length} measurement${features.length === 1 ? "" : "s"}`);
  }, [store, surveyId]);

  // ----------------------------------------------------- relocated effects
  useManifestLoad({ manifest, layersEmpty, loadManifest, refreshMeasurements, setProject });
  useMeasurementsPoll({
    measurementSearch,
    measurements,
    refreshMeasurements,
    setSearchingMeasurements,
    appliedSearchRef,
    searchRef,
    measurementsSigRef,
  });
  useCameraFraming({ viewerReady, manifest, viewerRef, cameraTargetRef, flyToRectangle });
  useDrawInteraction({
    probing,
    viewerReady,
    viewerRef,
    drawMode,
    rightPanel: detailPanel,
    setProbePoint,
    probeEntityRef,
    cancelDraw,
    cleanupDraw,
  });
  useScenePicking({
    viewerReady,
    drawMode,
    probing,
    measurements,
    selectionKind,
    viewerRef,
    selectMeasurement,
    selectFeature,
    clearSelection,
    openContextMenu,
    closeContextMenu,
  });
  useLayerLifecycle({
    viewerReady,
    manifest,
    baseMap,
    layerControls,
    measurements,
    measurementVisibility,
    terrainExaggeration,
    sunLightingEnabled,
    sunHour,
    clipInputsVersion,
    viewerRef,
    baseImageryRef,
    handlesRef,
    layersSignatureRef,
    footprintsRef,
    meshReadyRef,
    meshPreloadWaiverRef,
    surveyBoundsRef,
    tilesetFramedRef,
    visibleRef,
    clipCollectionRef,
    defaultTerrainSigRef,
    measurementDsRef,
    setClipInputsVersion,
    patchControl,
    registerSurveyBounds,
    updateCloudPreload,
    applyTerrain,
    setLayerControls,
    setDesignControls,
  });

  // ------------------------------------------------------------- actions
  const actions = useMemo<ViewerActions>(
    () => ({
      startProbe,
      cancelDraw,
      editGeometry,
      commitGeometry,
      redrawGeometry,
      selectMeasurementRow,
      triggerCompute,
      removeMeasurement,
      saveMeasurement,
      patchMeasurement,
      exportMeasurements,
      handleToggle,
      handleOpacity,
      handleToggleDesign,
      setTerrainExaggeration: (v: number) => store.getState().setView({ terrainExaggeration: v }),
      setBaseMap: (v: string) => store.getState().setView({ baseMap: v as ViewSettings["baseMap"] }),
      handleColorMapChange,
      handleShadingChange,
      handleContourIntervalChange,
      handleToggleImages,
      handleToggleGcps,
      handleToggleDigitalTwin,
      handleSunLightingChange,
      setVolumeMethod: (v: string) => store.getState().setView({ volumeMethod: v }),
    }),
    [
      store,
      startProbe,
      cancelDraw,
      editGeometry,
      commitGeometry,
      redrawGeometry,
      selectMeasurementRow,
      triggerCompute,
      removeMeasurement,
      saveMeasurement,
      patchMeasurement,
      exportMeasurements,
      handleToggle,
      handleOpacity,
      handleToggleDesign,
      handleColorMapChange,
      handleShadingChange,
      handleContourIntervalChange,
      handleToggleImages,
      handleToggleGcps,
      handleToggleDigitalTwin,
      handleSunLightingChange,
    ]
  );

  // Global hotkeys (enrichment Phase 1): tool keys, lenses, frame/visibility,
  // Enter-to-edit, and the `?` cheat sheet. Interaction-plane keys live in the
  // adapter. `actions` satisfies HotkeyActions structurally.
  const [sheetOpen, setSheetOpen] = useState(false);
  const toggleSheet = useCallback(() => setSheetOpen((v) => !v), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useViewerHotkeys(interactionActor, store, actions, toggleSheet);

  // ------------------------------------------------------------------ UI
  // PIVOT grid (2026-07-16): col 1 ModuleRail 48px (spans both rows); col 2 the
  // LEFT dock — the module's LIST on every module (measurements tree on
  // measure, layers on survey); col 3 the Cesium canvas with the FLOATING
  // toolbar overlaid top-center (measure module only) and the draggable
  // DetailPanel (calc/inspect) as an absolute overlay — MUST NOT resize the
  // canvas (D10). Row 2 is the StatusBar spanning cols 2–3.
  const isMeasure = activeModule === "measure";
  const leftPanelVisible = treePanelOpen; // the list dock, all modules

  return (
    <InteractionProvider value={interactionActor}>
    <ViewerActionsProvider value={actions}>
      <div
        ref={shellRef}
        className="grid h-full w-full bg-[#0A0D14]"
        style={{
          gridTemplateColumns: `48px ${leftPanelVisible ? "280px" : "0px"} minmax(0, 1fr)`,
          gridTemplateRows: "minmax(0, 1fr) 24px",
          transition: "grid-template-columns 200ms ease-out",
        }}
      >
        {/* Zone 1 — module rail (full height, both rows) */}
        <div className="row-span-2 min-h-0">
          <ModuleRail />
        </div>

        {/* Zone 2 — LEFT dock: the module's list — measurements tree (measure),
            layers (survey), empty-states elsewhere. Collapsible via the header
            chevron / re-clicking the rail module. */}
        <div className="min-h-0 min-w-0 overflow-hidden">
          {leftPanelVisible && <TreePanel />}
        </div>

        {/* Zone 3 — canvas cell: floating toolbar + draggable detail overlay;
            neither resizes this cell. */}
        <div className="relative min-h-0 min-w-0">
          <div className="absolute inset-0 cesium-container">
            <Viewer
              ref={handleViewerRef}
              full
              requestRenderMode
              timeline={false}
              animation={false}
              geocoder={false}
              baseLayer={false}
              baseLayerPicker={false}
              navigationHelpButton={false}
              homeButton={false}
              sceneModePicker={false}
              fullscreenButton={false}
              infoBox={false}
              selectionIndicator={false}
              style={{ width: "100%", height: "100%" }}
            />
          </div>

          {/* Zone 3 — FLOATING toolbar (the look the user asked for), over the
              canvas top-center on the measure module. */}
          {isMeasure && <FloatingToolbar />}

          {/* Zero-size top-left anchor for the camera joystick. The wrapper has
              no area, so it never intercepts canvas pointer events. */}
          <div className="absolute left-0 top-0 h-0 w-0">
            <CameraJoystick
              viewerRef={viewerRef}
              ready={viewerReady}
              onHome={goHome}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>

          {/* Zone 5 — draggable floating detail (expanded or compact). */}
          <DetailPanel />

          {/* Right-click context menu on a measurement (Edit / Redraw / Delete). */}
          <MeasurementContextMenu />

          {/* `?` keyboard cheat sheet + the drawing-assistance preference. */}
          <ShortcutSheet open={sheetOpen} onClose={closeSheet} />
        </div>

        {/* Zone 6 — status bar, docked, spanning cols 2–3 */}
        <div className="col-span-2 min-w-0">
          <StatusBar />
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cesium-container .cesium-viewer {
          background-color: #0A0D14;
        }
        .cesium-container .cesium-widget,
        .cesium-container .cesium-widget canvas {
          background-color: #0A0D14 !important;
        }
        .cesium-container .cesium-viewer-bottom {
          display: none !important;
        }
      `,
        }}
      />
    </ViewerActionsProvider>
    </InteractionProvider>
  );
}
