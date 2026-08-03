"use client";

// Scene + layer lifecycle (viewer-shell §2.3 hook `useLayerLifecycle`). MOVED
// VERBATIM from SurveyViewer, the largest relocation. Aggregates the Cesium
// effects that build and reconcile scene layers against the manifest:
//   • RequestScheduler save/restore, scene config, base-map imagery (:615-648)
//   • the layer-build effect that constructs ortho/lens/terrain/pointcloud/
//     site-model/vector/design handles (:652-995)
//   • EDL, terrain depth-test, globe clipping, exaggeration, sun (:999-1105)
//   • the default-terrain application (:1176-1196)
//   • the measurement-overlay GeoJsonDataSource render (:1505-1539)
// The imperative layer callbacks (handleToggle/handleOpacity/applyTerrain/…)
// stay in ViewerRuntime; this hook owns only the effects. All Cesium handles
// stay in the refs passed via `deps` (§3.2). Bodies line-identical.
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  BoundingSphere,
  Cartesian3,
  Cesium3DTileset,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  EllipsoidTerrainProvider,
  GeoJsonDataSource,
  HeightReference,
  ImageryLayer,
  JulianDate,
  LabelGraphics,
  LabelStyle,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  PolylineGraphics,
  Rectangle,
  RequestScheduler,
  UrlTemplateImageryProvider,
  type Viewer as CesiumViewer,
} from "cesium";
import { metricsOf, resultForKind } from "@/lib/viewer/calc";
import { contourTileTemplate } from "@/lib/viewer/contours";
import { styleOf } from "@/lib/viewer/style";
import type {
  AssetLayer,
  Manifest,
  SiteModelLayer,
} from "@/lib/api/assetSvc";
import type { LayerControl, DesignControl } from "@/components/viewer/LayerPanel";
import {
  DEFAULT_POINT_BUDGET,
  applyDynamicEyeDomeLighting,
  correctGeographicRootTransform,
  pointBudgetToCacheBytes,
  pointBudgetToMaximumScreenSpaceError,
} from "@/lib/viewer/pointcloud";
import { computeTilesetFootprint } from "@/lib/viewer/footprint";
import { USE_WORLD_TERRAIN } from "@/lib/viewer/cesiumIon";
import { configureCesiumScene, makeBaseImageryProvider } from "@/lib/viewer/cesiumScene";
import { SAMPLE_DESIGNS } from "@/lib/viewer/sampleData";
import {
  ACCENT,
  bboxToRectangle,
  designIsGeoJson,
  isThinSurfaceMesh,
  lensLabel,
  parseLensRamp,
  pickTilesetUrl,
  pickXyzTemplate,
  type LayerHandle,
} from "@/components/viewer/shell/sceneHelpers";

export function useLayerLifecycle(deps: {
  viewerReady: boolean;
  manifest: Manifest | null;
  baseMap: string;
  layerControls: LayerControl[];
  measurements: import("@/lib/api/assetSvc").Measurement[];
  measurementVisibility: Record<string, boolean>;
  terrainExaggeration: number;
  sunLightingEnabled: boolean;
  sunHour: number;
  clipInputsVersion: number;
  viewerRef: RefObject<CesiumViewer | null>;
  baseImageryRef: RefObject<ImageryLayer | null>;
  handlesRef: RefObject<Map<string, LayerHandle>>;
  layersSignatureRef: RefObject<string>;
  footprintsRef: RefObject<Map<string, Cartesian3[]>>;
  meshReadyRef: RefObject<Set<string>>;
  meshPreloadWaiverRef: RefObject<Set<string>>;
  surveyBoundsRef: RefObject<BoundingSphere | null>;
  tilesetFramedRef: RefObject<boolean>;
  visibleRef: RefObject<Map<string, boolean>>;
  clipCollectionRef: RefObject<ClippingPolygonCollection | null>;
  defaultTerrainSigRef: RefObject<string | null>;
  measurementDsRef: RefObject<GeoJsonDataSource | null>;
  setClipInputsVersion: Dispatch<SetStateAction<number>>;
  patchControl: (key: string, patch: Partial<LayerControl>) => void;
  registerSurveyBounds: (tileset: Cesium3DTileset) => void;
  updateCloudPreload: () => void;
  applyTerrain: (url: string | null) => Promise<boolean>;
  setLayerControls: (controls: LayerControl[]) => void;
  setDesignControls: (designs: DesignControl[]) => void;
}) {
  const {
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
  } = deps;

  // -------------------------------------------------------- scene setup
  useEffect(() => {
    const savedPerServer = RequestScheduler.maximumRequestsPerServer;
    const savedTotal = RequestScheduler.maximumRequests;
    return () => {
      RequestScheduler.maximumRequestsPerServer = savedPerServer;
      RequestScheduler.maximumRequests = savedTotal;
    };
  }, []);

  // One-time scene configuration: space-dark background (no starfield), no fog,
  // and a token-free Carto basemap at layer 0 so geographic context survives
  // Ion imagery timeouts (common after hard refresh). World Terrain still
  // comes from Ion when a token is set; survey ortho/pyramids stack on top.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    configureCesiumScene(viewer);
    viewer.scene.requestRender();
  }, [viewerReady]);

  // Base-map selector — also seeds the initial base layer. Swaps the bottom
  // imagery layer, keeping survey ortho pyramids (added on top) undisturbed.
  // Owns baseImageryRef exclusively so the base layer is only ever added here
  // (the scene-setup effect adding it too used to double-stack layer 0).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    const layers = viewer.imageryLayers;
    const next = layers.addImageryProvider(makeBaseImageryProvider(baseMap), 0);
    layers.lowerToBottom(next);
    if (baseImageryRef.current) layers.remove(baseImageryRef.current, true);
    baseImageryRef.current = next;
    viewer.scene.requestRender();
  }, [viewerReady, baseMap]);

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
    // Footprints/bounds belong to the outgoing tilesets; the version bump
    // makes the clipping effect drop stale rings even when the visibility
    // booleans it also depends on don't change across the rebuild.
    footprintsRef.current.clear();
    meshReadyRef.current.clear();
    meshPreloadWaiverRef.current.clear();
    setClipInputsVersion((v) => v + 1);
    surveyBoundsRef.current = null;
    tilesetFramedRef.current = false;

    const controls: LayerControl[] = [];

    // Survey extent — union of the raster layers' bboxes. Reused to confine the
    // contour tile pyramids' requests, exactly like each ortho ImageryLayer's
    // `rectangle` (without it a non-zero minimumLevel floods 404s when the site
    // is small in view). undefined when no layer carries a bbox.
    const surveyRects = [
      ...(manifest.layers.ortho || []),
      ...(manifest.layers.terrain || []),
      ...(manifest.layers.lenses || []),
      ...(manifest.layers.pointcloud || []),
    ]
      .map((l) => bboxToRectangle(l.bbox))
      .filter((r): r is Rectangle => !!r);
    const surveyRect = surveyRects.length
      ? surveyRects.reduce((acc, r) => Rectangle.union(acc, r, new Rectangle()), surveyRects[0])
      : undefined;

    // A complete photogrammetry reality mesh is the hero ONLY with a global
    // terrain (World Terrain) under it — then it renders crisp, city-twin style.
    // A thin DXF surface never qualifies (it floats/cliffs); those fall back to
    // the DSM-draped ortho. Computed up-front so the DSM default below agrees.
    const meshIsHero = (l: SiteModelLayer): boolean =>
      USE_WORLD_TERRAIN && !isThinSurfaceMesh(l.source_format);
    const anyMeshHero = (manifest.layers.site_models || []).some(meshIsHero);

    const addImagery = (
      key: string,
      label: string,
      category: LayerControl["category"],
      asset: AssetLayer,
      template: string,
      visible: boolean,
      extra?: Partial<LayerControl>
    ) => {
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
      controls.push({
        key,
        label,
        category,
        visible,
        opacity: 1,
        supportsOpacity: true,
        ...extra,
      });
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
        const ramp = parseLensRamp(k);
        addImagery(`lens-${i}-${k}`, lensLabel(k), "lens", l, template, false, { lensRamp: ramp });
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
        supportsOpacity: true,
        stats: l.stats,
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
    // When the survey has no other 3D surface (no reality mesh, no DSM/DTM —
    // the LiDAR-first case) the cloud IS the site: it lands visible instead
    // of leaving the default view a bare basemap.
    const pointCloudIsHero =
      !anyMeshHero && !(manifest.layers.terrain || []).some((t) => !!t.tile_directory_url);
    (manifest.layers.pointcloud || []).forEach((l, i) => {
      const url = pickTilesetUrl(l.output_urls);
      if (!url) return;
      const key = `pointcloud-${i}`;
      Cesium3DTileset.fromUrl(url, {
        ...tilesetBudget,
        maximumScreenSpaceError: pointBudgetToMaximumScreenSpaceError(DEFAULT_POINT_BUDGET),
        cacheBytes: pointBudgetToCacheBytes(DEFAULT_POINT_BUDGET),
        // preloadWhenHidden is deliberately NOT set here — updateCloudPreload
        // turns it on once the hero mesh has streamed its initial cover.
        pointCloudShading: {
          attenuation: true,
          eyeDomeLighting: true,
          eyeDomeLightingStrength: 1.0,
          maximumAttenuation: 4,
          geometricErrorScale: 1.0,
        },
      })
        .then((tileset) => {
          // The effect re-ran (layer signature changed) or the viewer went away
          // while fromUrl was in flight — the tileset was allocated but never
          // parented, so destroy it here or it leaks GPU memory + open requests.
          if (cancelled || viewer.isDestroyed()) {
            tileset.destroy();
            return;
          }
          correctGeographicRootTransform(tileset);
          tileset.show = visibleRef.current.get(key) ?? false;
          viewer.scene.primitives.add(tileset);
          handles.set(key, { type: "tileset", tileset });
          registerSurveyBounds(tileset);
          updateCloudPreload();
          viewer.scene.requestRender();
          patchControl(key, { loading: false });
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Failed to load point cloud tileset:", err);
          patchControl(key, { loading: false, error: "Failed to load point cloud tiles" });
        });
      controls.push({ key, label: "Point cloud", category: "pointcloud", visible: pointCloudIsHero, opacity: 1, supportsOpacity: true, loading: true });
    });

    // Site models — georeferenced reality meshes (3D Tiles).
    (manifest.layers.site_models || []).forEach((l, i) => {
      if (!l.tileset_url) return;
      const key = `sitemodel-${i}`;
      const tilesetUrl = l.tileset_url;
      Cesium3DTileset.fromUrl(tilesetUrl, tilesetBudget)
        .then((tileset) => {
          // See the point-cloud loader: a tileset resolved after the effect
          // re-ran was never parented and must be destroyed, not leaked.
          if (cancelled || viewer.isDestroyed()) {
            tileset.destroy();
            return;
          }
          // The ortho-textured reality mesh already bakes in real capture
          // lighting, so Cesium's directional shading double-darkens the
          // sun-away faces vs the unlit base imagery. Lift the tileset light so
          // the texture reads at full brightness while keeping some relief.
          // (Harmless on the untextured grey fallback.)
          tileset.lightColor = new Cartesian3(2.4, 2.4, 2.4);
          tileset.show = visibleRef.current.get(key) ?? false;
          viewer.scene.primitives.add(tileset);
          handles.set(key, { type: "tileset", tileset });
          registerSurveyBounds(tileset);
          viewer.scene.requestRender();
          patchControl(key, { loading: false });
          // Clipping only engages once the mesh has demonstrated a full cover
          // of the view — cutting the globe any earlier exposes the void where
          // tiles haven't streamed in. No timer override: a mesh whose leaf
          // tiles exceed the cache budget (no LOD pyramid) can never cover and
          // must keep the globe rendering under it. It does stop holding the
          // hidden-cloud preload hostage after 30s — only clipping demands
          // real cover.
          //
          // "All tiles loaded" alone is NOT proof of cover: when the tiles the
          // view needs exceed cacheBytes + maximumCacheOverflowBytes, Cesium
          // raises memoryAdjustedScreenSpaceError (2%/frame) until the needed
          // set fits the budget, then reports loaded — with permanent holes on
          // a leaf-only tileset, where no coarser ancestor exists to stand in
          // for the leaves it couldn't afford. The elevated adjusted SSE is
          // Cesium's own confession that cover was unaffordable; refuse to
          // clip while it shows. (Runtime getter, @private in the typings but
          // a stable documented member; if absent, assume no pressure.)
          const fullCoverAffordable = () => {
            const adjusted = (
              tileset as unknown as { memoryAdjustedScreenSpaceError?: number }
            ).memoryAdjustedScreenSpaceError;
            return adjusted === undefined || adjusted <= tileset.maximumScreenSpaceError;
          };
          const markMeshReady = () => {
            if (cancelled || meshReadyRef.current.has(key) || !fullCoverAffordable()) return;
            meshReadyRef.current.add(key);
            setClipInputsVersion((v) => v + 1);
            updateCloudPreload();
          };
          if (tileset.tilesLoaded) markMeshReady();
          else {
            // allTilesLoaded, not initialTilesLoaded: it re-fires on every
            // later everything-settled transition, so a mesh that was under
            // memory pressure at its first settle is re-evaluated when the
            // pressure clears instead of losing its only chance to clip.
            tileset.allTilesLoaded.addEventListener(markMeshReady);
            setTimeout(() => {
              if (cancelled || meshPreloadWaiverRef.current.has(key)) return;
              meshPreloadWaiverRef.current.add(key);
              updateCloudPreload();
            }, 30_000);
          }
          // Data footprint for terrain clipping — resolved from the tileset's
          // own tile tree; null means "never clip", handled by the effect.
          computeTilesetFootprint(new URL(tilesetUrl, window.location.href).toString()).then(
            (ring) => {
              if (cancelled || !ring) return;
              footprintsRef.current.set(
                key,
                ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))
              );
              setClipInputsVersion((v) => v + 1);
            }
          );
        })
        .catch((err) => {
          if (cancelled) return;
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
      const key = `vector-${i}`;
      // A contour layer may now ship an XYZ PNG pyramid (constant-cost imagery)
      // beside its heavy GeoJSON. When present, register a lazy IMAGERY handle
      // built from the SAME ortho machinery on first show; the pyramid is
      // confined to the survey extent. Older contours (no tiles) — and every
      // other vector role — keep the GeoJSON path untouched.
      const tiles = contourTileTemplate(l.properties);
      if (tiles) {
        handles.set(key, {
          type: "imagery-lazy",
          template: tiles.template, // already CORS-proxied at manifest load
          minZoom: tiles.minZoom,
          maxZoom: tiles.maxZoom,
          rectangle: surveyRect,
        });
        controls.push({
          key,
          label: `${l.role || "vector"} (${l.feature_count})`,
          category: "vector",
          visible: false,
          opacity: 1,
          // Tiles honor alpha (like ortho) — expose the opacity slider. The
          // GeoJSON fallback below can't, so it stays false there.
          supportsOpacity: true,
          intervalM: l.interval_m,
          vectorRole: l.role,
        });
        return;
      }
      if (!l.geojson_url) return;
      handles.set(key, { type: "geojson-lazy", url: l.geojson_url });
      controls.push({
        key,
        label: `${l.role || "vector"} (${l.feature_count})`,
        category: "vector",
        visible: false,
        opacity: 1,
        supportsOpacity: false,
        intervalM: l.interval_m,
        vectorRole: l.role,
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
  }, [viewerReady, manifest, patchControl, registerSurveyBounds, updateCloudPreload]);

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

  // The globe's terrain depth test buries point clouds: a drone cloud sits
  // largely BELOW the base surface (World Terrain bakes in tree canopy and
  // pre-dates the excavation; a survey DSM is the very surface the points
  // scatter ± around), so with the test on most points z-fail against the
  // globe and the cloud degrades to sparse confetti. Suspend the test while
  // any point cloud is shown — points then always draw over the globe, while
  // primitive-vs-primitive depth (the mesh occluding coincident points)
  // still applies — and restore it otherwise so measurement overlays keep
  // clamping against hills instead of bleeding through them. Matched by key
  // prefix, not category: the reality mesh shares the "pointcloud" category.
  const anyPointCloudVisible = layerControls.some(
    (c) => c.key.startsWith("pointcloud-") && c.visible
  );
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    viewer.scene.globe.depthTestAgainstTerrain = !anyPointCloudVisible;
    viewer.scene.requestRender();
  }, [viewerReady, anyPointCloudVisible]);

  // Terrain isolation: World Terrain (~30m, canopy baked in, pre-excavation)
  // disagrees with the survey wherever the drone flew, so parts of the reality
  // mesh sit below it and z-fail into draped-terrain geometry. Clip the globe
  // out under each visible mesh's data footprint — the survey owns the ground
  // there. Only under the opaque mesh: clipping under sparse points would open
  // see-through gaps between them (clouds keep the depth-test suspension
  // above), and only while the World Terrain base is active (a survey DSM/DTM
  // provider IS survey truth; the flat ellipsoid never occludes). No footprint
  // yet (or none derivable) → leave the globe intact: over-clipping shows the
  // void behind the globe, which is worse than the z-fight it would fix.
  const anySiteMeshVisible = layerControls.some(
    (c) => c.key.startsWith("sitemodel-") && c.visible
  );
  const anySurveyTerrainVisible = layerControls.some(
    (c) => c.category === "terrain" && c.visible
  );
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    if (!USE_WORLD_TERRAIN || !ClippingPolygonCollection.isSupported(viewer.scene)) return;
    if (!clipCollectionRef.current) {
      clipCollectionRef.current = new ClippingPolygonCollection({ enabled: false });
      viewer.scene.globe.clippingPolygons = clipCollectionRef.current;
    }
    const collection = clipCollectionRef.current;
    collection.removeAll();
    if (anySiteMeshVisible && !anySurveyTerrainVisible) {
      for (const [key, positions] of footprintsRef.current) {
        if (visibleRef.current.get(key) && meshReadyRef.current.has(key)) {
          collection.add(new ClippingPolygon({ positions }));
        }
      }
    }
    collection.enabled = collection.length > 0;
    viewer.scene.requestRender();
  }, [viewerReady, anySiteMeshVisible, anySurveyTerrainVisible, clipInputsVersion]);

  // Terrain exaggeration (ported): scales heights around the ellipsoid so
  // subtle relief reads at a glance. ×1 is true scale.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    viewer.scene.verticalExaggeration = terrainExaggeration;
    viewer.scene.verticalExaggerationRelativeHeight = 0;
    viewer.scene.requestRender();
  }, [viewerReady, terrainExaggeration]);

  // Sun position: globe lighting + clock time-of-day slider.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    viewer.scene.globe.enableLighting = sunLightingEnabled;
    if (sunLightingEnabled) {
      // sunHour is LOCAL solar time at the site. Cesium's clock is UTC, so
      // offset by the camera longitude (15° ≈ 1 h) before stamping UTC hours —
      // otherwise noon lights the site as if it were noon in Greenwich, which
      // is dawn/dusk for anywhere far from the prime meridian.
      const lng = CesiumMath.toDegrees(viewer.camera.positionCartographic.longitude);
      const t = ((sunHour - lng / 15) % 24 + 24) % 24;
      let h = Math.floor(t);
      let m = Math.round((t - h) * 60);
      if (m === 60) {
        h = (h + 1) % 24;
        m = 0;
      }
      const d = JulianDate.toDate(JulianDate.now());
      d.setUTCHours(h, m, 0, 0);
      viewer.clock.currentTime = JulianDate.fromDate(d);
    }
    viewer.scene.requestRender();
  }, [viewerReady, sunLightingEnabled, sunHour]);

  // Set the default terrain once per layer build (see SurveyViewer:1164-1174).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed() || !manifest) return;
    const sig = layersSignatureRef.current;
    if (!sig || defaultTerrainSigRef.current === sig) return;
    if (!(viewer.terrainProvider instanceof EllipsoidTerrainProvider)) return;
    const t = layerControls.find((c) => c.category === "terrain" && c.visible);
    if (t) {
      const h = handlesRef.current.get(t.key);
      if (h?.type === "terrain") {
        applyTerrain(h.url).then((ok) => {
          if (ok) defaultTerrainSigRef.current = sig;
        });
      }
    } else if (USE_WORLD_TERRAIN) {
      applyTerrain(null).then((ok) => {
        // resolves to the World Terrain base
        if (ok) defaultTerrainSigRef.current = sig;
      });
    }
  }, [viewerReady, manifest, layerControls, applyTerrain]);

  // -------------------------------------------------- measurement rendering
  // Opt-in only: the viewer starts empty of stockpiles. A measurement paints
  // only while its eye is on; hidden ones are omitted from the datasource.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    let cancelled = false;

    const visibility = measurementVisibility;
    const features = measurements
      .filter((m) => m.geometry && visibility[m.id] === true)
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
        // Per-measurement style (params.style, STYLE tab) over the defaults:
        // polygon fill/outline, polyline color/width/dash, optional label.
        const byId = new Map(measurements.map((m) => [m.id, m]));
        // Snapshot the feature entities before the loop — we add vertex-marker
        // entities to the SAME datasource inside it, and iterating a live
        // EntityCollection while adding would also visit the new markers.
        const featureEntities = Array.from(ds.entities.values);
        for (const entity of featureEntities) {
          const raw = entity.properties?.id;
          const id: string | undefined =
            typeof raw?.getValue === "function"
              ? raw.getValue(JulianDate.now())
              : typeof raw === "string"
                ? raw
                : undefined;
          const m = id ? byId.get(id) : undefined;
          if (!m) continue;
          const st = styleOf(m.params);
          const fill = Color.fromCssColorString(st.fill).withAlpha(st.fillOpacity);
          const stroke = Color.fromCssColorString(st.stroke);
          const strokeMaterial =
            st.strokeStyle === "solid"
              ? new ColorMaterialProperty(stroke)
              : new PolylineDashMaterialProperty({
                color: stroke,
                dashLength: 16,
                dashPattern: st.strokeStyle === "dashed" ? 0x00ff : 0x1111,
              });
          if (entity.polygon) {
            entity.polygon.material = new ColorMaterialProperty(fill);
            entity.polygon.outline = new ConstantProperty(false);

            // GeoJSON polygons do not get a polyline entity, so render the
            // user-drawn exterior ring separately to support width and dashes.
            if (m.geometry?.type === "Polygon") {
              const ring = (m.geometry.coordinates as number[][][])[0] ?? [];
              if (ring.length > 1) {
                entity.polyline = new PolylineGraphics({
                  positions: ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
                  material: strokeMaterial,
                  width: st.strokeWidth,
                  clampToGround: true,
                });
              }
            }
          }
          if (entity.polyline) {
            entity.polyline.material = strokeMaterial;
            entity.polyline.width = new ConstantProperty(st.strokeWidth);
          }
          if (st.labelVisible && st.labelField !== "none" && m.geometry) {
            const text =
              st.labelField === "volume"
                ? (() => {
                  const mm = metricsOf(resultForKind(m));
                  const v = mm.volume_m3 ?? mm.net_change_m3;
                  return typeof v === "number"
                    ? `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} m³`
                    : m.name;
                })()
                : m.name;
            // Anchor at the geometry's vertex centroid (good enough for tags).
            const coords =
              m.geometry.type === "Polygon"
                ? ((m.geometry.coordinates as number[][][])[0] ?? [])
                : ((m.geometry.coordinates as number[][]) ?? []);
            if (coords.length) {
              const lng = coords.reduce((a, c) => a + c[0], 0) / coords.length;
              const lat = coords.reduce((a, c) => a + c[1], 0) / coords.length;
              entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(lng, lat));
              entity.label = new LabelGraphics({
                text,
                font: `${st.labelSize}px sans-serif`,
                fillColor: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              });
            }
          }

          // Vertex markers — a dot per placed vertex, matching the drawing
          // highlight, so a rendered shape keeps showing its vertices. Added as
          // sibling entities in the same datasource (cleaned up on re-render).
          const ring =
            m.geometry?.type === "Polygon"
              ? ((m.geometry.coordinates as number[][][])[0] ?? []).slice()
              : m.geometry?.type === "LineString"
                ? ((m.geometry.coordinates as number[][]) ?? [])
                : [];
          // A GeoJSON polygon ring closes on itself — drop the duplicate last
          // coordinate so the origin isn't double-dotted.
          if (m.geometry?.type === "Polygon" && ring.length > 1) {
            const a = ring[0];
            const b = ring[ring.length - 1];
            if (a[0] === b[0] && a[1] === b[1]) ring.pop();
          }
          for (const [lng, lat] of ring) {
            ds.entities.add({
              position: Cartesian3.fromDegrees(lng, lat),
              point: {
                pixelSize: 7,
                color: stroke,
                outlineColor: Color.WHITE,
                outlineWidth: 1.5,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          }
        }
        if (measurementDsRef.current) {
          viewer.dataSources.remove(measurementDsRef.current, true);
        }
        measurementDsRef.current = ds;
        viewer.dataSources.add(ds);
        viewer.scene.requestRender();
      })
      .catch((err) => console.error("Failed to render measurements:", err));

    return () => {
      cancelled = true;
    };
  }, [viewerReady, measurements, measurementVisibility]);
}
