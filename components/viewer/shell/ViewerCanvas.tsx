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
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileStyle,
  Cesium3DTileset,
  CesiumTerrainProvider,
  ClassificationType,
  ClippingPolygonCollection,
  Color,
  EllipsoidTerrainProvider,
  Entity,
  GeoJsonDataSource,
  HeadingPitchRange,
  HorizontalOrigin,
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type TerrainProvider,
  createWorldTerrainAsync,
} from "cesium";
import { toast } from "sonner";

import {
  computeMeasurement,
  createMeasurement,
  deleteMeasurement,
  estimateMeasurement,
  getManifest,
  listMeasurements,
  updateMeasurement,
} from "@/lib/api/assetSvc";
import { ApiError } from "@/lib/api/client";
import {
  computeGrade,
  computeDistanceMeters,
  findNearestSegmentIndex,
  geometryPositions,
  geometryToRectangle,
  pickScenePosition,
} from "@/lib/viewer/measure";
import { eraseSegment } from "@/lib/viewer/eraser";
import {
  CalcParamsError,
  LEAN_RENDER,
  coerceMethodForKind,
  defaultKindFor,
  isVolumeKind,
  kindForCalcType,
  metricsOf,
  resultForKind,
  surfaceRefsForMethod,
} from "@/lib/viewer/calc";
import { buildPointCloudStyle } from "@/lib/viewer/pointcloud";
import { USE_WORLD_TERRAIN } from "@/lib/viewer/cesiumIon";
import {
  ACCENT,
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
import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";
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
  const redoPositionsRef = useRef<Cartesian3[]>([]);
  const hoverPositionRef = useRef<Cartesian3 | null>(null);
  const hoverThrottleRef = useRef(0);
  /** True after right-click locked the draft for calc selection (no vertex placement). */
  const awaitingCalcRef = useRef(false);
  /** Restores vertex-placement clicks when leaving eraser mode mid-draw. */
  const bindDrawClickRef = useRef<(() => void) | null>(null);
  /** Arms segment-pick clicks while the eraser is active. */
  const bindEraseClickRef = useRef<(() => void) | null>(null);
  /** Binds double-click → finish (the measurement-edit eraser needs it bound
   * WITHOUT going through releaseForCalc). */
  const bindFinishDblClickRef = useRef<(() => void) | null>(null);
  /** True once the eraser opened a polygon ring — the draft preview stops
   * auto-closing so the erased edge actually disappears until finish. */
  const polygonOpenRef = useRef(false);
  const eraseHighlightRef = useRef<Entity | null>(null);
  const previousToolKeyRef = useRef<string | null>(null);
  /** Seed vertices into the next startDraw (edit existing / revive session). */
  const seedPointsRef = useRef<Cartesian3[] | null>(null);
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
    }
    draftEntityRef.current = null;
    draftVertexEntitiesRef.current = [];
    draftSegmentLabelEntitiesRef.current = [];
    eraseHighlightRef.current = null;
    draftPositionsRef.current = [];
    redoPositionsRef.current = [];
    hoverPositionRef.current = null;
    awaitingCalcRef.current = false;
    bindDrawClickRef.current = null;
    bindEraseClickRef.current = null;
    bindFinishDblClickRef.current = null;
    polygonOpenRef.current = false;
    previousToolKeyRef.current = null;
    store.getState().setDraft([], null);
  }, [store, viewerRef]);

  const clearEraseHighlight = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed() && eraseHighlightRef.current) {
      viewer.entities.remove(eraseHighlightRef.current);
    }
    eraseHighlightRef.current = null;
  }, [viewerRef]);

  const addDraftPolylineDecorations = useCallback(
    (position: Cartesian3, previous?: Cartesian3) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;

      draftVertexEntitiesRef.current.push(
        viewer.entities.add({
          position,
          point: {
            pixelSize: 8,
            color: ACCENT,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      );
      if (previous) {
        draftSegmentLabelEntitiesRef.current.push(
          viewer.entities.add({
            position: Cartesian3.midpoint(previous, position, new Cartesian3()),
            label: {
              text: `${computeDistanceMeters([previous, position]).toFixed(2)} m`,
              font: "14px sans-serif",
              fillColor: Color.WHITE,
              showBackground: true,
              backgroundColor: Color.fromCssColorString("#18181B").withAlpha(0.9),
              backgroundPadding: new Cartesian2(8, 6),
              pixelOffset: new Cartesian2(0, -16),
              verticalOrigin: VerticalOrigin.BOTTOM,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        );
      }
    },
    [viewerRef]
  );

  const rebuildDraftPolylineDecorations = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    for (const entity of draftVertexEntitiesRef.current) viewer.entities.remove(entity);
    for (const entity of draftSegmentLabelEntitiesRef.current) viewer.entities.remove(entity);
    draftVertexEntitiesRef.current = [];
    draftSegmentLabelEntitiesRef.current = [];
    const pts = draftPositionsRef.current;
    for (let i = 0; i < pts.length; i++) {
      addDraftPolylineDecorations(pts[i], i > 0 ? pts[i - 1] : undefined);
    }
  }, [viewerRef, addDraftPolylineDecorations]);

  // Clears the probe marker + probe readout. The `probing` flag itself is reset
  // by the store `startDraw`/`cancelDraw` actions that every caller invokes.
  const stopProbe = useCallback(() => {
    store.getState().setProbePoint(null);
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed() && probeEntityRef.current) {
      viewer.entities.remove(probeEntityRef.current);
    }
    probeEntityRef.current = null;
  }, [store, viewerRef]);

  const cancelDraw = useCallback(() => {
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
  }, [store, cleanupDraw, stopProbe]);

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

  const startDraw = useCallback(
    (mode: DrawMode, opts?: DrawOptions) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      cleanupDraw();
      stopProbe();
      const s = store.getState();
      s.startDraw(mode, opts);
      s.clearSelection();
      const seeded = seedPointsRef.current;
      seedPointsRef.current = null;
      draftPositionsRef.current = seeded?.length ? [...seeded] : [];
      if (draftPositionsRef.current.length > 0) {
        s.setDraft(draftPositionsRef.current, null);
      }

      draftEntityRef.current = viewer.entities.add({
        position:
          mode === "polyline"
            ? new CallbackPositionProperty(() => {
                const pts = draftPositionsRef.current;
                return hoverPositionRef.current ?? pts[pts.length - 1];
              }, false)
            : undefined,
        polyline: {
          positions: new CallbackProperty(() => {
            const pts = draftPositionsRef.current;
            const hover = hoverPositionRef.current;
            const all = hover ? [...pts, hover] : pts;
            if (all.length < 2) return [];
            // An eraser-opened ring previews UN-closed — the erased edge is
            // genuinely gone until finish re-closes the ring.
            return mode === "polygon" && !polygonOpenRef.current ? [...all, all[0]] : all;
          }, false),
          width: 3,
          material: ACCENT,
          clampToGround: true,
        },
        polygon:
          mode === "polygon"
            ? {
                hierarchy: new CallbackProperty(() => {
                  const pts = draftPositionsRef.current;
                  const hover = hoverPositionRef.current;
                  return new PolygonHierarchy(hover ? [...pts, hover] : pts);
                }, false),
                // Fill implies closure — hide it while the ring is open.
                show: new CallbackProperty(() => !polygonOpenRef.current, false),
                material: ACCENT.withAlpha(0.2),
                classificationType: ClassificationType.BOTH,
              }
            : undefined,
        label:
          mode === "polyline"
            ? {
                show: new CallbackProperty(() => {
                  const pts = draftPositionsRef.current;
                  const hover = hoverPositionRef.current;
                  return !!hover && pts.length > 0 && computeDistanceMeters([pts[pts.length - 1], hover]) > 0.01;
                }, false),
                text: new CallbackProperty(() => {
                  const pts = draftPositionsRef.current;
                  const hover = hoverPositionRef.current;
                  if (!hover || pts.length === 0) return "";
                  const segment = [pts[pts.length - 1], hover];
                  const distance = computeDistanceMeters(segment);
                  const grade = opts?.slope ? computeGrade(segment) : null;
                  if (!grade) return `${distance.toFixed(2)} m`;
                  const arrow = grade.riseMeters >= 0 ? "↑" : "↓";
                  return `${distance.toFixed(2)} m\n${arrow} ${Math.abs(grade.riseMeters).toFixed(2)} m`;
                }, false),
                font: "16px sans-serif",
                fillColor: Color.WHITE,
                showBackground: true,
                backgroundColor: Color.fromCssColorString("#18181B").withAlpha(0.9),
                backgroundPadding: new Cartesian2(10, 7),
                pixelOffset: new Cartesian2(18, 16),
                horizontalOrigin: HorizontalOrigin.LEFT,
                verticalOrigin: VerticalOrigin.TOP,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              }
            : undefined,
      });
      if (mode === "polyline" && draftPositionsRef.current.length > 0) {
        rebuildDraftPolylineDecorations();
      }

      const finish = () => {
        // Kind resolves at FINISH time (not startDraw) so the calc type picked
        // in the right panel while drawing wins: explicit template kind →
        // panel calcType (validated against this geometry) → the mode's default
        // calc — the SAME fallback the panel displays as selected, so the saved
        // kind always matches what the user saw.
        const kind =
          opts?.kind ??
          kindForCalcType(store.getState().view.calcType, mode) ??
          defaultKindFor(mode);
        const pts = draftPositionsRef.current;
        const minPoints = mode === "polygon" ? 3 : 2;
        if (pts.length < minPoints) {
          toast.error(`Need at least ${minPoints} points for a ${mode}`);
          return;
        }

        // Calc params from the panel's config (the same source it edits). An
        // invalid config (e.g. custom RL without a value) keeps the DRAW alive
        // — the user fixes the panel and finishes again; nothing is lost.
        const editIdEarly = editingMeasurementIdRef.current;
        const existing = editIdEarly
          ? store.getState().measurements.find((m) => m.id === editIdEarly)
          : null;
        const resolvedKind = existing?.kind ?? kind;
        const params: Record<string, unknown> = { ...(opts?.params ?? {}) };
        if (opts?.slope) params.slope = true;
        if (isVolumeKind(resolvedKind)) {
          const view = store.getState().view;
          // Coerced onto the kind's method list — what persists always equals
          // what the panel displayed (a stale cut/fill pick never rides along).
          const cfg = coerceMethodForKind(
            {
              method: view.volumeMethod,
              refMode: view.refMode,
              refElevation: view.refElevation,
              baseDesignId: view.baseDesignId,
            },
            resolvedKind
          );
          params.volume_method = cfg.method;
          params.render = LEAN_RENDER; // number-only compute; tiles are a later, explicit ask
          try {
            const refs = surfaceRefsForMethod(cfg);
            params.from = refs.from;
            params.to = refs.to;
          } catch (err) {
            if (err instanceof CalcParamsError) {
              toast.warning(err.message);
              return;
            }
            throw err;
          }
        }

        const coords: [number, number][] = pts.map((p) => {
          const c = Cartographic.fromCartesian(p);
          return [
            Number(CesiumMath.toDegrees(c.longitude).toFixed(8)),
            Number(CesiumMath.toDegrees(c.latitude).toFixed(8)),
          ];
        });
        if (coords.length > minPoints) {
          const [lastLng, lastLat] = coords[coords.length - 1];
          const [prevLng, prevLat] = coords[coords.length - 2];
          if (Math.abs(lastLng - prevLng) < 1e-7 && Math.abs(lastLat - prevLat) < 1e-7) {
            coords.pop();
          }
        }
        if (drawHandlerRef.current) {
          drawHandlerRef.current.destroy();
          drawHandlerRef.current = null;
        }
        hoverPositionRef.current = null;

        const geometry =
          mode === "polygon"
            ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
            : { type: "LineString", coordinates: coords };

        // DRAFT-FIRST (2026-07-16): persist immediately as a draft row — no
        // naming gate — so compute can run on it right away through the normal
        // /compute call; the user promotes it (Save) or discards it from the
        // inspector. The local draft entity stays visible until the
        // measurements datasource re-renders the created row.
        // Editing an existing measurement (eraser on a selected stockpile, etc.)
        // PATCHes geometry in place instead of creating a new row.
        const editId = editingMeasurementIdRef.current;
        editingMeasurementIdRef.current = null;
        store.getState().cancelDraw(); // null out drawMode/activeDrawOpts/activeToolKey + reset draft mirror
        void (async () => {
          try {
            if (editId) {
              await updateMeasurement(surveyId, editId, { geometry });
              const s3 = store.getState();
              s3.setMeasurementVisible(editId, true);
              s3.selectMeasurement(editId, { fly: false });
              cleanupDraw();
              await refreshMeasurements();
              toast.success("Geometry updated");
              if (isVolumeKind(resolvedKind)) await triggerCompute(editId);
              return;
            }
            const created = await createMeasurement(surveyId, {
              kind: resolvedKind,
              name: `Untitled ${resolvedKind.replace(/_/g, " ")}`,
              folder: opts?.folder,
              geometry,
              params,
              draft: true,
            });
            const s3 = store.getState();
            s3.setMeasurements([created, ...s3.measurements]); // optimistic — list is newest-first
            s3.setMeasurementVisible(created.id, true); // show the just-drawn shape
            s3.selectMeasurement(created.id, { fly: false }); // opens the inspector on the draft
            cleanupDraw(); // drop the local draft entity — the datasource takes over
            await refreshMeasurements();
            if (isVolumeKind(resolvedKind)) await triggerCompute(created.id);
          } catch (err) {
            if (err instanceof Error) toast.error(`Couldn't create the draft: ${err.message}`);
            // The drawn shape stays visible (inert); ESC clears it.
          }
        })();
      };

      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      awaitingCalcRef.current = false;
      previousToolKeyRef.current = opts?.toolKey ?? null;
      polygonOpenRef.current = false; // fresh session: rings preview closed
      clearEraseHighlight();

      const bindDrawClick = () => {
        handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
          const pos = pickScenePosition(viewer, event.position);
          if (pos) {
            const previous = draftPositionsRef.current[draftPositionsRef.current.length - 1];
            if (previous && Cartesian3.distance(previous, pos) < 0.01) return;

            if (mode === "polyline") {
              addDraftPolylineDecorations(pos, previous);
            }

            redoPositionsRef.current = [];
            draftPositionsRef.current = [...draftPositionsRef.current, pos];
            hoverPositionRef.current = null;
            store.getState().setDraft(draftPositionsRef.current, null);
            viewer.scene.requestRender();
          }
        }, ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
          const pos = pickScenePosition(viewer, movement.endPosition);
          hoverPositionRef.current = pos;
          const now = performance.now();
          if (now - hoverThrottleRef.current > 100) {
            hoverThrottleRef.current = now;
            store.getState().setDraft(draftPositionsRef.current, pos);
          }
          viewer.scene.requestRender();
        }, ScreenSpaceEventType.MOUSE_MOVE);
      };

      const bindEraseClick = () => {
        handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
        hoverPositionRef.current = null;
        store.getState().setDraft(draftPositionsRef.current, null);

        handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
          const pts = draftPositionsRef.current;
          const idx = findNearestSegmentIndex(viewer, pts, movement.endPosition, {
            closed: mode === "polygon",
            maxPixelDistance: 28,
          });
          clearEraseHighlight();
          if (idx === null || pts.length < 2) {
            viewer.scene.requestRender();
            return;
          }
          const a = pts[idx];
          const b = pts[(idx + 1) % pts.length];
          eraseHighlightRef.current = viewer.entities.add({
            polyline: {
              positions: [a, b],
              width: 5,
              material: Color.WHITE.withAlpha(0.85),
              clampToGround: true,
            },
          });
          viewer.scene.requestRender();
        }, ScreenSpaceEventType.MOUSE_MOVE);

        handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
          const pts = draftPositionsRef.current;
          const idx = findNearestSegmentIndex(viewer, pts, event.position, {
            closed: mode === "polygon",
            maxPixelDistance: 28,
          });
          if (idx === null) {
            toast.info("No segment under the cursor — click closer to a line");
            return;
          }
          const next = eraseSegment(pts, idx, mode === "polygon");
          if (next === null) return;
          clearEraseHighlight();

          if (next.length === 0) {
            // A lone line's only segment: erasing it erases the LINE itself —
            // the measurement when editing one, else the whole draft.
            const editId = editingMeasurementIdRef.current;
            editingMeasurementIdRef.current = null;
            cleanupDraw();
            const s = store.getState();
            s.cancelDraw();
            s.closeDetail();
            s.clearSelection();
            if (editId) {
              void (async () => {
                try {
                  await deleteMeasurement(surveyId, editId);
                  toast.success("Line erased");
                } catch (err) {
                  if (err instanceof Error) toast.error(err.message);
                } finally {
                  void refreshMeasurements();
                }
              })();
            } else {
              toast.success("Line erased");
            }
            return;
          }

          if (mode === "polygon") {
            // Ring reopened at the erased edge (all vertices kept): preview
            // stops auto-closing, new vertices append INTO the gap, finish
            // re-closes across whatever remains.
            polygonOpenRef.current = true;
          }
          draftPositionsRef.current = next;
          redoPositionsRef.current = [];
          if (mode === "polyline") rebuildDraftPolylineDecorations();
          store.getState().setDraft(next, null);
          viewer.scene.requestRender();
          const minPoints = mode === "polygon" ? 3 : 2;
          if (next.length < minPoints) {
            toast.info("Segment erased — add more vertices before calculating");
          } else if (mode === "polygon") {
            toast.info("Edge erased — add vertices in the gap, or double-click to close and save");
          }
        }, ScreenSpaceEventType.LEFT_CLICK);
      };

      bindDrawClickRef.current = bindDrawClick;
      bindEraseClickRef.current = bindEraseClick;
      bindFinishDblClickRef.current = () => {
        handler.setInputAction(() => finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      };

      // Right-click: stop placing vertices, unclip the toolbar tool, and open
      // calculation options for this drawing. Double-click afterward runs the
      // selected calculation (finish).
      const releaseForCalc = () => {
        const pts = draftPositionsRef.current;
        const minPoints = mode === "polygon" ? 3 : 2;
        if (pts.length === 0) {
          cancelDraw();
          return;
        }
        if (pts.length < minPoints) {
          toast.error(`Need at least ${minPoints} points for a ${mode}`);
          return;
        }

        clearEraseHighlight();
        handler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
        handler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
        hoverPositionRef.current = null;
        awaitingCalcRef.current = true;
        store.getState().setDraft(pts, null);
        // Unclip the toolkit button; keep drawMode so the Calculation panel
        // still offers geometry-specific options.
        store.setState({ activeToolKey: null });
        store.getState().openDetail("measure");
        handler.setInputAction(() => finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        viewer.scene.requestRender();
      };

      bindDrawClick();
      handler.setInputAction(() => releaseForCalc(), ScreenSpaceEventType.RIGHT_CLICK);
      drawHandlerRef.current = handler;
      store.getState().openDetail("measure");
    },
    [
      store,
      viewerRef,
      cleanupDraw,
      stopProbe,
      cancelDraw,
      surveyId,
      refreshMeasurements,
      triggerCompute,
      addDraftPolylineDecorations,
      rebuildDraftPolylineDecorations,
      clearEraseHighlight,
    ]
  );

  // Eraser is a pick mode: click a draft segment to delete that edge. Works on
  // an in-progress drawing OR a selected measurement (e.g. a finished stockpile).
  const eraseDraft = useCallback(() => {
    const s = store.getState();
    const viewer = viewerRef.current;

    if (s.probing) {
      if (!s.probePoint && !probeEntityRef.current) {
        toast.info("Nothing to erase — sample a point first");
        return;
      }
      s.setProbePoint(null);
      if (viewer && !viewer.isDestroyed() && probeEntityRef.current) {
        viewer.entities.remove(probeEntityRef.current);
      }
      probeEntityRef.current = null;
      viewer?.scene.requestRender();
      return;
    }

    // Revive draft verts from the store mirror if refs were cleared (HMR / etc.).
    if (draftPositionsRef.current.length < 2 && s.draft.points.length >= 2) {
      draftPositionsRef.current = [...s.draft.points];
    }

    // Toggle eraser off.
    if (s.activeToolKey === "palette:eraser" && s.drawMode && drawHandlerRef.current) {
      clearEraseHighlight();
      if (awaitingCalcRef.current) {
        drawHandlerRef.current.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
        drawHandlerRef.current.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
        store.setState({ activeToolKey: null });
      } else {
        bindDrawClickRef.current?.();
        store.setState({ activeToolKey: previousToolKeyRef.current });
      }
      return;
    }

    // In-progress draw: arm segment picking.
    if (s.drawMode) {
      if (draftPositionsRef.current.length < 2) {
        toast.info("Nothing to erase — need a line between two vertices");
        return;
      }
      if (!drawHandlerRef.current || !bindEraseClickRef.current) {
        // Handler was lost — re-seed and restart the draw session, then erase.
        seedPointsRef.current = [...draftPositionsRef.current];
        const opts = s.activeDrawOpts ?? undefined;
        startDraw(s.drawMode, { ...opts, toolKey: opts?.toolKey ?? previousToolKeyRef.current ?? undefined });
      }
      previousToolKeyRef.current = s.activeToolKey ?? previousToolKeyRef.current;
      bindEraseClickRef.current?.();
      store.setState({ activeToolKey: "palette:eraser" });
      toast.info("Click a segment to erase it");
      return;
    }

    // Selected measurement (stockpile / line / etc.): load geometry into an edit session.
    const selectedId =
      s.selection?.kind === "measurement" ? s.selection.measurementIds[0] : null;
    const selected = selectedId ? s.measurements.find((m) => m.id === selectedId) : null;
    if (!selected?.geometry) {
      toast.info("Nothing to erase — draw a shape or select a measurement first");
      return;
    }
    const pts = geometryPositions(selected.geometry);
    const mode: DrawMode | null =
      selected.geometry.type === "Polygon"
        ? "polygon"
        : selected.geometry.type === "LineString"
          ? "polyline"
          : null;
    if (!mode || pts.length < 2) {
      toast.info("Nothing to erase — this measurement has no erasable segments");
      return;
    }

    editingMeasurementIdRef.current = selected.id;
    seedPointsRef.current = pts;
    s.setMeasurementVisible(selected.id, false);
    startDraw(mode, { label: selected.name, toolKey: "palette:eraser" });
    awaitingCalcRef.current = true;
    // Lock for calc/edit: no new vertices until eraser exits; double-click
    // saves — bindFinishDblClickRef arms it (this path never goes through
    // releaseForCalc, which is where drawing normally gains that binding).
    if (drawHandlerRef.current) {
      drawHandlerRef.current.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
      drawHandlerRef.current.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
    }
    bindEraseClickRef.current?.();
    bindFinishDblClickRef.current?.();
    store.setState({ activeToolKey: "palette:eraser" });
    store.getState().openDetail("measure");
    toast.info("Click a segment to erase it — double-click when done");
  }, [store, viewerRef, clearEraseHighlight, startDraw]);

  const undoLastVertex = useCallback(() => {
    if (!store.getState().drawMode || draftPositionsRef.current.length === 0) {
      toast.info("Nothing to undo — place a vertex first");
      return;
    }
    const position = draftPositionsRef.current[draftPositionsRef.current.length - 1];
    draftPositionsRef.current = draftPositionsRef.current.slice(0, -1);
    redoPositionsRef.current.push(position);
    const viewer = viewerRef.current;
    const vertex = draftVertexEntitiesRef.current.pop();
    if (viewer && vertex) viewer.entities.remove(vertex);
    const segmentLabel = draftSegmentLabelEntitiesRef.current.pop();
    if (viewer && segmentLabel) viewer.entities.remove(segmentLabel);
    store.getState().setDraft(draftPositionsRef.current, hoverPositionRef.current);
    viewerRef.current?.scene.requestRender();
  }, [store, viewerRef]);

  const redoLastVertex = useCallback(() => {
    const mode = store.getState().drawMode;
    const position = redoPositionsRef.current.pop();
    if (!mode || !position) {
      toast.info("Nothing to redo");
      return;
    }

    const previous = draftPositionsRef.current[draftPositionsRef.current.length - 1];
    if (mode === "polyline") addDraftPolylineDecorations(position, previous);
    draftPositionsRef.current = [...draftPositionsRef.current, position];
    store.getState().setDraft(draftPositionsRef.current, hoverPositionRef.current);
    viewerRef.current?.scene.requestRender();
  }, [store, viewerRef, addDraftPolylineDecorations]);

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
      startDraw,
      startProbe,
      cancelDraw,
      eraseDraft,
      undoLastVertex,
      redoLastVertex,
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
      startDraw,
      startProbe,
      cancelDraw,
      eraseDraft,
      undoLastVertex,
      redoLastVertex,
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
  );
}
