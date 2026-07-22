"use client";

// Survey compare (swipe) — mounts two epochs' orthomosaics as split imagery
// layers so a draggable divider wipes between a "before" and an "after" survey
// in place. Structurally mirrors useLayerLifecycle: one effect keyed on the
// compare store state adds the dedicated compare ImageryLayers (A on the LEFT of
// Scene#splitPosition, B on the RIGHT) and hides the normal ortho while active;
// a second effect keeps Scene#splitPosition synced to the store as the divider
// is dragged (a fast-changing value, so it must NOT re-fetch manifests).
//
// Cleanup is exhaustive (viewer-shell §3.2 — no leaked handles): on deactivate,
// on A/B change, and on unmount the compare layers are removed and every ortho
// layer we hid is restored. The compare layers live in this hook's own refs
// (they are exclusive to it); the shared `handlesRef` is read only to toggle the
// normal ortho's `.show`.

import { useEffect, useRef, type RefObject } from "react";
import {
  ImageryLayer,
  SplitDirection,
  UrlTemplateImageryProvider,
  type Viewer as CesiumViewer,
} from "cesium";

import { getManifest, type Manifest } from "@/lib/api/assetSvc";
import {
  bboxToRectangle,
  pickXyzTemplate,
  proxyGcsUrls,
  type LayerHandle,
} from "@/components/viewer/shell/sceneHelpers";

/** Adds one epoch's ortho as a rectangle-confined, split-directed imagery layer,
 * or returns null when that survey's manifest has no XYZ ortho. GCS urls are
 * proxied onto the /gcs same-origin path (Cesium's WebGL fetch needs CORS),
 * exactly as the primary layer path does at manifest load. */
function addSplitOrtho(
  viewer: CesiumViewer,
  manifest: Manifest,
  direction: SplitDirection
): ImageryLayer | null {
  const ortho = proxyGcsUrls((manifest.layers.ortho || [])[0]);
  if (!ortho) return null;
  const template = pickXyzTemplate(ortho.output_urls);
  if (!template) return null;
  const provider = new UrlTemplateImageryProvider({
    url: template, // gdal2tiles XYZ scheme — {z}/{x}/{y} top-origin
    rectangle: bboxToRectangle(ortho.bbox),
    minimumLevel: ortho.min_zoom && ortho.min_zoom > 0 ? ortho.min_zoom : undefined,
    maximumLevel: ortho.max_zoom && ortho.max_zoom > 0 ? ortho.max_zoom : undefined,
  });
  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.splitDirection = direction;
  return layer;
}

export function useCompareLayers(deps: {
  viewerReady: boolean;
  compareActive: boolean;
  compareA: string | null;
  compareB: string | null;
  splitPosition: number;
  viewerRef: RefObject<CesiumViewer | null>;
  handlesRef: RefObject<Map<string, LayerHandle>>;
}) {
  const {
    viewerReady,
    compareActive,
    compareA,
    compareB,
    splitPosition,
    viewerRef,
    handlesRef,
  } = deps;

  // The two compare layers this hook owns, and the normal ortho layers it hid
  // (with their prior `.show`) so activation is fully reversible.
  const compareLayersRef = useRef<ImageryLayer[]>([]);
  const hiddenOrthoRef = useRef<{ layer: ImageryLayer; show: boolean }[]>([]);

  // ---------------------------------------------- add / remove split layers
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    // Inactive / not-yet-seeded: nothing to add here. The PREVIOUS active
    // render's cleanup (below) already removed any layers, so there is nothing
    // to undo — React runs that cleanup before this body on every re-run.
    if (!compareActive || !compareA || !compareB) return;

    let cancelled = false;
    Promise.all([getManifest(compareA), getManifest(compareB)])
      .then(([manifestA, manifestB]) => {
        if (cancelled || viewer.isDestroyed()) return;

        // Hide the normal ortho so the "before" side never shows the current
        // epoch through a gap where a compare tile hasn't streamed in yet.
        for (const [key, handle] of handlesRef.current) {
          if (key.startsWith("ortho-") && handle.type === "imagery") {
            hiddenOrthoRef.current.push({ layer: handle.layer, show: handle.layer.show });
            handle.layer.show = false;
          }
        }

        const layerA = addSplitOrtho(viewer, manifestA, SplitDirection.LEFT);
        const layerB = addSplitOrtho(viewer, manifestB, SplitDirection.RIGHT);
        if (layerA) compareLayersRef.current.push(layerA);
        if (layerB) compareLayersRef.current.push(layerB);
        viewer.scene.requestRender();
      })
      .catch((err) => {
        console.error("Compare: failed to load ortho manifests:", err);
      });

    return () => {
      cancelled = true;
      if (viewer.isDestroyed()) return;
      for (const layer of compareLayersRef.current) {
        viewer.imageryLayers.remove(layer, true);
      }
      compareLayersRef.current = [];
      // Restore the ortho layers we hid — guard against a manifest rebuild
      // having already removed them from the collection.
      for (const { layer, show } of hiddenOrthoRef.current) {
        if (viewer.imageryLayers.contains(layer)) layer.show = show;
      }
      hiddenOrthoRef.current = [];
      viewer.scene.requestRender();
    };
  }, [viewerReady, compareActive, compareA, compareB, viewerRef, handlesRef]);

  // ---------------------------------------------------------- split position
  // Separate effect so dragging the divider (splitPosition changes every frame)
  // only nudges Scene#splitPosition — it never re-fetches the manifests above.
  // Harmless when no layer carries a split direction (the value is inert then).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed() || !compareActive) return;
    viewer.scene.splitPosition = splitPosition;
    viewer.scene.requestRender();
  }, [viewerReady, compareActive, splitPosition, viewerRef]);
}
