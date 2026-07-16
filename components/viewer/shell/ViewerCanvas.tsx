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
// dock (layers on survey, collapsed on measure), the RIGHT MeasureSidebar
// (measurements list + detail on measure), docked StatusBar spanning cols 2–4,
// the slide-in DetailPanel kept for non-measure feature picking, and the
// CameraJoystick overlay with the slide-in-aware right offset.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewer } from "resium";
import {
  BoundingSphere,
  CallbackProperty,
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
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type TerrainProvider,
  createWorldTerrainAsync,
} from "cesium";
import { toast } from "sonner";

import {
  computeMeasurement,
  createMeasurement,
  deleteMeasurement,
  getManifest,
  listMeasurements,
} from "@/lib/api/assetSvc";
import { ApiError } from "@/lib/api/client";
import {
  computeAreaSquareMeters,
  computeDistanceMeters,
  computeGrade,
  computePerimeterMeters,
  geometryToRectangle,
  pickScenePosition,
} from "@/lib/viewer/measure";
import {
  CalcParamsError,
  defaultKindFor,
  isVolumeKind,
  kindForCalcType,
  metricsOf,
  surfaceRefsForMethod,
} from "@/lib/viewer/calc";
import { buildPointCloudStyle } from "@/lib/viewer/pointcloud";
import { USE_WORLD_TERRAIN } from "@/lib/viewer/cesiumIon";
import {
  ACCENT,
  isThinSurfaceMesh,
  manifestLayersEmpty,
  proxyGcsUrls,
  type LayerHandle,
  type PendingDraw,
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
import { MeasureSidebar } from "@/components/viewer/shell/MeasureSidebar";
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

export function ViewerCanvas() {
  const { viewerRef, viewerReady, handleViewerRef, baseImageryRef } = useCesiumViewer();
  const store = useViewerStoreApi();

  // -------------------------------------------------------- reactive reads
  const surveyId = useViewerStore((s) => s.surveyId);
  const manifest = useViewerStore((s) => s.manifest);
  const measurements = useViewerStore((s) => s.measurements);
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
  // The just-drawn draft being named — it has no id in the measurements list,
  // so it cannot live in the store's id-based selection (§3.3); it is passed to
  // DetailPanel as a prop.
  const [draftMeasurement, setDraftMeasurement] = useState<PanelMeasurement | null>(null);
  const [clipInputsVersion, setClipInputsVersion] = useState(0);

  // -------------------------------------------------------- refs (§3.2)
  const handlesRef = useRef<Map<string, LayerHandle>>(new Map());
  const visibleRef = useRef<Map<string, boolean>>(new Map());
  const layersSignatureRef = useRef<string>("");
  const cameraTargetRef = useRef<CameraTarget>("none");
  const drawHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const draftPositionsRef = useRef<Cartesian3[]>([]);
  const draftEntityRef = useRef<Entity | null>(null);
  const hoverPositionRef = useRef<Cartesian3 | null>(null);
  const hoverThrottleRef = useRef(0);
  const probeEntityRef = useRef<Entity | null>(null);
  const measurementDsRef = useRef<GeoJsonDataSource | null>(null);
  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  const measurementsSigRef = useRef<string>("");
  const searchRef = useRef<string>("");
  const appliedSearchRef = useRef<string>("");
  const pendingDrawRef = useRef<PendingDraw | null>(null);
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
    draftEntityRef.current = null;
    draftPositionsRef.current = [];
    hoverPositionRef.current = null;
    store.getState().setDraft([], null);
  }, [store, viewerRef]);

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
    cleanupDraw();
    stopProbe();
    const s = store.getState();
    s.cancelDraw();
    s.closeDetail();
    s.clearSelection();
    setDraftMeasurement(null);
    pendingDrawRef.current = null;
  }, [store, cleanupDraw, stopProbe]);

  const startProbe = useCallback(
    (toolKey?: string) => {
      cleanupDraw();
      const s = store.getState();
      s.startProbe(toolKey);
      s.clearSelection();
      setDraftMeasurement(null);
      pendingDrawRef.current = null;
      s.openDetail("measure");
    },
    [store, cleanupDraw]
  );

  const startDraw = useCallback(
    (mode: DrawMode, opts?: DrawOptions) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      cleanupDraw();
      stopProbe();
      pendingDrawRef.current = null;
      const s = store.getState();
      s.startDraw(mode, opts);
      s.clearSelection();
      setDraftMeasurement(null);
      draftPositionsRef.current = [];

      draftEntityRef.current = viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => {
            const pts = draftPositionsRef.current;
            const hover = hoverPositionRef.current;
            const all = hover ? [...pts, hover] : pts;
            if (all.length < 2) return [];
            return mode === "polygon" ? [...all, all[0]] : all;
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
                material: ACCENT.withAlpha(0.2),
                classificationType: ClassificationType.BOTH,
              }
            : undefined,
      });

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

        const statPts = pts.slice(0, coords.length);
        const localStats: Record<string, number> =
          mode === "polygon"
            ? {
                area_m2: computeAreaSquareMeters(statPts),
                perimeter_m: computePerimeterMeters(statPts),
              }
            : { length_m: computeDistanceMeters(statPts) };
        if (mode === "polyline" && opts?.slope) {
          const grade = computeGrade(statPts);
          if (grade) localStats.grade_percent = Number(grade.percent.toFixed(2));
        }

        const tempMeasurement: PanelMeasurement = {
          id: `new-${Date.now()}`,
          client_id: "",
          survey_id: surveyId,
          name: "",
          kind,
          folder: opts?.folder,
          status: "draft",
          created_at: "",
          updated_at: "",
          result: localStats,
        };
        pendingDrawRef.current = {
          mode,
          coords,
          kind,
          folder: opts?.folder,
          slope: opts?.slope,
          params: opts?.params,
        };
        const s2 = store.getState();
        s2.cancelDraw(); // null out drawMode/activeDrawOpts/activeToolKey + reset draft
        setDraftMeasurement(tempMeasurement);
        s2.setIsInspectingNew(true);
        s2.openDetail("inspect");
      };

      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
        const pos = pickScenePosition(viewer, event.position);
        if (pos) {
          draftPositionsRef.current = [...draftPositionsRef.current, pos];
          store.getState().setDraft(draftPositionsRef.current, hoverPositionRef.current);
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
      handler.setInputAction(() => finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      handler.setInputAction(() => finish(), ScreenSpaceEventType.RIGHT_CLICK);
      drawHandlerRef.current = handler;
      store.getState().openDetail("measure");
    },
    [store, viewerRef, cleanupDraw, stopProbe, surveyId]
  );

  const undoLastVertex = useCallback(() => {
    if (!store.getState().drawMode || draftPositionsRef.current.length === 0) {
      toast.info("Nothing to undo — place a vertex first");
      return;
    }
    draftPositionsRef.current = draftPositionsRef.current.slice(0, -1);
    store.getState().setDraft(draftPositionsRef.current, hoverPositionRef.current);
    viewerRef.current?.scene.requestRender();
  }, [store, viewerRef]);

  // ------------------------------------------------------------ ops (CRUD)
  const triggerCompute = useCallback(
    async (id: string, override?: Record<string, unknown>) => {
      store.getState().setBusy(id, true);
      try {
        await computeMeasurement(surveyId, id, override ? { params: override } : undefined);
        toast.info("Compute dispatched — result will appear when ready");
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
    [surveyId, store, refreshMeasurements]
  );

  const saveMeasurement = useCallback(
    async (name: string) => {
      if (!pendingDrawRef.current || !name.trim()) return;
      store.getState().setSaving(true);
      try {
        const { mode, coords, kind, folder, slope, params: presetParams } = pendingDrawRef.current;
        const geometry =
          mode === "polygon"
            ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
            : { type: "LineString", coordinates: coords };

        const params: Record<string, unknown> = { ...(presetParams ?? {}) };
        if (slope) params.slope = true;
        if (isVolumeKind(kind)) {
          // Persist the panel's base-method config as explicit from/to
          // SurfaceRefs (§3.1 — "the row always states what ran"; cut_fill has
          // no server-side default). volume_method stays for display.
          const view = store.getState().view;
          params.volume_method = view.volumeMethod;
          try {
            const refs = surfaceRefsForMethod({
              method: view.volumeMethod,
              refMode: view.refMode,
              refElevation: view.refElevation,
              baseDesignId: view.baseDesignId,
            });
            params.from = refs.from;
            params.to = refs.to;
          } catch (err) {
            if (err instanceof CalcParamsError) {
              toast.warning(err.message);
              store.getState().setSaving(false);
              return;
            }
            throw err;
          }
        }

        const created = await createMeasurement(surveyId, {
          kind,
          name: name.trim(),
          folder,
          geometry,
          params,
        });
        toast.success(`Measurement "${created.name}" created`);
        cleanupDraw();
        pendingDrawRef.current = null;
        const s = store.getState();
        s.closeDetail();
        s.clearSelection();
        setDraftMeasurement(null);
        await refreshMeasurements();
        if (isVolumeKind(kind)) await triggerCompute(created.id);
      } catch (err) {
        if (err instanceof Error) toast.error(err.message);
      } finally {
        store.getState().setSaving(false);
      }
    },
    [surveyId, store, cleanupDraw, refreshMeasurements, triggerCompute]
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

  // Tree-row click: inspect the measurement and frame its geometry (§ non-neg 3
  // — selecting flies). A map pick, by contrast, does not fly (useScenePicking).
  const selectMeasurementRow = useCallback(
    (m: PanelMeasurement) => {
      store.getState().selectMeasurement(m.id, { fly: false });
      setDraftMeasurement(null);
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
          ...metricsOf(m.result),
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
      undoLastVertex,
      selectMeasurementRow,
      triggerCompute,
      removeMeasurement,
      saveMeasurement,
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
      undoLastVertex,
      selectMeasurementRow,
      triggerCompute,
      removeMeasurement,
      saveMeasurement,
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
  // measure, layers on survey; RE-PIVOT 2026-07-16: the user wants the
  // measurements list back on the left, "how it was"); col 3 the Cesium canvas
  // with the FLOATING toolbar overlaid top-center (measure module only); col 4
  // the RIGHT calc/detail dock — Calculation panel while drawing, inspector
  // when a measurement is selected — which opens ON DEMAND (`detailPanel`
  // non-null) and collapses to 0 otherwise. Row 2 is the StatusBar spanning
  // cols 2–4. The slide-in DetailPanel + CameraJoystick are absolute overlays
  // INSIDE the canvas cell — they MUST NOT resize it (D10). The slide-in is
  // kept only for NON-measure modules (feature picking on survey); the measure
  // module's detail lives in the right dock, so the joystick only shifts for
  // the slide-in.
  const isMeasure = activeModule === "measure";
  const leftPanelVisible = treePanelOpen; // the list dock, all modules
  const rightPanelVisible = isMeasure && detailPanel !== null; // calc/detail, on demand
  const overlayDetailVisible = detailPanel !== null && !isMeasure; // slide-in only off-measure

  return (
    <ViewerActionsProvider value={actions}>
      <div
        className="grid h-full w-full bg-[#0A0D14]"
        style={{
          gridTemplateColumns: `48px ${leftPanelVisible ? "280px" : "0px"} minmax(0, 1fr) ${
            rightPanelVisible ? "320px" : "0px"
          }`,
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

        {/* Zones 3/4 — canvas cell: the floating toolbar overlays the Cesium
            container top-center (measure module only). */}
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

          {/* Zero-size anchor: the joystick positions right-6/bottom-6 against
              it. Off-measure it slides left to clear the open slide-in
              (12px gutter + 320px panel = 332px); on measure the right dock is
              a grid column that already shrinks this cell, so no shift. The
              wrapper has no area, so it never intercepts canvas pointer events. */}
          <div
            className="absolute bottom-0 h-0 w-0 transition-[right] duration-200 ease-out"
            style={{ right: overlayDetailVisible ? 332 : 0 }}
          >
            <CameraJoystick viewerRef={viewerRef} ready={viewerReady} />
          </div>

          {/* Zone 5 — slide-in detail overlay, kept for NON-measure modules
              (the measure module inspects inside the right dock instead). */}
          {!isMeasure && <DetailPanel draftMeasurement={draftMeasurement} />}
        </div>

        {/* Right dock — calc/detail (measure module): the Calculation panel
            while drawing, the inspector once something is selected. Opens on
            demand (detailPanel non-null); the list stays LEFT. */}
        <div className="min-h-0 min-w-0 overflow-hidden">
          {rightPanelVisible && <MeasureSidebar draftMeasurement={draftMeasurement} />}
        </div>

        {/* Zone 6 — status bar, docked, spanning cols 2–4 */}
        <div className="col-span-3 min-w-0">
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
