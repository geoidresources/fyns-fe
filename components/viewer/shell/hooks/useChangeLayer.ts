"use client";

// Change-detection scene layer (P0, task 2 + task 4). A self-contained sibling
// hook — like useCompareLayers — that owns ONE dedicated change-polygons
// datasource and its visibility toggle, wired reactively off the store manifest
// so a previously-computed set reappears on reload (task 4), not only right after
// a dispatch.
//
// Two effects:
//   • FETCH — watches manifest.analytics.changes, URL-diffs the current entry's
//     geojson_url, proxies it onto /gcs and fetches + parses the FeatureCollection
//     once, then writes the ChangeSet into the store so BOTH this layer and the
//     Changes card share the single fetch.
//   • RENDER — builds a GeoJsonDataSource from the parsed features, colored by
//     `properties.class` (cut = red, fill = blue) with a semi-transparent fill and
//     a solid clamped outline ring — the same GeoJsonDataSource idiom the
//     measurement overlay uses in useLayerLifecycle. Clamped to ground.
//
// Numbers are the server's (§4): this renders the change polygons, it never
// computes areas/volumes.

import { useEffect, type RefObject } from "react";
import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  type Entity,
  GeoJsonDataSource,
  JulianDate,
  PolylineGraphics,
  type Viewer as CesiumViewer,
} from "cesium";

import type { Manifest } from "@/lib/api/assetSvc";
import { proxyGcsUrls } from "@/components/viewer/shell/sceneHelpers";
import {
  CHANGE_COLORS,
  CHANGE_FILL_ALPHA,
  currentChangeEntry,
  exteriorRing,
  parseChangeFeatures,
  type ChangeClass,
  type ChangeSet,
} from "@/lib/viewer/changeDetect";

/** Cut = red, fill = blue, pre-parsed into Cesium colors once (out of any render
 * loop — §3 keeps per-frame allocations out). */
const CLASS_COLOR: Record<ChangeClass, Color> = {
  cut: Color.fromCssColorString(CHANGE_COLORS.cut),
  fill: Color.fromCssColorString(CHANGE_COLORS.fill),
};
const CLASS_FILL: Record<ChangeClass, Color> = {
  cut: CLASS_COLOR.cut.withAlpha(CHANGE_FILL_ALPHA),
  fill: CLASS_COLOR.fill.withAlpha(CHANGE_FILL_ALPHA),
};

const OUTLINE_WIDTH = 2.5;

/** Read a change feature's stamped index off its GeoJsonDataSource entity, so
 * the exterior ring (for the solid outline) can be pulled from the parsed
 * features — GeoJSON polygon entities carry no polyline of their own. Mirrors
 * the measurement overlay's `entity.properties?.id` readback in useLayerLifecycle. */
function entityIndex(entity: Entity): number | null {
  const raw = entity.properties?.__cd_idx as
    | { getValue?: (t: JulianDate) => unknown }
    | undefined;
  const v = typeof raw?.getValue === "function" ? raw.getValue(JulianDate.now()) : undefined;
  return typeof v === "number" ? v : null;
}

export function useChangeLayer(deps: {
  viewerReady: boolean;
  manifest: Manifest | null;
  changeSet: ChangeSet | null;
  changeLayerVisible: boolean;
  viewerRef: RefObject<CesiumViewer | null>;
  changeDsRef: RefObject<GeoJsonDataSource | null>;
  /** Persisted mirror of `changeLayerVisible`, so the async render can stamp the
   * FRESH visibility without adding it to the render effect's deps (which would
   * rebuild the datasource on every toggle). */
  changeVisibleRef: RefObject<boolean>;
  /** URL-diff guard for the fetch effect — the last geojson_url loaded. */
  lastChangeUrlRef: RefObject<string | null>;
  setChangeSet: (changeSet: ChangeSet | null) => void;
}) {
  const {
    viewerReady,
    manifest,
    changeSet,
    changeLayerVisible,
    viewerRef,
    changeDsRef,
    changeVisibleRef,
    lastChangeUrlRef,
    setChangeSet,
  } = deps;

  // Keep the visibility mirror current for the async render below.
  useEffect(() => {
    changeVisibleRef.current = changeLayerVisible;
  }, [changeLayerVisible, changeVisibleRef]);

  // -------------------------------------------------------------- FETCH
  // Off the store manifest so a previously-computed change set loads on reload
  // (task 4). The manifest analytics URLs are the plain storage.googleapis.com
  // form; proxyGcsUrls rewrites onto same-origin /gcs before fetching (idempotent
  // if the store copy was already proxied at load). URL-diffed so a manifest ref
  // change with the same geojson_url never re-fetches.
  useEffect(() => {
    const entry = currentChangeEntry(manifest?.analytics?.changes);
    const url = entry?.geojson_url ?? null;
    // Already loading/loaded this exact URL — bail WITHOUT touching the ref, so an
    // in-flight fetch for it survives (the manifest can refresh with the same
    // change URL; a per-run cleanup flag would cancel that fetch and, seeing the
    // same URL, never restart it → the layer would silently drop).
    if (url === lastChangeUrlRef.current) return;
    lastChangeUrlRef.current = url;

    if (!entry || !url) {
      setChangeSet(null);
      return;
    }

    // Guarded by the URL ref (not an effect-cleanup boolean): a stale fetch that
    // was superseded by a newer URL sees lastChangeUrlRef.current !== url and
    // drops its result; the current URL's fetch always commits.
    fetch(proxyGcsUrls(url))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((fc) => {
        if (lastChangeUrlRef.current !== url) return;
        setChangeSet({ entry, features: parseChangeFeatures(fc) });
      })
      .catch((err) => {
        if (lastChangeUrlRef.current !== url) return;
        console.error("Failed to load change polygons:", err);
        setChangeSet(null);
      });
  }, [manifest, lastChangeUrlRef, setChangeSet]);

  // -------------------------------------------------------------- RENDER
  // Build the dedicated change-polygons datasource from the parsed features.
  // Deps deliberately EXCLUDE changeLayerVisible (a separate effect toggles show)
  // so a visibility flip never rebuilds the geometry.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    // No set (or an empty one) → tear down any existing layer.
    if (!changeSet || changeSet.features.length === 0) {
      if (changeDsRef.current) {
        viewer.dataSources.remove(changeDsRef.current, true);
        changeDsRef.current = null;
        viewer.scene.requestRender();
      }
      return;
    }

    let cancelled = false;
    const features = changeSet.features;
    // Stamp the source index so each loaded entity can find its ring.
    const fc = {
      type: "FeatureCollection" as const,
      features: features.map((f, i) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: { class: f.properties.class, __cd_idx: i },
      })),
    };

    GeoJsonDataSource.load(fc, {
      clampToGround: true,
      // Neutral defaults; per-entity class styling is applied below.
      stroke: CLASS_COLOR.cut,
      fill: CLASS_FILL.cut,
      strokeWidth: OUTLINE_WIDTH,
    })
      .then((ds) => {
        if (cancelled || viewer.isDestroyed()) return;
        for (const entity of Array.from(ds.entities.values)) {
          const idx = entityIndex(entity);
          const feat = idx !== null ? features[idx] : undefined;
          if (!feat || !entity.polygon) continue;
          const cls = feat.properties.class;

          // Semi-transparent class fill; the outline is a separate clamped
          // polyline (a GeoJSON polygon entity gets no polyline of its own, and
          // clamped polygon.outline is 1px + z-fights) — mirrors the measurement
          // overlay's outline treatment in useLayerLifecycle.
          entity.polygon.material = new ColorMaterialProperty(CLASS_FILL[cls]);
          entity.polygon.outline = new ConstantProperty(false);

          const ring = exteriorRing(feat.geometry);
          if (ring.length > 1) {
            entity.polyline = new PolylineGraphics({
              positions: ring.map(([lng, lat]) => Cartesian3.fromDegrees(lng, lat)),
              material: new ColorMaterialProperty(CLASS_COLOR[cls]),
              width: OUTLINE_WIDTH,
              clampToGround: true,
            });
          }
        }

        ds.show = changeVisibleRef.current ?? true;
        if (changeDsRef.current) viewer.dataSources.remove(changeDsRef.current, true);
        changeDsRef.current = ds;
        viewer.dataSources.add(ds);
        viewer.scene.requestRender();
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to render change polygons:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [viewerReady, changeSet, viewerRef, changeDsRef, changeVisibleRef]);

  // -------------------------------------------------------------- VISIBILITY
  // Live toggle without rebuilding the datasource. Re-applies after a rebuild
  // (changeSet in deps) so a fresh set honors the current toggle state.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    if (changeDsRef.current) {
      changeDsRef.current.show = changeLayerVisible;
      viewer.scene.requestRender();
    }
  }, [viewerReady, changeLayerVisible, changeSet, viewerRef, changeDsRef]);
}
