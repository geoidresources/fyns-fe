"use client";

// Draw interaction lifecycle (viewer-shell §2.3 hook `useDrawInteraction`).
// MOVED VERBATIM from SurveyViewer: the probe LEFT_CLICK effect (:1666-1693),
// the ESC-cancels-draw key effect (:1847-1854), and the unmount cleanup
// (:1856). The imperative draw/probe START logic stays in ViewerRuntime as
// callbacks (startDraw/startProbe/cancelDraw/cleanupDraw); this hook owns only
// the effects. State access swapped to store setters via `deps`; bodies
// line-identical.
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, type RefObject } from "react";
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

    return () => handler.destroy();
  }, [probing, viewerReady]);

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
}
