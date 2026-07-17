"use client";

// Draw interaction lifecycle (viewer-shell §2.3 hook `useDrawInteraction`).
// MOVED VERBATIM from SurveyViewer: the probe LEFT_CLICK effect (:1666-1693),
// the ESC-cancels-draw key effect (:1847-1854), and the unmount cleanup
// (:1856). The imperative draw/probe START logic stays in ViewerRuntime as
// callbacks (startDraw/startProbe/cancelDraw/cleanupDraw); this hook owns only
// the effects. State access swapped to store setters via `deps`; bodies
// line-identical.
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, useRef, type RefObject } from "react";
import {
  Color,
  ConstantPositionProperty,
  Entity,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer as CesiumViewer,
} from "cesium";
import {
  pickScenePosition,
  toLngLatHeight,
  type LngLatHeight,
} from "@/lib/viewer/measure";
import type { DrawMode } from "@/components/viewer/MeasurementPanel";
import { ACCENT } from "@/components/viewer/shell/sceneHelpers";

export function useDrawInteraction(deps: {
  probing: boolean;
  viewerReady: boolean;
  viewerRef: RefObject<CesiumViewer | null>;
  drawMode: DrawMode | null;
  rightPanel: "measure" | "inspect" | null;
  setProbePoint: (p: LngLatHeight | null) => void;
  probeEntityRef: RefObject<Entity | null>;
  cancelDraw: () => void;
  cleanupDraw: () => void;
}) {
  const {
    probing,
    viewerReady,
    viewerRef,
    drawMode,
    rightPanel,
    setProbePoint,
    probeEntityRef,
    cancelDraw,
    cleanupDraw,
  } = deps;

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
    // Right-click exits probe so scene picking / cursor use resumes.
    handler.setInputAction(() => cancelDraw(), ScreenSpaceEventType.RIGHT_CLICK);

    return () => handler.destroy();
  }, [probing, viewerReady, cancelDraw]);

  // ESC discards an in-flight or right-click-locked drawing / closes the detail
  // panel. Inputs are excluded so Escape means "leave the field", not discard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      const drawing = !!drawMode || probing;
      if (!drawing && !rightPanel) return;
      e.preventDefault();
      cancelDraw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, probing, rightPanel, cancelDraw]);

  // Unmount-only Cesium teardown. Keep cleanupDraw out of the effect deps so a
  // callback identity change cannot wipe an in-progress draw mid-session.
  const cleanupDrawRef = useRef(cleanupDraw);
  useEffect(() => {
    cleanupDrawRef.current = cleanupDraw;
  }, [cleanupDraw]);
  useEffect(() => () => cleanupDrawRef.current(), []);
}
