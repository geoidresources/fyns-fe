// Camera pose serialization (viewer-shell §5.3). One format
// (`CameraPose` — degrees, meters, ellipsoidal height) feeds three sinks: the
// URL codec (§5.2), bookmarks and presets (§5.7). Capture does NOT round — the
// codec is responsible for its own precision formatting (§5.2), so bookmarks
// keep full fidelity.
//
// `cesium` is externalized to `window.Cesium` at build time (next.config.ts),
// mirroring the other lib/viewer/* Cesium modules; there is no top-level Cesium
// side effect here, so this module is import-safe.

import {
  Cartesian3,
  Math as CesiumMath,
  type Viewer as CesiumViewer,
} from "cesium";

import type { CameraPose } from "@/lib/viewer/state/store";

/** Read the live camera into the serialization format. positionCartographic →
 * lon/lat/h; heading/pitch/roll radians → degrees. No rounding (§5.3). */
export function captureCameraPose(viewer: CesiumViewer): CameraPose {
  const { camera } = viewer;
  const carto = camera.positionCartographic;
  return {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    h: carto.height,
    heading: CesiumMath.toDegrees(camera.heading),
    pitch: CesiumMath.toDegrees(camera.pitch),
    roll: CesiumMath.toDegrees(camera.roll),
  };
}

/**
 * Drive per-frame renders for the duration of an ANIMATED camera flight
 * (`camera.flyTo` / `flyToBoundingSphere`). Our viewers run with
 * `requestRenderMode` on (and `maximumRenderTimeChange = Infinity`), so the
 * scene renders only when a render is explicitly requested. An animated flight
 * advances through per-frame tweens that are updated *inside* `scene.render()` —
 * so once the scene is idle, the tween never ticks and the camera appears frozen
 * (the "flyTo does nothing" bug). Instant moves avoid this by calling
 * `scene.requestRender()` once; an animated flight needs a render every frame
 * until it settles.
 *
 * Call this right after issuing the flight, passing the flight's `duration`.
 * Self-contained per flight (a short rAF pump bounded by the flight duration +
 * a small settle tail), so overlapping flights are safe — `requestRender()` is
 * idempotent within a frame and we never mutate the shared `requestRenderMode`.
 * No-op when `requestRenderMode` is already off (the scene renders every frame).
 */
export function pumpRendersDuringFlight(viewer: CesiumViewer, durationSeconds: number): void {
  // Browser-only: the pump is driven by requestAnimationFrame. Under SSR / unit
  // tests (node has no rAF) there is no live scene to animate, so no-op.
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined") return;
  const { scene } = viewer;
  if (viewer.isDestroyed() || !scene.requestRenderMode) return; // renders every frame already
  // 150ms tail so the final resting frame (flight `complete`) is drawn.
  const endAt = performance.now() + durationSeconds * 1000 + 150;
  const tick = () => {
    if (viewer.isDestroyed()) return;
    scene.requestRender();
    if (performance.now() < endAt) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Apply a pose to the camera. Default is an instant `setView` (used on URL
 * restore, §5.6 step 4); `animate` runs a 1.2s `flyTo` (bookmarks/presets,
 * §5.7). Destination from degrees, orientation in radians (§5.3). */
export function applyCameraPose(
  viewer: CesiumViewer,
  pose: CameraPose,
  opts?: { animate?: boolean }
): void {
  const destination = Cartesian3.fromDegrees(pose.lon, pose.lat, pose.h);
  const orientation = {
    heading: CesiumMath.toRadians(pose.heading),
    pitch: CesiumMath.toRadians(pose.pitch),
    roll: CesiumMath.toRadians(pose.roll),
  };
  if (opts?.animate) {
    viewer.camera.flyTo({ destination, orientation, duration: 1.2 });
    pumpRendersDuringFlight(viewer, 1.2);
  } else {
    viewer.camera.setView({ destination, orientation });
  }
}
