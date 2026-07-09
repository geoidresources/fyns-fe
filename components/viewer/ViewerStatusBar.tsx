"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer as CesiumViewer,
} from "cesium";
import { Navigation2 } from "lucide-react";

import { pickScenePosition, toLngLatHeight, type LngLatHeight } from "@/lib/viewer/measure";

// The design's bottom status bar (§6): live cursor coordinates + elevation,
// camera altitude, a north indicator driven by the heading, and the survey
// date. The camera-tracking logic is ported from rendering-engine-fe's
// moveEnd camera-state sync; cursor sampling reuses the shared scene picker.

const CURSOR_SAMPLE_MS = 100;

interface CameraReadout {
  headingDegrees: number;
  heightMeters: number;
}

interface ViewerStatusBarProps {
  viewerRef: React.RefObject<CesiumViewer | null>;
  ready: boolean;
  surveyDate?: string;
}

function formatAltitude(heightMeters: number): string {
  return heightMeters >= 10000
    ? `${(heightMeters / 1000).toFixed(1)} km`
    : `${Math.round(heightMeters)} m`;
}

export function ViewerStatusBar({ viewerRef, ready, surveyDate }: ViewerStatusBarProps) {
  const [cursor, setCursor] = useState<LngLatHeight | null>(null);
  const [camera, setCamera] = useState<CameraReadout | null>(null);
  const lastSampleRef = useRef(0);

  // Cursor position — throttled depth-buffer pick under the mouse.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      const now = performance.now();
      if (now - lastSampleRef.current < CURSOR_SAMPLE_MS) return;
      lastSampleRef.current = now;
      if (viewer.isDestroyed()) return;
      const position = pickScenePosition(viewer, movement.endPosition);
      setCursor(position ? toLngLatHeight(position) : null);
    }, ScreenSpaceEventType.MOUSE_MOVE);

    return () => handler.destroy();
  }, [viewerRef, ready]);

  // Camera heading + altitude — updates while the camera moves and settles.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || viewer.isDestroyed()) return;

    const update = () => {
      if (viewer.isDestroyed()) return;
      setCamera({
        headingDegrees: CesiumMath.toDegrees(viewer.camera.heading),
        heightMeters: viewer.camera.positionCartographic.height,
      });
    };
    // Fire on small moves too, not just the default 50% change.
    viewer.camera.percentageChanged = 0.05;
    viewer.camera.changed.addEventListener(update);
    viewer.camera.moveEnd.addEventListener(update);
    update();

    return () => {
      if (viewer.isDestroyed()) return;
      viewer.camera.changed.removeEventListener(update);
      viewer.camera.moveEnd.removeEventListener(update);
    };
  }, [viewerRef, ready]);

  if (!ready) return null;

  const heading = camera ? ((camera.headingDegrees % 360) + 360) % 360 : 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-6 items-center justify-between gap-4 border-t border-white/[0.08] bg-[#111114]/85 px-3 text-[10px] tabular-nums text-gray-400 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        {cursor ? (
          <>
            <span className="truncate">
              LAT {cursor.latitude.toFixed(5)}° · LNG {cursor.longitude.toFixed(5)}°
            </span>
            <span className="text-gray-500">ELEV {cursor.height.toFixed(1)} m</span>
          </>
        ) : (
          <span className="text-gray-600">Move the cursor over the site for coordinates</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {camera && <span>ALT {formatAltitude(camera.heightMeters)}</span>}
        <span className="flex items-center gap-1" title="North">
          {/* Navigation2 is a symmetric north-pointing arrowhead (points
              straight up at 0°); plain Navigation points up-RIGHT, so its
              rotation misreads the heading by ~45°. */}
          <Navigation2
            size={10}
            className="text-[#C97A4E]"
            style={{ transform: `rotate(${-heading}deg)` }}
          />
          {heading.toFixed(0).padStart(3, "0")}°
        </span>
        {surveyDate && <span className="text-gray-500">{surveyDate}</span>}
      </div>
    </div>
  );
}
