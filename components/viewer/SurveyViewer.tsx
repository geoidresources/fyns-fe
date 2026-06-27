"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewer } from "resium";
import type { CesiumComponentRef } from "resium";
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  Cesium3DTileStyle,
  CesiumTerrainProvider,
  ClassificationType,
  Color,
  EllipsoidTerrainProvider,
  Entity,
  GeoJsonDataSource,
  ImageryLayer,
  Math as CesiumMath,
  PolygonHierarchy,
  Rectangle,
  RequestScheduler,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer as CesiumViewer,
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
} from "@/lib/api/assetSvc";
import { getProject } from "@/lib/api/userSvc";
import { ApiError } from "@/lib/api/client";
import {
  LayerPanel,
  type LayerControl,
  type DesignControl,
} from "@/components/viewer/LayerPanel";
import { MeasurementPanel, type DrawMode } from "@/components/viewer/MeasurementPanel";
import { MeasurePalette } from "@/components/viewer/MeasurePalette";
import { FeatureInspector } from "@/components/viewer/FeatureInspector";
import { ViewerToolRail } from "@/components/viewer/ViewerToolRail";
import { ViewerDrawToolbar } from "@/components/viewer/ViewerDrawToolbar";
import { SurveyList } from "@/components/viewer/SurveyList";
import {
  SAMPLE_DESIGNS,
  SAMPLE_MEASUREMENTS,
  type PanelMeasurement,
} from "@/lib/viewer/sampleData";
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
  const measurementDsRef = useRef<GeoJsonDataSource | null>(null);
  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  const pendingDrawRef = useRef<PendingDraw | null>(null);

  const layersEmpty = manifestLayersEmpty(manifest);

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

    // Terrain — quantized-mesh surfaces (exclusive; off by default).
    (manifest.layers.terrain || []).forEach((l, i) => {
      if (!l.tile_directory_url) return;
      const key = `terrain-${i}`;
      handles.set(key, { type: "terrain", url: l.tile_directory_url });
      controls.push({
        key,
        label: (l.surface_type || "terrain").toUpperCase(),
        category: "terrain",
        visible: false,
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

    // Point clouds — 3D Tiles.
    (manifest.layers.pointcloud || []).forEach((l, i) => {
      const url = pickTilesetUrl(l.output_urls);
      if (!url) return;
      const key = `pointcloud-${i}`;
      Cesium3DTileset.fromUrl(url, tilesetBudget)
        .then((tileset) => {
          if (cancelled || viewer.isDestroyed()) return;
          tileset.show = visibleRef.current.get(key) ?? false;
          viewer.scene.primitives.add(tileset);
          handles.set(key, { type: "tileset", tileset });
        })
        .catch((err) => console.error("Failed to load point cloud tileset:", err));
      controls.push({ key, label: "Point cloud", category: "pointcloud", visible: false, opacity: 1, supportsOpacity: true });
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
        })
        .catch((err) => console.error("Failed to load site model tileset:", err));
      // The textured reality mesh is the hero surface — on by default (terrain
      // stays off), labelled for what it is.
      controls.push({ key, label: "Reality mesh", category: "pointcloud", visible: true, opacity: 1, supportsOpacity: true });
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
  }, [viewerReady, manifest]);

  // ----------------------------------------------------- layer interaction

  const applyTerrain = useCallback(async (url: string | null) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (!url) {
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      return;
    }
    try {
      const provider = await CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true });
      if (!viewer.isDestroyed()) viewer.terrainProvider = provider;
    } catch (err) {
      console.error("Failed to load terrain:", err);
      toast.error("Failed to load terrain tiles");
    }
  }, []);

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
              })
              .catch((err) => {
                handle.loading = false;
                console.error("Failed to load vector layer:", err);
              });
          }
        }
        return next;
      });
    },
    [applyTerrain]
  );

  const handleOpacity = useCallback((key: string, opacity: number) => {
    setLayerControls((prev) => prev.map((l) => (l.key === key ? { ...l, opacity } : l)));
    const handle = handlesRef.current.get(key);
    if (!handle) return;
    if (handle.type === "imagery") {
      handle.layer.alpha = opacity;
    } else if (handle.type === "tileset") {
      handle.tileset.style = new Cesium3DTileStyle({ color: `color('white', ${opacity.toFixed(2)})` });
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
  }, [viewerReady, measurements, ACCENT]);

  // Handle clicking on map features (measurements)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawMode) return; // Don't select while drawing

      const pickedObject = viewer.scene.pick(movement.position);
      if (pickedObject?.id instanceof Entity) {
        const entity = pickedObject.id;
        const measurementId = entity.properties?.id?.getValue();
        if (measurementId) {
          const measurement = measurements.find((m) => m.id === measurementId);
          if (measurement) {
            setSelectedMeasurement(measurement);
            setIsInspectingNew(false);
            setRightPanel("inspect");
          }
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => handler.destroy();
  }, [viewerReady, drawMode, measurements]);

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
  }, []);

  const cancelDraw = useCallback(() => {
    cleanupDraw();
    setDrawMode(null);
    pendingDrawRef.current = null;
    setRightPanel(null);
    setSelectedMeasurement(null);
  }, [cleanupDraw]);

  const startDraw = useCallback(
    (mode: DrawMode) => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      cleanupDraw();
      pendingDrawRef.current = null;
      setDrawMode(mode);
      draftPositionsRef.current = [];

      // Draft entity rendered from the live vertex list.
      draftEntityRef.current = viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => {
            const pts = draftPositionsRef.current;
            if (pts.length < 2) return [];
            return mode === "polygon" ? [...pts, pts[0]] : pts;
          }, false),
          width: 3,
          material: ACCENT,
          clampToGround: true,
        },
        polygon:
          mode === "polygon"
            ? {
                hierarchy: new CallbackProperty(
                  () => new PolygonHierarchy(draftPositionsRef.current),
                  false
                ),
                material: ACCENT.withAlpha(0.2),
                classificationType: ClassificationType.BOTH,
              }
            : undefined,
      });

      const pickPosition = (screen: Cartesian2): Cartesian3 | undefined => {
        const ray = viewer.camera.getPickRay(screen);
        const onGlobe = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
        return onGlobe || viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid) || undefined;
      };

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
        const tempMeasurement: PanelMeasurement = {
          id: `new-${Date.now()}`,
          client_id: "",
          survey_id: surveyId,
          name: "",
          kind: mode === "polygon" ? "volume" : "cross_section",
          folder: "Stockpiles", // default
          status: "draft",
          created_at: "",
          updated_at: "",
        };
        pendingDrawRef.current = { mode, coords };
        setDrawMode(null);
        setSelectedMeasurement(tempMeasurement);
        setIsInspectingNew(true);
        setRightPanel("inspect");
      };

      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
        const pos = pickPosition(event.position);
        if (pos) {
          draftPositionsRef.current = [...draftPositionsRef.current, pos];
          viewer.scene.requestRender();
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(() => finish(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      handler.setInputAction(() => finish(), ScreenSpaceEventType.RIGHT_CLICK);
      drawHandlerRef.current = handler;
      setRightPanel("measure");
    },
    [cleanupDraw, surveyId]
  );

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
      const { mode, coords } = pendingDrawRef.current;
      const geometry =
        mode === "polygon"
          ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
          : { type: "LineString", coordinates: coords };
      const kind = mode === "polygon" ? "volume" : "cross_section";

      const created = await createMeasurement(surveyId, {
        kind,
        name: name.trim(),
        geometry,
        params: {},
      });
      toast.success(`Measurement "${created.name}" created`);
      cleanupDraw();
      pendingDrawRef.current = null;
      setRightPanel(null);
      setSelectedMeasurement(null);
      await refreshMeasurements();
      await triggerCompute(created.id);
    } catch (err) {
      if (err instanceof Error) toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }, [surveyId, cleanupDraw, refreshMeasurements, triggerCompute]);

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

  // ------------------------------------------------------------------ UI

  return (
    <div className="w-full h-full relative bg-[#0A0D14] overflow-hidden">
      <div className="w-full h-full flex">
        {/* Map-tools rail (48px) */}
        <ViewerToolRail drawMode={drawMode} onStartDraw={startDraw} onCancelDraw={cancelDraw} />

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
                    onToggle={handleToggle}
                    onOpacity={handleOpacity}
                    onToggleDesign={handleToggleDesign}
                  />
                  <MeasurementPanel
                    measurements={panelMeasurements}
                    drawMode={drawMode}
                    busyIds={busyIds}
                    onStartDraw={startDraw}
                    onCancelDraw={cancelDraw}
                    onCompute={triggerCompute}
                    onDelete={removeMeasurement}
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
              onStartDraw={startDraw}
              onCancelDraw={cancelDraw}
            />
          )}
          <CameraJoystick viewerRef={viewerRef} ready={viewerReady} />
        </div>

        {/* Right contextual panel */}
        {rightPanel && (
          <div className="w-[280px] bg-[#111114]/95 backdrop-blur-xl border-l border-white/[0.08] z-10 flex flex-col shrink-0">
            {rightPanel === "measure" && <MeasurePalette onClose={cancelDraw} />}
            {rightPanel === "inspect" && (
              <FeatureInspector measurement={selectedMeasurement} onClose={cancelDraw} onSave={saveMeasurement} isNew={isInspectingNew} saving={saving} />
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
