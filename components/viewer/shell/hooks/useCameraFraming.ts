"use client";

// Camera framing (viewer-shell §2.3 hook `useCameraFraming`). MOVED from
// SurveyViewer.tsx:553-608 — the flyToRectangle callback plus the bbox → tileset
// → project-center precedence effect. The ONLY change is the added terminal
// "url" precedence guard (§5.6): when the load sequence has applied a URL camera
// (`cameraTargetRef.current === "url"`), the bbox/tileset/center chain MUST
// yield. 1.4 sets "url"; in 1.3c-i nothing does, so the guard is a wired no-op.
//
// exhaustive-deps is disabled because the effect's dependencies are passed in
// through `deps` (refs + a memoised callback) and are managed exactly as in the
// original monolith; the body below is line-identical to the source block.
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, type RefObject } from "react";
import { Cartesian3, Rectangle, type Viewer as CesiumViewer } from "cesium";
import { getProject } from "@/lib/api/userSvc";
import type { Manifest } from "@/lib/api/assetSvc";
import { DEFAULT_CENTER, bboxToRectangle } from "@/components/viewer/shell/sceneHelpers";

export type CameraTarget = "none" | "center" | "tileset" | "bbox" | "url";

export function useCameraFraming(deps: {
  viewerReady: boolean;
  manifest: Manifest | null;
  viewerRef: RefObject<CesiumViewer | null>;
  cameraTargetRef: RefObject<CameraTarget>;
  flyToRectangle: (rect: Rectangle) => void;
}) {
  const { viewerReady, manifest, viewerRef, cameraTargetRef, flyToRectangle } = deps;

  // Fly to the survey bbox when layers exist; fall back to the project center.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed() || !manifest) return;
    if (cameraTargetRef.current === "url") return; // §5.6 terminal "url" precedence stub (1.4 sets it)

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
    // The center guess resolves against a live API while survey tilesets load
    // in parallel; whichever real tileset frames first must not be overwritten
    // by this weaker fallback landing later.
    const centerSuperseded = () => cameraTargetRef.current === "tileset";
    getProject(manifest.survey.project_id)
      .then((p) => {
        if (cancelled || !viewer || viewer.isDestroyed() || centerSuperseded()) return;
        const lat = p.center_lat ?? DEFAULT_CENTER.lat;
        const lng = p.center_lng ?? DEFAULT_CENTER.lng;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lng, lat, DEFAULT_CENTER.height),
          duration: 2.0,
        });
      })
      .catch(() => {
        if (cancelled || !viewer || viewer.isDestroyed() || centerSuperseded()) return;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(DEFAULT_CENTER.lng, DEFAULT_CENTER.lat, DEFAULT_CENTER.height),
          duration: 2.0,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [viewerReady, manifest, flyToRectangle]);
}
