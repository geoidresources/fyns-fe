"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewer } from "resium";
import type { CesiumComponentRef } from "resium";
import {
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Cesium3DTileFeature,
  Cesium3DTileset,
  Cesium3DTileStyle,
  CesiumTerrainProvider,
  ClassificationType,
  Color,
  ConstantPositionProperty,
  EllipsoidTerrainProvider,
  Entity,
  GeoJsonDataSource,
  ImageryLayer,
  Ion,
  JulianDate,
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  RequestScheduler,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type TerrainProvider,
  UrlTemplateImageryProvider,
  Viewer as CesiumViewer,
  createWorldTerrainAsync,
  defined,
} from "cesium";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import {
  computeMeasurement,
  createMeasurement,
  deleteMeasurement,
  getManifest,
  listMeasurements,
  type AssetLayer,
  type Manifest,
  type Measurement,
  type SiteModelLayer,
} from "@/lib/api/assetSvc";
import { getProject } from "@/lib/api/userSvc";
import { ApiError } from "@/lib/api/client";
import {
  LayerPanel,
  type LayerControl,
  type DesignControl,
} from "@/components/viewer/LayerPanel";
import {
  MeasurementPanel,
  type DrawMode,
  type DrawOptions,
} from "@/components/viewer/MeasurementPanel";
import { MeasurePalette, type LiveReadout } from "@/components/viewer/MeasurePalette";
import { FeatureInspector } from "@/components/viewer/FeatureInspector";
import { ViewerToolRail } from "@/components/viewer/ViewerToolRail";
import { ViewerDrawToolbar } from "@/components/viewer/ViewerDrawToolbar";
import { ViewerStatusBar } from "@/components/viewer/ViewerStatusBar";
import { SurveyList } from "@/components/viewer/SurveyList";
import {
  SAMPLE_DESIGNS,
  SAMPLE_MEASUREMENTS,
  type PanelMeasurement,
} from "@/lib/viewer/sampleData";
import {
  computeAreaSquareMeters,
  computeDistanceMeters,
  computeGrade,
  computePerimeterMeters,
  geometryToRectangle,
  normalizeSelectedFeature,
  pickScenePosition,
  toLngLatHeight,
  type LngLatHeight,
} from "@/lib/viewer/measure";
import {
  DEFAULT_POINT_BUDGET,
  applyDynamicEyeDomeLighting,
  buildPointCloudStyle,
  correctGeographicRootTransform,
  pointBudgetToCacheBytes,
  pointBudgetToMaximumScreenSpaceError,
} from "@/lib/viewer/pointcloud";
import { CameraJoystick } from "@/components/viewer/CameraJoystick";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-05-18" → "18 MAY"; falls back to the raw string. */
function shortDate(date?: string): string {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1] ?? "";
  return `${Number(m[3])} ${month}`.trim();
}

/** A thin DXF site model is a CAD surface (floats/cliffs, single-sided) — NOT a
 * complete photogrammetry reality mesh. Everything else (3mx/osgb/obj/3tz/…, or
 * unknown) is treated as a real mesh that renders crisp on terrain. */
function isThinSurfaceMesh(sourceFormat?: string): boolean {
  return (sourceFormat || "").trim().toLowerCase() === "dxf";
}

/** A design's format determines whether we can draw it client-side. */
function designIsGeoJson(format?: string, url?: string): boolean {
  const f = (format || "").toLowerCase();
  if (f.includes("geojson") || f.includes("json")) return true;
  return !!url && /\.geojson(\?|$)/i.test(url);
}

// Default camera target (Kalinga Vihar) when neither layer bbox nor project
// center is available yet.
const DEFAULT_CENTER = { lat: 20.2587, lng: 85.7571, height: 3000 };

const ACCENT = Color.fromCssColorString("#C97A4E");

// Global terrain base. With a Cesium ion token set, the viewer uses Cesium World
// Terrain as the base so a survey sits inside real surrounding elevation — the
// textured reality mesh renders ON the ground (no floating/cliff), the
// "digital-twin" look. Without a token it stays the flat ellipsoid + DSM-drape.
const ION_TOKEN = (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "").trim();
const USE_WORLD_TERRAIN = ION_TOKEN.length > 0;
if (USE_WORLD_TERRAIN) Ion.defaultAccessToken = ION_TOKEN;

// ------------------------------------------------------------- url helpers

/** Picks an XYZ {z}/{x}/{y} template from a processor's output_urls bundle. */
function pickXyzTemplate(urls?: Record<string, string>): string | null {
  if (!urls) return null;
  if (urls.template) return urls.template;
  for (const v of Object.values(urls)) {
    if (typeof v === "string" && v.includes("{z}")) return v;
  }
  if (urls.directory) return urls.directory.replace(/\/+$/, "") + "/{z}/{x}/{y}.png";
  return null;
}

/** Picks the 3D Tiles tileset.json URL from a pointcloud output_urls bundle. */
function pickTilesetUrl(urls?: Record<string, string>): string | null {
  if (!urls) return null;
  if (urls.tileset_json) return urls.tileset_json;
  for (const v of Object.values(urls)) {
    if (typeof v === "string" && v.includes("tileset.json")) return v;
  }
  return null;
}

/** lens_slope_tiles -> "Slope" */
function lensLabel(key: string): string {
  const name = key.replace(/^lens_/, "").replace(/_tiles$/, "").replace(/_/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// proxyGcsUrls deep-rewrites storage.googleapis.com URLs onto the app's /gcs
// same-origin proxy (next.config.ts rewrites) — the bucket has no CORS policy
// and Cesium's WebGL fetches require it. Applied once at manifest load so
// every consumer (imagery, terrain, tilesets, GeoJSON) sees proxied URLs.
const GCS_PREFIX = "https://storage.googleapis.com/";
function proxyGcsUrls<T>(value: T): T {
  if (typeof value === "string") {
    return (value.startsWith(GCS_PREFIX)
      ? "/gcs/" + value.slice(GCS_PREFIX.length)
      : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(proxyGcsUrls) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = proxyGcsUrls(v);
    }
    return out as T;
  }
  return value;
}

function bboxToRectangle(bbox?: number[]): Rectangle | undefined {
  if (!bbox || bbox.length !== 4) return undefined;
  const [west, south, east, north] = bbox;
  if ([west, south, east, north].some((n) => typeof n !== "number" || isNaN(n))) return undefined;
  // Reject degenerate boxes (a processor that didn't compute a bbox emits
  // [0,0,0,0]); unioning one into the camera target drags the view to null
  // island and the survey ends up framed with a quarter of the planet.
  if (west >= east || south >= north) return undefined;
  try {
    return Rectangle.fromDegrees(west, south, east, north);
  } catch {
    return undefined;
  }
}

function manifestLayersEmpty(m: Manifest | null): boolean {
  if (!m) return true;
  const l = m.layers;
  return (
    !(l.terrain?.length) &&
    !(l.ortho?.length) &&
    !(l.pointcloud?.length) &&
    !(l.lenses?.length) &&
    !(l.vectors?.length) &&
    !(l.site_models?.length)
  );
}

// ------------------------------------------------------------ layer handles

type LayerHandle =
  | { type: "imagery"; layer: ImageryLayer }
  | { type: "terrain"; url: string }
  | { type: "tileset"; tileset: Cesium3DTileset }
  | { type: "datasource"; ds: GeoJsonDataSource }
  // Large GeoJSON (contours) parses + batches into big typed arrays — done
  // lazily on first toggle so opening the viewer never pays that cost.
  | { type: "geojson-lazy"; url: string; loading?: boolean };

interface PendingDraw {
  mode: DrawMode;
  coords: [number, number][]; // [lng, lat]
  kind: "volume" | "cross_section";
  folder?: string;
  slope?: boolean;
}

export function SurveyViewer({ surveyId }: { surveyId: string }) {
  // The Cesium viewer is a mutable external object — keep it in a ref and use
  // a ready flag to (re)run the effects that depend on it.
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"layers" | "surveys">("layers");
  const [layerControls, setLayerControls] = useState<LayerControl[]>([]);
  const [designControls, setDesignControls] = useState<DesignControl[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rightPanel, setRightPanel] = useState<"measure" | "inspect" | null>(null);
  const [selectedMeasurement, setSelectedMeasurement] = useState<Measurement | PanelMeasurement | null>(null);
  const [isInspectingNew, setIsInspectingNew] = useState(false);
  // Non-measurement map feature picked with the select tool (GeoJSON vector /
  // design properties, 3D-tiles batch attributes) — ported feature inspection.
  const [pickedFeature, setPickedFeature] = useState<Record<string, unknown> | null>(null);
  // Probe tool: sample lng/lat/elevation at a clicked surface point.
  const [probing, setProbing] = useState(false);
  const [probePoint, setProbePoint] = useState<LngLatHeight | null>(null);
  // Live draft geometry mirrored into state so the Measure palette readout
  // updates as vertices are placed (spec §7.2); refs stay the render source.
  const [draftPoints, setDraftPoints] = useState<Cartesian3[]>([]);
  const [hoverPoint, setHoverPoint] = useState<Cartesian3 | null>(null);
  const [activeDrawOpts, setActiveDrawOpts] = useState<DrawOptions | null>(null);
  const [volumeMethod, setVolumeMethod] = useState("smart-base");
  const [terrainExaggeration, setTerrainExaggeration] = useState(1);

  const handlesRef = useRef<Map<string, LayerHandle>>(new Map());
  // Latest user-facing visibility per layer key. Tilesets resolve LONG after
  // the user may have toggled them (a 1.4GB reality mesh takes a while) — the
  // async load callback must honour the current toggle state, not a stale
  // hardcoded default, or the layer can never be turned on.
  const visibleRef = useRef<Map<string, boolean>>(new Map());
  const layersSignatureRef = useRef<string>("");
  const cameraTargetRef = useRef<"none" | "center" | "bbox">("none");
  const drawHandlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const draftPositionsRef = useRef<Cartesian3[]>([]);
  const draftEntityRef = useRef<Entity | null>(null);
  // Rubber-band vertex under the cursor while drawing (per-frame, read by the
  // draft entity's CallbackProperty).
  const hoverPositionRef = useRef<Cartesian3 | null>(null);
  // Throttles the hover state mirror — the readout re-renders at ~10Hz while
  // the draft entity itself tracks the ref every frame.
  const hoverThrottleRef = useRef(0);
  const probeEntityRef = useRef<Entity | null>(null);
  const measurementDsRef = useRef<GeoJsonDataSource | null>(null);
  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  const pendingDrawRef = useRef<PendingDraw | null>(null);

  const layersEmpty = manifestLayersEmpty(manifest);

  // Updates a layer row's async meta (loading spinner / load error) once its
  // tileset or vector fetch settles.
  const patchControl = useCallback((key: string, patch: Partial<LayerControl>) => {
    setLayerControls((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  // ------------------------------------------------------------- data load

  const loadManifest = useCallback(async () => {
    try {
      const m = await getManifest(surveyId);
      setManifest(proxyGcsUrls(m));
      setManifestError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        setManifestError(err.message);
      }
    }
  }, [surveyId]);

  const refreshMeasurements = useCallback(async () => {
    try {
      const res = await listMeasurements(surveyId);
      const list = res.measurements || [];
      // Toast on compute completion/failure transitions.
      for (const m of list) {
        const prev = prevStatusesRef.current.get(m.id);
        if (prev === "computing" && m.status === "completed") {
          toast.success(`Measurement "${m.name}" computed`);
        } else if (prev === "computing" && m.status === "failed") {
          toast.error(`Measurement "${m.name}" failed to compute`);
        }
      }
      prevStatusesRef.current = new Map(list.map((m) => [m.id, m.status]));
      setMeasurements(list);
    } catch (err) {
      console.error("Failed to fetch measurements:", err);
    }
  }, [surveyId]);

  useEffect(() => {
    // Async loads — state updates land after the fetch resolves, not in-render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadManifest();
    refreshMeasurements();
  }, [loadManifest, refreshMeasurements]);

  // Poll the manifest every 30s while processors are still running.
  useEffect(() => {
    if (!layersEmpty) return;
    const t = setInterval(loadManifest, 30_000);
    return () => clearInterval(t);
  }, [layersEmpty, loadManifest]);

  // Poll measurements every 5s while any compute is in flight.
  const anyComputing = measurements.some((m) => m.status === "computing");
  useEffect(() => {
    if (!anyComputing) return;
    const t = setInterval(refreshMeasurements, 5_000);
    return () => clearInterval(t);
  }, [anyComputing, refreshMeasurements]);

  // ------------------------------------------------------------ camera

  const flyToRectangle = useCallback((rect: Rectangle) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({ destination: rect, duration: 2.0 });
  }, []);

  // Fly to the survey bbox when layers exist; fall back to the project center.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed() || !manifest) return;

    const rects = [
      ...(manifest.layers.terrain || []).map((l) => bboxToRectangle(l.bbox)),
      ...(manifest.layers.ortho || []).map((l) => bboxToRectangle(l.bbox)),
      ...(manifest.layers.lenses || []).map((l) => bboxToRectangle(l.bbox)),
      ...(manifest.layers.pointcloud || []).map((l) => bboxToRectangle(l.bbox)),
    ].filter((r): r is Rectangle => !!r);

    if (rects.length > 0) {
      if (cameraTargetRef.current !== "bbox") {
        cameraTargetRef.current = "bbox";
        const union = rects.reduce((acc, r) => Rectangle.union(acc, r, new Rectangle()), rects[0]);
        flyToRectangle(union);
      }
      return;
    }

    if (cameraTargetRef.current !== "none") return;
    cameraTargetRef.current = "center";
    let cancelled = false;
    getProject(manifest.survey.project_id)
      .then((p) => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        const lat = p.center_lat ?? DEFAULT_CENTER.lat;
        const lng = p.center_lng ?? DEFAULT_CENTER.lng;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lng, lat, DEFAULT_CENTER.height),
          duration: 2.0,
        });
      })
      .catch(() => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(DEFAULT_CENTER.lng, DEFAULT_CENTER.lat, DEFAULT_CENTER.height),
          duration: 2.0,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [viewerReady, manifest, flyToRectangle]);

  // -------------------------------------------------------- scene setup

  // One-time scene configuration ported from rendering-engine-fe's production
  // viewer: depth-test clamped overlays against terrain (measurements should
  // not bleed through hills), no fog, and a globe fallback color matching the
  // app background. Without an ion token the default Ion imagery cannot load
  // and the globe renders black — fall back to Carto's token-free dark
  // basemap so the survey still has geographic context (the Viewer mounts
  // with baseLayer={false} in that mode, so the slot is empty).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.fog.enabled = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.baseColor = Color.fromCssColorString("#0A0D14");
    if (!USE_WORLD_TERRAIN && viewer.imageryLayers.length === 0) {
      viewer.imageryLayers.addImageryProvider(
        new UrlTemplateImageryProvider({
          url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          subdomains: "abcd",
          minimumLevel: 0,
          maximumLevel: 19,
        }),
        0
      );
    }
    viewer.scene.requestRender();
  }, [viewerReady]);

  // ------------------------------------------------------- layer building

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed() || !manifest) return;

    const signature = JSON.stringify(manifest.layers);
    if (signature === layersSignatureRef.current) return;
    layersSignatureRef.current = signature;

    let cancelled = false;
    const handles = handlesRef.current;

    // Tear down previously-built layers.
    for (const handle of handles.values()) {
      if (handle.type === "imagery") viewer.imageryLayers.remove(handle.layer, true);
      else if (handle.type === "tileset") viewer.scene.primitives.remove(handle.tileset);
      else if (handle.type === "datasource") viewer.dataSources.remove(handle.ds, true);
    }
    handles.clear();
    viewer.terrainProvider = new EllipsoidTerrainProvider();

    const controls: LayerControl[] = [];

    // A complete photogrammetry reality mesh is the hero ONLY with a global
    // terrain (World Terrain) under it — then it renders crisp, city-twin style.
    // A thin DXF surface never qualifies (it floats/cliffs); those fall back to
    // the DSM-draped ortho. Computed up-front so the DSM default below agrees.
    const meshIsHero = (l: SiteModelLayer): boolean =>
      USE_WORLD_TERRAIN && !isThinSurfaceMesh(l.source_format);
    const anyMeshHero = (manifest.layers.site_models || []).some(meshIsHero);

    const addImagery = (key: string, label: string, category: LayerControl["category"], asset: AssetLayer, template: string, visible: boolean) => {
      const provider = new UrlTemplateImageryProvider({
        url: template, // gdal2tiles XYZ scheme — {z}/{x}/{y} top-origin, no reverseY
        rectangle: bboxToRectangle(asset.bbox),
        // The pyramids only exist between min_zoom and max_zoom; without
        // minimumLevel Cesium walks ancestors from level 0 and floods the
        // console with 404s. Safe here because the rectangle confines the
        // tile count at minimumLevel to a handful.
        minimumLevel: asset.min_zoom && asset.min_zoom > 0 ? asset.min_zoom : undefined,
        maximumLevel: asset.max_zoom && asset.max_zoom > 0 ? asset.max_zoom : undefined,
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.show = visible;
      layer.alpha = 1;
      handles.set(key, { type: "imagery", layer });
      controls.push({ key, label, category, visible, opacity: 1, supportsOpacity: true });
    };

    // Ortho — XYZ tile pyramids over the base imagery.
    (manifest.layers.ortho || []).forEach((l, i) => {
      const template = pickXyzTemplate(l.output_urls);
      if (!template) return;
      addImagery(`ortho-${i}`, l.processor_type || "Orthomosaic", "ortho", l, template, true);
    });

    // Lenses — slope/aspect/flow overlays (off by default).
    (manifest.layers.lenses || []).forEach((l, i) => {
      const entries = Object.entries(l.output_urls || {}).filter(
        ([k, v]) => typeof v === "string" && (k.startsWith("lens_") || v.includes("{z}"))
      );
      entries.forEach(([k, v]) => {
        const template = v.includes("{z}") ? v : v.replace(/\/+$/, "") + "/{z}/{x}/{y}.png";
        addImagery(`lens-${i}-${k}`, lensLabel(k), "lens", l, template, false);
      });
    });

    // Terrain — quantized-mesh surfaces (exclusive). The DSM is ON by default so
    // the ortho drapes on real relief: otherwise the globe is a flat ellipsoid
    // at height 0 and the reality mesh (at its true ~150 m elevation) floats far
    // above the imagery. DTM stays off.
    (manifest.layers.terrain || []).forEach((l, i) => {
      if (!l.tile_directory_url) return;
      const key = `terrain-${i}`;
      handles.set(key, { type: "terrain", url: l.tile_directory_url });
      controls.push({
        key,
        label: (l.surface_type || "terrain").toUpperCase(),
        category: "terrain",
        // DSM is the default base only WITHOUT a global terrain: it drapes the
        // ortho on relief so nothing floats. With World Terrain (ion token) the
        // reality mesh is the hero instead and the DSM stays off (it would
        // z-fight the mesh).
        visible: (l.surface_type || "").toLowerCase() === "dsm" && !anyMeshHero,
        opacity: 1,
        supportsOpacity: false,
      });
    });

    // Streaming budgets: without these, Cesium's defaults (SSE 16, unbounded
    // cache overflow while tiles are needed) pull hundreds of textured b3dm /
    // dense pnts tiles for the 1.4GB reality mesh and OOM-crash the tab.
    // Cap the global request burst: cacheBytes bounds RETAINED tiles, but a
    // rapid zoom queues dozens of concurrent fetches + decodes whose peak
    // memory crashes the renderer ("SIGILL" tab death) before the cache ever
    // applies. NB: the /gcs proxy makes EVERY asset same-origin, so the
    // per-server cap is effectively a whole-scene cap — keep it at the
    // default-ish 18 and bound the burst with the global cap instead.
    RequestScheduler.maximumRequestsPerServer = 18;
    RequestScheduler.maximumRequests = 28;

    const tilesetBudget = {
      // 12 (sharper than Cesium's default 16): mid-zoom refinement stops a
      // LOD level too early on this photogrammetry mesh otherwise. Safe
      // because the crash driver was the moving-camera request burst (culled
      // below), not steady-state depth; the cache caps retained tiles.
      maximumScreenSpaceError: 12,
      cacheBytes: 256 * 1024 * 1024,
      maximumCacheOverflowBytes: 128 * 1024 * 1024,
      skipLevelOfDetail: true,
      dynamicScreenSpaceError: true,
      foveatedScreenSpaceError: true,
      // While the camera is moving, skip requests for tiles that will be
      // stale by the time they arrive — the big lever for rapid zooming.
      cullRequestsWhileMoving: true,
      cullRequestsWhileMovingMultiplier: 120,
      // Brief delay before loading off-center detail; absorbs zoom jitter.
      foveatedTimeDelay: 0.2,
    };

    // Point clouds — 3D Tiles, with the point-cloud pipeline ported from
    // rendering-engine-fe: the point budget maps to density (SSE) + cache
    // size, eye-dome lighting keeps unlit points readable, and PDAL-written
    // tilesets get their geographic root transform corrected to ECEF. fyns's
    // crash guards (request culling while moving, overflow bound) stay on.
    (manifest.layers.pointcloud || []).forEach((l, i) => {
      const url = pickTilesetUrl(l.output_urls);
      if (!url) return;
      const key = `pointcloud-${i}`;
      Cesium3DTileset.fromUrl(url, {
        ...tilesetBudget,
        maximumScreenSpaceError: pointBudgetToMaximumScreenSpaceError(DEFAULT_POINT_BUDGET),
        cacheBytes: pointBudgetToCacheBytes(DEFAULT_POINT_BUDGET),
        pointCloudShading: {
          attenuation: true,
          eyeDomeLighting: true,
          eyeDomeLightingStrength: 1.0,
          maximumAttenuation: 4,
          geometricErrorScale: 1.0,
        },
      })
        .then((tileset) => {
          if (cancelled || viewer.isDestroyed()) return;
          correctGeographicRootTransform(tileset);
          tileset.show = visibleRef.current.get(key) ?? false;
          viewer.scene.primitives.add(tileset);
          handles.set(key, { type: "tileset", tileset });
          patchControl(key, { loading: false });
        })
        .catch((err) => {
          console.error("Failed to load point cloud tileset:", err);
          patchControl(key, { loading: false, error: "Failed to load point cloud tiles" });
        });
      controls.push({ key, label: "Point cloud", category: "pointcloud", visible: false, opacity: 1, supportsOpacity: true, loading: true });
    });

    // Site models — georeferenced reality meshes (3D Tiles).
    (manifest.layers.site_models || []).forEach((l, i) => {
      if (!l.tileset_url) return;
      const key = `sitemodel-${i}`;
      Cesium3DTileset.fromUrl(l.tileset_url, tilesetBudget)
        .then((tileset) => {
          if (cancelled || viewer.isDestroyed()) return;
          // The ortho-textured reality mesh already bakes in real capture
          // lighting, so Cesium's directional shading double-darkens the
          // sun-away faces vs the unlit base imagery. Lift the tileset light so
          // the texture reads at full brightness while keeping some relief.
          // (Harmless on the untextured grey fallback.)
          tileset.lightColor = new Cartesian3(2.4, 2.4, 2.4);
          tileset.show = visibleRef.current.get(key) ?? false;
          viewer.scene.primitives.add(tileset);
          handles.set(key, { type: "tileset", tileset });
          patchControl(key, { loading: false });
        })
        .catch((err) => {
          console.error("Failed to load site model tileset:", err);
          patchControl(key, { loading: false, error: "Failed to load reality mesh tiles" });
        });
      // Hero ON only with World Terrain (ion token): the mesh then sits on real
      // surrounding terrain — crisp, no float/cliff (the digital-twin look).
      // Without a token it stays OFF (the DSM-draped ortho is the hero) because
      // the mesh + DSM are the same surface and z-fight/poke-through.
      controls.push({ key, label: "Reality mesh", category: "pointcloud", visible: meshIsHero(l), opacity: 1, supportsOpacity: true, loading: true });
    });

    // Vectors — contours/boundaries. Registered lazily and OFF by default:
    // a survey's contour set runs to tens of MB of dense polylines, and
    // eagerly batching it has crashed the renderer (ArrayBuffer allocation
    // failure in Cesium's geometry pipeline).
    (manifest.layers.vectors || []).forEach((l, i) => {
      if (!l.geojson_url) return;
      const key = `vector-${i}`;
      handles.set(key, { type: "geojson-lazy", url: l.geojson_url });
      controls.push({
        key,
        label: `${l.role || "vector"} (${l.feature_count})`,
        category: "vector",
        visible: false,
        opacity: 1,
        supportsOpacity: false,
      });
    });

    // Designs — CAD overlays (DXF, LandXML, GeoJSON). Only GeoJSON-format
    // designs can be drawn client-side; raw CAD is listed but not renderable
    // until the backend tiles it, so its toggle is disabled.
    const designs: DesignControl[] = [];
    (manifest.layers.designs || []).forEach((d, i) => {
      const key = `design-${i}`;
      const renderable = designIsGeoJson(d.format, d.file_url);
      if (renderable && d.file_url) {
        handles.set(key, { type: "geojson-lazy", url: d.file_url });
      }
      designs.push({
        key,
        label: `${d.name}${d.format ? ` (${d.format})` : ""}`,
        visible: false,
        renderable,
      });
    });
    // Backend serves no designs yet — show the design fixtures so the DESIGNS
    // section is demonstrable. Drop this fallback once asset-svc populates
    // manifest.layers.designs.
    if (designs.length === 0) designs.push(...SAMPLE_DESIGNS.map((d) => ({ ...d })));

    visibleRef.current = new Map([
      ...controls.map((c) => [c.key, c.visible] as const),
      ...designs.map((d) => [d.key, d.visible] as const),
    ]);
    setLayerControls(controls);
    setDesignControls(designs);

    return () => {
      cancelled = true;
    };
  }, [viewerReady, manifest, patchControl]);

  // Camera-adaptive eye-dome lighting (ported): point outlines strengthen as
  // the camera closes in on the cloud.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    const updateEDL = () => {
      const cameraHeight = viewer.camera.positionCartographic.height;
      for (const [key, handle] of handlesRef.current) {
        if (!key.startsWith("pointcloud-") || handle.type !== "tileset" || !handle.tileset.show) continue;
        applyDynamicEyeDomeLighting(handle.tileset, cameraHeight);
      }
    };
    viewer.scene.preRender.addEventListener(updateEDL);
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.preRender.removeEventListener(updateEDL);
    };
  }, [viewerReady]);

  // Terrain exaggeration (ported): scales heights around the ellipsoid so
  // subtle relief reads at a glance. ×1 is true scale.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    viewer.scene.verticalExaggeration = terrainExaggeration;
    viewer.scene.verticalExaggerationRelativeHeight = 0;
    viewer.scene.requestRender();
  }, [viewerReady, terrainExaggeration]);

  // ----------------------------------------------------- layer interaction

  // The global base terrain the scene falls back to when no survey terrain (DSM)
  // is active: Cesium World Terrain when an ion token is set (so the survey sits
  // in real surrounding elevation), otherwise the flat ellipsoid. Resolved once
  // and cached.
  const baseTerrainRef = useRef<TerrainProvider | null>(null);
  const ensureBaseTerrain = useCallback(async (): Promise<TerrainProvider> => {
    if (baseTerrainRef.current) return baseTerrainRef.current;
    if (USE_WORLD_TERRAIN) {
      try {
        baseTerrainRef.current = await createWorldTerrainAsync();
        return baseTerrainRef.current;
      } catch (err) {
        console.error("Cesium World Terrain failed (check ion token); using ellipsoid:", err);
      }
    }
    baseTerrainRef.current = new EllipsoidTerrainProvider();
    return baseTerrainRef.current;
  }, []);

  // Monotonic guard (ported): terrain loads resolve async, and a rapid
  // DSM→DTM→mesh-hero toggle sequence can finish out of order — a stale
  // resolution must not overwrite the newest choice.
  const terrainSeqRef = useRef(0);
  const applyTerrain = useCallback(
    async (url: string | null) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      const seq = ++terrainSeqRef.current;
      if (!url) {
        const base = await ensureBaseTerrain();
        if (!viewer.isDestroyed() && seq === terrainSeqRef.current) viewer.terrainProvider = base;
        return;
      }
      try {
        const provider = await CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true });
        if (!viewer.isDestroyed() && seq === terrainSeqRef.current) viewer.terrainProvider = provider;
      } catch (err) {
        console.error("Failed to load terrain:", err);
        toast.error("Failed to load terrain tiles");
      }
    },
    [ensureBaseTerrain]
  );

  // Set the default terrain once per survey: the default-visible DSM (no-token
  // mode, ortho drapes on relief) or the World Terrain base (token mode, so the
  // reality mesh sits on the ground). handleToggle owns terrain after that; the
  // ellipsoid guard keeps this from fighting a user toggle (the layer-build
  // effect resets the provider to the ellipsoid before this runs).
  const defaultTerrainSurveyRef = useRef<string | null>(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed() || !manifest) return;
    const sig = manifest.survey.id;
    if (defaultTerrainSurveyRef.current === sig) return;
    if (!(viewer.terrainProvider instanceof EllipsoidTerrainProvider)) return;
    const t = layerControls.find((c) => c.category === "terrain" && c.visible);
    if (t) {
      const h = handlesRef.current.get(t.key);
      if (h?.type === "terrain") {
        defaultTerrainSurveyRef.current = sig;
        applyTerrain(h.url);
      }
    } else if (USE_WORLD_TERRAIN) {
      defaultTerrainSurveyRef.current = sig;
      applyTerrain(null); // resolves to the World Terrain base
    }
  }, [viewerReady, manifest, layerControls, applyTerrain]);

  const handleToggle = useCallback(
    (key: string) => {
      setLayerControls((prev) => {
        const target = prev.find((l) => l.key === key);
        if (!target) return prev;
        const turningOn = !target.visible;
        const isSiteModel = key.startsWith("sitemodel-");
        const next = prev.map((l) => {
          if (l.key === key) return { ...l, visible: !l.visible };
          // Terrain layers are exclusive — turning one on turns siblings off.
          if (target.category === "terrain" && l.category === "terrain" && turningOn) {
            return { ...l, visible: false };
          }
          // The reality mesh and the DSM/DTM terrain are the SAME surface
          // captured twice — rendering both z-fights (visible flicker), so
          // they are mutually exclusive like the terrain siblings.
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
        visibleRef.current.set(key, nowVisible);
        // Apply the mesh↔terrain exclusion side effects on the scene objects.
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
            const viewer = viewerRef.current;
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
                patchControl(key, { loading: false });
              })
              .catch((err) => {
                handle.loading = false;
                console.error("Failed to load vector layer:", err);
                patchControl(key, { loading: false, error: "Failed to load vector data" });
              });
          }
        }
        return next;
      });
    },
    [applyTerrain, patchControl]
  );

  const handleOpacity = useCallback((key: string, opacity: number) => {
    setLayerControls((prev) => prev.map((l) => (l.key === key ? { ...l, opacity } : l)));
    const handle = handlesRef.current.get(key);
    if (!handle) return;
    if (handle.type === "imagery") {
      handle.layer.alpha = opacity;
    } else if (handle.type === "tileset") {
      // Point clouds keep their RGB and fade via the ported point style (which
      // also fixes the point size); textured meshes tint through white so the
      // texture survives the alpha. At (near) full opacity drop the style
      // entirely so the native materials render untouched.
      handle.tileset.style = key.startsWith("pointcloud-")
        ? buildPointCloudStyle(opacity)
        : opacity >= 0.99
          ? undefined
          : new Cesium3DTileStyle({ color: `color('white', ${opacity.toFixed(2)})` });
    }
  }, []);

  const handleToggleDesign = useCallback((key: string) => {
    setDesignControls((prev) => {
      const target = prev.find((d) => d.key === key);
      if (!target || !target.renderable) return prev;
      const nowVisible = !target.visible;
      visibleRef.current.set(key, nowVisible);

      // Sample/demo designs have no Cesium handle — they only flip visual
      // state. Real GeoJSON designs lazy-load on first show (same path as
      // contour vectors).
      const handle = handlesRef.current.get(key);
      if (handle?.type === "datasource") {
        handle.ds.show = nowVisible;
      } else if (handle?.type === "geojson-lazy" && nowVisible && !handle.loading) {
        handle.loading = true;
        const viewer = viewerRef.current;
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
          })
          .catch((err) => {
            handle.loading = false;
            console.error("Failed to load design layer:", err);
            toast.error("Failed to load design overlay");
          });
      }
      return prev.map((d) => (d.key === key ? { ...d, visible: nowVisible } : d));
    });
  }, []);

  // -------------------------------------------------- measurement rendering

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    let cancelled = false;

    const features = measurements
      .filter((m) => m.geometry)
      .map((m) => ({
        type: "Feature" as const,
        properties: { id: m.id, name: m.name, kind: m.kind, status: m.status },
        geometry: m.geometry!,
      }));

    const fc = { type: "FeatureCollection" as const, features };
    GeoJsonDataSource.load(fc, {
      clampToGround: true,
      stroke: ACCENT,
      fill: ACCENT.withAlpha(0.25),
      strokeWidth: 3,
    })
      .then((ds) => {
        if (cancelled || viewer.isDestroyed()) return;
        if (measurementDsRef.current) {
          viewer.dataSources.remove(measurementDsRef.current, true);
        }
        measurementDsRef.current = ds;
        viewer.dataSources.add(ds);
      })
      .catch((err) => console.error("Failed to render measurements:", err));

    return () => {
      cancelled = true;
    };
  }, [viewerReady, measurements]);

  // Select tool: click a measurement overlay to inspect it, or any other map
  // feature — GeoJSON property bags (contours, designs) and 3D-tiles batch
  // attributes — via the picking flow ported from rendering-engine-fe.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawMode || probing) return; // the draw/probe handlers own clicks

      const picked = viewer.scene.pick(movement.position);
      if (!defined(picked)) {
        // Clicking empty space dismisses a picked-feature inspection.
        if (pickedFeature) {
          setPickedFeature(null);
          setRightPanel((p) => (p === "inspect" ? null : p));
        }
        return;
      }

      if (picked instanceof Cesium3DTileFeature) {
        const ids = picked.getPropertyIds();
        if (ids.length === 0) return; // untagged mesh surface — nothing to inspect
        const props: Record<string, unknown> = { _source: "3dtiles" };
        for (const id of ids) props[id] = picked.getProperty(id);
        setSelectedMeasurement(null);
        setIsInspectingNew(false);
        setPickedFeature(normalizeSelectedFeature(props, { name: "3D Tiles feature" }));
        setRightPanel("inspect");
        return;
      }

      if (picked.id instanceof Entity) {
        const entity = picked.id;
        const props = entity.properties?.getValue(JulianDate.now()) as
          | Record<string, unknown>
          | undefined;

        // Measurement overlays carry their measurement id in properties.
        const measurement =
          typeof props?.id === "string"
            ? measurements.find((m) => m.id === props.id)
            : undefined;
        if (measurement) {
          setPickedFeature(null);
          setSelectedMeasurement(measurement);
          setIsInspectingNew(false);
          setRightPanel("inspect");
          return;
        }

        if (props && Object.keys(props).length > 0) {
          setSelectedMeasurement(null);
          setIsInspectingNew(false);
          setPickedFeature(
            normalizeSelectedFeature(props, {
              _source: "geojson",
              _entityId: entity.id,
              name: entity.name ?? "Region of interest",
            })
          );
          setRightPanel("inspect");
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => handler.destroy();
  }, [viewerReady, drawMode, probing, measurements, pickedFeature]);

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
    setDraftPoints([]);
    setHoverPoint(null);
  }, []);

  const stopProbe = useCallback(() => {
    setProbing(false);
    setProbePoint(null);
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed() && probeEntityRef.current) {
      viewer.entities.remove(probeEntityRef.current);
    }
    probeEntityRef.current = null;
  }, []);

  const cancelDraw = useCallback(() => {
    cleanupDraw();
    stopProbe();
    setDrawMode(null);
    setActiveDrawOpts(null);
    pendingDrawRef.current = null;
    setRightPanel(null);
    setSelectedMeasurement(null);
    setPickedFeature(null);
  }, [cleanupDraw, stopProbe]);

  // Probe tool: sample longitude/latitude/elevation at clicked surface points
  // (the Point/Elevation/Probe tools). Readout lives in the Measure palette.
  const startProbe = useCallback(() => {
    cleanupDraw();
    setDrawMode(null);
    setActiveDrawOpts(null);
    pendingDrawRef.current = null;
    setSelectedMeasurement(null);
    setIsInspectingNew(false);
    setPickedFeature(null);
    setProbing(true);
    setRightPanel("measure");
  }, [cleanupDraw]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!probing || !viewerReady || !viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      const position = pickScenePosition(viewer, event.position);
      if (!position) return;
      setProbePoint(toLngLatHeight(position));
      if (!probeEntityRef.current) {
        probeEntityRef.current = viewer.entities.add({
          position,
          point: {
            pixelSize: 9,
            color: ACCENT,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        probeEntityRef.current.position = new ConstantPositionProperty(position);
      }
      viewer.scene.requestRender();
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => handler.destroy();
  }, [probing, viewerReady]);

  const startDraw = useCallback(
    (mode: DrawMode, opts?: DrawOptions) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      cleanupDraw();
      stopProbe();
      pendingDrawRef.current = null;
      setDrawMode(mode);
      setActiveDrawOpts(opts ?? null);
      setPickedFeature(null);
      draftPositionsRef.current = [];

      // Draft entity rendered from the live vertex list plus the rubber-band
      // vertex tracking the cursor.
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

      const kind: "volume" | "cross_section" =
        opts?.kind ?? (mode === "polygon" ? "volume" : "cross_section");

      const finish = () => {
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
        // Drop a trailing duplicate vertex left behind by the finishing double-click.
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
        setHoverPoint(null);

        // Immediate plan stats from the drawn vertices (ported measurement
        // math) — shown in the inspector while the shape is named; the
        // backend compute replaces them with surface-true results.
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
        pendingDrawRef.current = { mode, coords, kind, folder: opts?.folder, slope: opts?.slope };
        setDrawMode(null);
        setActiveDrawOpts(null);
        setSelectedMeasurement(tempMeasurement);
        setIsInspectingNew(true);
        setRightPanel("inspect");
      };

      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
        const pos = pickScenePosition(viewer, event.position);
        if (pos) {
          draftPositionsRef.current = [...draftPositionsRef.current, pos];
          setDraftPoints(draftPositionsRef.current);
          viewer.scene.requestRender();
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      // Rubber-band + live readout tracking (state mirror is throttled; the
      // draft entity reads the ref every frame).
      handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
        const pos = pickScenePosition(viewer, movement.endPosition);
        hoverPositionRef.current = pos;
        const now = performance.now();
        if (now - hoverThrottleRef.current > 100) {
          hoverThrottleRef.current = now;
          setHoverPoint(pos);
        }
        viewer.scene.requestRender();
      }, ScreenSpaceEventType.MOUSE_MOVE);
      handler.setInputAction(() => finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      handler.setInputAction(() => finish(), ScreenSpaceEventType.RIGHT_CLICK);
      drawHandlerRef.current = handler;
      setRightPanel("measure");
    },
    [cleanupDraw, stopProbe, surveyId]
  );

  // Undo the last placed vertex of the in-flight drawing.
  const undoLastVertex = useCallback(() => {
    if (!drawMode || draftPositionsRef.current.length === 0) {
      toast.info("Nothing to undo — place a vertex first");
      return;
    }
    draftPositionsRef.current = draftPositionsRef.current.slice(0, -1);
    setDraftPoints(draftPositionsRef.current);
    viewerRef.current?.scene.requestRender();
  }, [drawMode]);

  // ESC cancels an in-flight drawing.
  useEffect(() => {
    if (!drawMode && !rightPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDraw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, rightPanel, cancelDraw]);

  useEffect(() => () => cleanupDraw(), [cleanupDraw]);

  // ------------------------------------------------------------ ops (CRUD)

  const triggerCompute = useCallback(
    async (id: string) => {
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        await computeMeasurement(surveyId, id);
        toast.info("Compute dispatched — result will appear when ready");
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          toast.warning(`Compute not available yet: ${err.message}`);
        } else if (err instanceof Error) {
          toast.error(err.message);
        }
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        refreshMeasurements();
      }
    },
    [surveyId, refreshMeasurements]
  );

  const saveMeasurement = useCallback(async (name: string) => {
    if (!pendingDrawRef.current || !name.trim()) return;
    setSaving(true);
    try {
      const { mode, coords, kind, folder, slope } = pendingDrawRef.current;
      const geometry =
        mode === "polygon"
          ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
          : { type: "LineString", coordinates: coords };

      // params is stored verbatim by asset-svc; volume_method records the
      // palette's base-surface choice (compute auto-resolves DSM−DTM today),
      // slope marks a grade-focused polyline.
      const params: Record<string, unknown> = {};
      if (kind === "volume") params.volume_method = volumeMethod;
      if (slope) params.slope = true;

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
      setRightPanel(null);
      setSelectedMeasurement(null);
      await refreshMeasurements();
      // Only volume/stockpile compute auto-resolves its inputs server-side;
      // cross-section needs an explicit payload the backend doesn't build yet,
      // so dispatching it would just 422.
      if (kind === "volume") await triggerCompute(created.id);
    } catch (err) {
      if (err instanceof Error) toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }, [surveyId, volumeMethod, cleanupDraw, refreshMeasurements, triggerCompute]);

  const removeMeasurement = useCallback(
    async (id: string) => {
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        await deleteMeasurement(surveyId, id);
        toast.success("Measurement deleted");
      } catch (err) {
        if (err instanceof Error) toast.error(err.message);
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        refreshMeasurements();
      }
    },
    [surveyId, refreshMeasurements]
  );

  // ------------------------------------------------------------- viewer ref

  const handleViewerRef = useCallback((e: CesiumComponentRef<CesiumViewer> | null) => {
    if (e?.cesiumElement && !e.cesiumElement.isDestroyed()) {
      // Default double-click (track entity) conflicts with finish-drawing.
      e.cesiumElement.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      viewerRef.current = e.cesiumElement;
      setViewerReady(true);
    }
  }, []);

  const surveyTitle = useMemo(() => {
    if (!manifest) return "Survey viewer";
    return `Survey ${manifest.survey.survey_date}`;
  }, [manifest]);

  // Section header label, e.g. "SURVEY V3 · 18 MAY".
  const surveyLabel = useMemo(() => {
    if (!manifest) return "SURVEY";
    const v = manifest.survey.version?.number;
    const parts = [v ? `SURVEY V${v}` : "SURVEY", shortDate(manifest.survey.survey_date)];
    return parts.filter(Boolean).join(" · ");
  }, [manifest]);

  // Real measurements first, then the demo folder fixtures (display-only) so
  // the grouped Measurements UI is demonstrable. Drop SAMPLE_MEASUREMENTS once
  // asset-svc serves foldered measurements.
  const panelMeasurements = useMemo<PanelMeasurement[]>(
    () => [...measurements, ...SAMPLE_MEASUREMENTS],
    [measurements]
  );

  // Live palette readout — the ported measurement math over the committed
  // vertices plus the rubber-band vertex, so lengths/areas tick up while the
  // cursor moves (draftPoints/hoverPoint mirror the refs at ~10Hz).
  const readout = useMemo<LiveReadout>(() => {
    if (probing) return { mode: "probe", vertexCount: 0, point: probePoint };
    if (drawMode) {
      const pts = hoverPoint ? [...draftPoints, hoverPoint] : draftPoints;
      if (drawMode === "polygon") {
        return {
          mode: "polygon",
          vertexCount: draftPoints.length,
          areaSquareMeters: computeAreaSquareMeters(pts),
          perimeterMeters: computePerimeterMeters(pts),
        };
      }
      return {
        mode: "polyline",
        vertexCount: draftPoints.length,
        lengthMeters: computeDistanceMeters(pts),
        gradePercent: activeDrawOpts?.slope ? computeGrade(pts)?.percent : undefined,
      };
    }
    return { mode: "idle", vertexCount: 0 };
  }, [probing, probePoint, drawMode, draftPoints, hoverPoint, activeDrawOpts]);

  // Panel row click: inspect the measurement and frame its geometry.
  const selectMeasurement = useCallback(
    (m: PanelMeasurement) => {
      setPickedFeature(null);
      setSelectedMeasurement(m);
      setIsInspectingNew(false);
      setRightPanel("inspect");
      if (!m.demo && m.geometry) {
        const rect = geometryToRectangle(m.geometry);
        if (rect) flyToRectangle(rect);
      }
    },
    [flyToRectangle]
  );

  // Export the survey's measurements as a GeoJSON FeatureCollection download.
  const exportMeasurements = useCallback(() => {
    const features = measurements
      .filter((m) => m.geometry)
      .map((m) => ({
        type: "Feature" as const,
        properties: {
          id: m.id,
          name: m.name,
          kind: m.kind,
          folder: m.folder ?? null,
          status: m.status,
          ...(m.result ?? {}),
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
  }, [measurements, surveyId]);

  // ------------------------------------------------------------------ UI

  return (
    <div className="w-full h-full relative bg-[#0A0D14] overflow-hidden">
      <div className="w-full h-full flex">
        {/* Map-tools rail (48px) */}
        <ViewerToolRail
          drawMode={drawMode}
          onStartDraw={startDraw}
          onCancelDraw={cancelDraw}
          onExport={exportMeasurements}
        />

        {/* Left Side panel */}
        <div className="w-[240px] bg-[#111114]/95 backdrop-blur-xl border-r border-white/[0.08] z-10 flex flex-col shrink-0">
        {/* Compact header: back + survey title */}
        <div className="flex items-center gap-2.5 px-3 pt-4 pb-2 shrink-0">
          <Link href="/globe" className="text-gray-500 hover:text-gray-200 transition-colors shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-gray-100 truncate">{surveyTitle}</h2>
            {manifest?.survey.working_crs && (
              <p className="text-[10px] text-gray-500 truncate">
                {manifest.survey.working_crs}
                {manifest.survey.vertical_datum ? ` · ${manifest.survey.vertical_datum}` : ""}
              </p>
            )}
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "layers" | "surveys")}
          className="flex flex-1 flex-col min-h-0"
        >
          <div className="px-3 pt-1 pb-2 shrink-0">
            <TabsList className="w-full bg-transparent">
              <TabsTrigger value="surveys">Surveys</TabsTrigger>
              <TabsTrigger value="layers">Layers</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {manifestError ? (
              <div className="m-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <p className="text-xs text-red-400">{manifestError}</p>
              </div>
            ) : !manifest ? (
              <div className="flex items-center gap-2 p-4 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                Loading manifest…
              </div>
            ) : (
              <>
                <TabsContent value="layers" className="mt-0">
                  <LayerPanel
                    surveyLabel={surveyLabel}
                    layers={layerControls}
                    designs={designControls}
                    processing={layersEmpty}
                    surveyStatus={manifest.survey.status}
                    terrainExaggeration={terrainExaggeration}
                    onToggle={handleToggle}
                    onOpacity={handleOpacity}
                    onToggleDesign={handleToggleDesign}
                    onTerrainExaggeration={setTerrainExaggeration}
                  />
                  <MeasurementPanel
                    measurements={panelMeasurements}
                    drawMode={drawMode}
                    busyIds={busyIds}
                    onStartDraw={startDraw}
                    onCancelDraw={cancelDraw}
                    onCompute={triggerCompute}
                    onDelete={removeMeasurement}
                    onSelect={selectMeasurement}
                  />
                </TabsContent>
                <TabsContent value="surveys" className="mt-0">
                  <SurveyList
                    projectId={manifest.survey.project_id}
                    currentSurveyId={surveyId}
                  />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.08] p-2">
          <button
            type="button"
            onClick={() => toast.info("Layer upload is coming soon")}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[4px] text-xs text-gray-400 transition-colors hover:bg-white/[0.03] hover:text-gray-200"
          >
            <Plus size={14} />
            Add layer
          </button>
        </div>
      </div>
        {/* Center: 3D Viewer */}
        <div className="flex-1 relative">
          <Viewer
            ref={handleViewerRef}
            full
            timeline={false}
            animation={false}
            geocoder={false}
            // Without an ion token the default Ion imagery just errors — mount
            // with an empty imagery slot and let the scene-setup effect add
            // the token-free Carto basemap instead.
            baseLayer={USE_WORLD_TERRAIN ? undefined : false}
            baseLayerPicker={false}
            navigationHelpButton={false}
            homeButton={false}
            sceneModePicker={false}
            fullscreenButton={false}
            infoBox={false}
            selectionIndicator={false}
            style={{ width: "100%", height: "100%" }}
          />
          {manifest && (
            <ViewerDrawToolbar
              drawMode={drawMode}
              probing={probing}
              onStartDraw={startDraw}
              onStartProbe={startProbe}
              onCancelDraw={cancelDraw}
              onUndo={undoLastVertex}
            />
          )}
          <CameraJoystick viewerRef={viewerRef} ready={viewerReady} />
          <ViewerStatusBar
            viewerRef={viewerRef}
            ready={viewerReady}
            surveyDate={manifest?.survey.survey_date}
          />
        </div>

        {/* Right contextual panel */}
        {rightPanel && (
          <div className="w-[280px] bg-[#111114]/95 backdrop-blur-xl border-l border-white/[0.08] z-10 flex flex-col shrink-0">
            {rightPanel === "measure" && (
              <MeasurePalette
                drawMode={drawMode}
                probing={probing}
                readout={readout}
                volumeMethod={volumeMethod}
                onVolumeMethod={setVolumeMethod}
                onStartDraw={startDraw}
                onStartProbe={startProbe}
                onClose={cancelDraw}
              />
            )}
            {rightPanel === "inspect" && (
              <FeatureInspector
                measurement={selectedMeasurement}
                feature={pickedFeature}
                onClose={cancelDraw}
                onSave={saveMeasurement}
                onDelete={removeMeasurement}
                onCompute={triggerCompute}
                isNew={isInspectingNew}
                saving={saving}
                busy={selectedMeasurement ? busyIds.has(selectedMeasurement.id) : false}
              />
            )}
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cesium-container .cesium-viewer {
          background-color: #0A0D14;
        }
        .cesium-container .cesium-viewer-bottom {
          display: none !important;
        }
      `,
        }}
      />
    </div>
  );
}
