"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  defined,
  type Viewer as CesiumViewer,
} from "cesium";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Orbit } from "lucide-react";

// Max distance (px) the knob travels from the base center. Kept well inside the
// base radius so the knob never clips the rim at full deflection.
const KNOB_RADIUS = 30;

// Angular speed at full knob deflection (radians / second). Scaled by the
// normalized deflection and the frame delta so the orbit feels frame-rate
// independent and eases in from the center.
const YAW_RATE = 1.3; // horizontal orbit (heading)
const PITCH_RATE = 1.1; // vertical orbit (tilt)

// Pitch is clamped to a useful band: just shy of straight-down (top-down survey
// view) to a low oblique, never crossing the horizon (which would put the
// camera underground) or going fully vertical (gimbal flip).
const MIN_PITCH = CesiumMath.toRadians(-89);
const MAX_PITCH = CesiumMath.toRadians(-8);

/**
 * Resolves the world point to orbit around: the surface under the center of the
 * viewport. Tries the depth buffer (terrain / 3D tiles) first, then the globe
 * ray, then the ellipsoid, and finally a point straight ahead so a drag always
 * has a pivot even when pointed at the sky.
 */
function computePivot(viewer: CesiumViewer): Cartesian3 {
  const { scene, camera } = viewer;
  const canvas = scene.canvas;
  const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);

  if (scene.pickPositionSupported) {
    const picked = scene.pickPosition(center);
    if (defined(picked)) return picked;
  }
  const ray = camera.getPickRay(center);
  const onGlobe = ray ? scene.globe.pick(ray, scene) : undefined;
  if (onGlobe) return onGlobe;
  const onEllipsoid = camera.pickEllipsoid(center, scene.globe.ellipsoid);
  if (onEllipsoid) return onEllipsoid;

  // Last resort: a point 1km in front of the camera.
  return Cartesian3.add(
    camera.position,
    Cartesian3.multiplyByScalar(camera.direction, 1000, new Cartesian3()),
    new Cartesian3()
  );
}

interface CameraJoystickProps {
  /** Ref to the live Cesium viewer, owned by the parent. */
  viewerRef: React.RefObject<CesiumViewer | null>;
  /** Becomes true once the viewer is mounted and safe to drive. */
  ready: boolean;
}

/**
 * Hold-and-drag joystick that orbits the viewer camera around the point at the
 * center of the screen. Push left/right to swing the heading, push up to tilt
 * toward the horizon (oblique 3D), push down to return toward top-down. Works
 * with mouse, touch and pen via pointer capture.
 */
export function CameraJoystick({ viewerRef, ready }: CameraJoystickProps) {
  const [active, setActive] = useState(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const baseRef = useRef<HTMLDivElement>(null);
  // Normalized deflection [-1, 1] read by the animation loop; a ref so updating
  // it during a drag doesn't re-render every frame.
  const deflectRef = useRef({ x: 0, y: 0 });
  // Orbit pivot stays fixed for the duration of a single drag for a stable swing.
  const pivotRef = useRef<Cartesian3 | null>(null);

  // While the joystick is held (active), run a rAF loop that orbits the camera
  // by the current deflection each frame. Releasing flips `active` off and the
  // effect cleanup cancels the loop.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;

    function frame(ts: number) {
      const v = viewerRef.current;
      if (!v || v.isDestroyed()) return;

      // Clamp dt so a backgrounded tab doesn't snap the camera on resume.
      const dt = Math.min((ts - (last || ts)) / 1000, 0.05);
      last = ts;

      const { x, y } = deflectRef.current;
      if (x !== 0 || y !== 0) {
        const { scene } = v;
        const camera = scene.camera;
        const pivot = (pivotRef.current ??= computePivot(v));

        // Operate in the pivot's east-north-up frame so rotateRight/rotateUp
        // orbit around it instead of around the globe center; release the
        // frame afterwards so Cesium's own controls keep working.
        camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(pivot));

        if (x !== 0) camera.rotateRight(x * YAW_RATE * dt);

        if (y !== 0) {
          // Knob up (y < 0) eases toward the horizon; down returns top-down.
          const prevPitch = camera.pitch;
          const delta = y * PITCH_RATE * dt;
          camera.rotateUp(delta);
          // Reject only moves that push pitch further outside the band, so a
          // view starting dead top-down can still tilt back into range.
          const pitch = camera.pitch;
          const worse =
            (pitch < MIN_PITCH && pitch < prevPitch) ||
            (pitch > MAX_PITCH && pitch > prevPitch);
          if (worse) camera.rotateUp(-delta);
        }

        camera.lookAtTransform(Matrix4.IDENTITY);
        scene.requestRender();
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, viewerRef]);

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > KNOB_RADIUS) {
      dx = (dx / dist) * KNOB_RADIUS;
      dy = (dy / dist) * KNOB_RADIUS;
    }
    setKnob({ x: dx, y: dy });
    deflectRef.current = { x: dx / KNOB_RADIUS, y: dy / KNOB_RADIUS };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!viewerRef.current) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      pivotRef.current = null; // resolve a fresh pivot on the first frame
      updateFromPointer(e.clientX, e.clientY);
      setActive(true); // starts the rAF loop via the effect above
    },
    [updateFromPointer, viewerRef]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      updateFromPointer(e.clientX, e.clientY);
    },
    [updateFromPointer]
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setActive(false); // effect cleanup cancels the rAF loop
    setKnob({ x: 0, y: 0 });
    deflectRef.current = { x: 0, y: 0 };
    pivotRef.current = null;
  }, []);

  if (!ready) return null;

  const dx = knob.x / KNOB_RADIUS;
  const dy = knob.y / KNOB_RADIUS;

  return (
    <div className="absolute right-6 bottom-6 z-10 flex flex-col items-center gap-2 select-none">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Camera angle
      </span>
      <div
        ref={baseRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Hold and drag to change the camera angle"
        title="Hold and drag to change the camera angle"
        className={`relative h-28 w-28 rounded-full border bg-[#12141A]/90 backdrop-blur-xl shadow-2xl touch-none transition-colors ${
          active
            ? "border-[#C97A4E]/60 cursor-grabbing"
            : "border-[#1E2028] cursor-grab hover:border-[#2A2D35]"
        }`}
      >
        {/* Crosshair guides */}
        <div className="pointer-events-none absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2 bg-white/5" />
        <div className="pointer-events-none absolute top-1/2 left-3 right-3 h-px -translate-y-1/2 bg-white/5" />

        {/* Directional hints — brighten toward the side being pushed */}
        <ChevronUp
          size={14}
          className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 transition-colors"
          style={{ color: dy < -0.15 ? "#C97A4E" : "#4B5563" }}
        />
        <ChevronDown
          size={14}
          className="pointer-events-none absolute left-1/2 bottom-1.5 -translate-x-1/2 transition-colors"
          style={{ color: dy > 0.15 ? "#C97A4E" : "#4B5563" }}
        />
        <ChevronLeft
          size={14}
          className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 transition-colors"
          style={{ color: dx < -0.15 ? "#C97A4E" : "#4B5563" }}
        />
        <ChevronRight
          size={14}
          className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 transition-colors"
          style={{ color: dx > 0.15 ? "#C97A4E" : "#4B5563" }}
        />

        {/* Knob */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-[#C97A4E]/40 text-[#0A0D14]"
          style={{
            background: "linear-gradient(to bottom, #C97A4E, #b06941)",
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            transition: active ? "none" : "transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)",
            boxShadow: active
              ? "0 0 18px rgba(201,122,78,0.55)"
              : "0 0 10px rgba(201,122,78,0.25)",
          }}
        >
          <Orbit size={20} strokeWidth={2.25} />
        </div>
      </div>
    </div>
  );
}
