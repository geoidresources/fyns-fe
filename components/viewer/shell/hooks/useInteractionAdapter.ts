"use client";

// Interaction v2 adapter (plan §2): the ONE place raw Cesium input becomes
// machine events. Created once per viewer (not per draw session — the machine's
// state decides what a click means, so handlers never rebind). This hook owns
// ONLY translation + the high-frequency hover refs; it makes no state decisions
// and renders nothing (that's useDraftRenderer).
//
// Geometry resolution done here, matching legacy behavior exactly:
//  - snap: origin (close ring, ≤15 px, ≥3 verts) wins over any nearby vertex
//    (≤13 px — other measurements' verts, terrain-lifted, or this draft's own
//    earlier ones); else raw terrain pick (checklist C4/C5).
//  - dedupe: clicks <0.01 m from the previous vertex are dropped (C12).
//  - hover: ref-only + 100 ms-throttled store mirror — no React re-renders.

import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer as CesiumViewer,
} from "cesium";
import type { ActorRefFrom } from "xstate";
import type { StoreApi } from "zustand/vanilla";
import { toast } from "sonner";

import { INTERACTION_V2 } from "@/lib/viewer/interaction/flag";
import type { interactionMachine } from "@/lib/viewer/interaction/machine";
import { geometryPositions, pickScenePosition } from "@/lib/viewer/measure";
import type { ViewerShellState } from "@/lib/viewer/state/store";

// Same values as the legacy module constants in ViewerCanvas (P3 consolidates).
const ORIGIN_SNAP_PX = 15;
const VERTEX_SNAP_PX = 13;
const HOVER_THROTTLE_MS = 100;
const DEDUPE_METERS = 0.01;

type InteractionActor = ActorRefFrom<typeof interactionMachine>;

export interface AdapterRefs {
  /** Cursor position (snapped when applicable) — renderer preview + live label. */
  hoverRef: RefObject<Cartesian3 | null>;
  /** Cursor is on the origin vertex (close-the-ring cue → origin halo). */
  nearOriginRef: RefObject<boolean>;
  /** The existing vertex the cursor is snapping onto (cyan halo target). */
  snapPreviewRef: RefObject<Cartesian3 | null>;
}

/** Lift height-0 positions onto loaded terrain so they project where their
 * CLAMPED dots render (memory: fyns-fe-draft-terrain-height). Best-effort. */
function liftPositions(viewer: CesiumViewer, positions: Cartesian3[]): Cartesian3[] {
  const globe = viewer.scene.globe;
  return positions.map((p) => {
    const carto = Cartographic.fromCartesian(p);
    if (!carto) return p;
    const h = globe.getHeight(carto);
    return typeof h === "number"
      ? Cartesian3.fromRadians(carto.longitude, carto.latitude, h)
      : p;
  });
}

export function useInteractionAdapter(
  viewerRef: RefObject<CesiumViewer | null>,
  viewerReady: boolean,
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>
): AdapterRefs {
  const hoverRef = useRef<Cartesian3 | null>(null);
  const nearOriginRef = useRef(false);
  const snapPreviewRef = useRef<Cartesian3 | null>(null);
  const snapTargetsRef = useRef<Cartesian3[]>([]);
  const hoverThrottleRef = useRef(0);

  // Session lifecycle: build the snap pool when a draw starts (idle → placing,
  // mirroring legacy startDraw's snapshot semantics) and clear the hover refs
  // when the session ends — a stale hover would ghost into the NEXT session's
  // preview before its first mousemove.
  useEffect(() => {
    if (!INTERACTION_V2) return;
    let prevState = actor.getSnapshot().value;
    const sub = actor.subscribe((snap) => {
      const entering = snap.value === "placing" && prevState === "idle";
      const leaving = snap.value === "idle" && prevState !== "idle";
      prevState = snap.value;
      if (leaving) {
        hoverRef.current = null;
        nearOriginRef.current = false;
        snapPreviewRef.current = null;
        snapTargetsRef.current = [];
        return;
      }
      if (!entering) return;
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      const pool: Cartesian3[] = [];
      for (const m of store.getState().measurements) {
        if (!m.geometry) continue;
        try {
          for (const p of geometryPositions(m.geometry)) pool.push(p);
        } catch {
          // Skip a malformed geometry rather than abort the whole draw.
        }
      }
      snapTargetsRef.current = liftPositions(viewer, pool);
    });
    return () => sub.unsubscribe();
  }, [actor, store, viewerRef]);

  useEffect(() => {
    if (!INTERACTION_V2 || !viewerReady) return;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const drafting = () => {
      const v = actor.getSnapshot().value;
      return v === "placing" || v === "calcReady";
    };

    // Origin (≥3 verts, ≤15 px) beats vertex snap (≤13 px) beats raw pick.
    const resolveSnap = (
      screenPos: Cartesian2
    ): { pos: Cartesian3; kind: "origin" | "vertex" } | null => {
      const pts = actor.getSnapshot().context.draft as Cartesian3[];
      if (pts.length >= 3) {
        const p0 = viewer.scene.cartesianToCanvasCoordinates(pts[0]);
        if (p0 && Math.hypot(screenPos.x - p0.x, screenPos.y - p0.y) <= ORIGIN_SNAP_PX) {
          return { pos: pts[0], kind: "origin" };
        }
      }
      let best: Cartesian3 | null = null;
      let bestD = VERTEX_SNAP_PX;
      const consider = (c: Cartesian3) => {
        const sc = viewer.scene.cartesianToCanvasCoordinates(c);
        if (!sc) return;
        const d = Math.hypot(screenPos.x - sc.x, screenPos.y - sc.y);
        if (d <= bestD) {
          bestD = d;
          best = c;
        }
      };
      for (const c of snapTargetsRef.current) consider(c);
      for (let i = 0; i < pts.length - 1; i++) consider(pts[i]);
      return best ? { pos: best, kind: "vertex" } : null;
    };

    const clearHover = () => {
      hoverRef.current = null;
      nearOriginRef.current = false;
      snapPreviewRef.current = null;
    };

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      if (actor.getSnapshot().value !== "placing") return;
      const snap = resolveSnap(event.position);
      if (snap?.kind === "origin") {
        clearHover();
        actor.send({ type: "MAP_CLICK", position: snap.pos, nearOrigin: true });
        viewer.scene.requestRender();
        return;
      }
      const pos = snap?.pos ?? pickScenePosition(viewer, event.position);
      if (!pos) return;
      const draft = actor.getSnapshot().context.draft as Cartesian3[];
      const previous = draft[draft.length - 1];
      if (previous && Cartesian3.distance(previous, pos) < DEDUPE_METERS) return;
      hoverRef.current = null;
      snapPreviewRef.current = null;
      actor.send({ type: "MAP_CLICK", position: pos });
      viewer.scene.requestRender();
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
      if (actor.getSnapshot().value !== "placing") return;
      // Magnetize the hover onto the snap target so the preview visibly locks
      // on and the halo invites the click; else follow the terrain pick.
      const snap = resolveSnap(movement.endPosition);
      nearOriginRef.current = snap?.kind === "origin";
      snapPreviewRef.current = snap?.kind === "vertex" ? snap.pos : null;
      const hover = snap?.pos ?? pickScenePosition(viewer, movement.endPosition);
      hoverRef.current = hover;
      const now = performance.now();
      if (now - hoverThrottleRef.current > HOVER_THROTTLE_MS) {
        hoverThrottleRef.current = now;
        const draft = actor.getSnapshot().context.draft as Cartesian3[];
        store.getState().setDraft(draft, hover);
      }
      viewer.scene.requestRender();
    }, ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      if (!drafting()) return;
      // Feedback for a premature finish (below the geometry minimum): the
      // machine drops the RIGHT_CLICK with no transition, so the toast must
      // come from HERE (the bridge is entry-driven, can't react to a no-op).
      const ctx = actor.getSnapshot().context;
      if (ctx.draft.length > 0) {
        const min = ctx.primitive === "polygon" ? 3 : 2;
        if (ctx.draft.length < min) {
          toast.error(`Need at least ${min} points for a ${ctx.primitive ?? "shape"}`);
          return;
        }
      }
      clearHover();
      actor.send({ type: "RIGHT_CLICK" });
      viewer.scene.requestRender();
    }, ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction(() => {
      if (!drafting()) return;
      actor.send({ type: "DOUBLE_CLICK" });
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // NOTE: Esc is NOT handled here — the legacy useDrawInteraction key effect
    // (input-field-aware) calls actions.cancelDraw, which under the flag sends
    // CANCEL into the machine. One Esc path, no double-handling.

    return () => {
      handler.destroy();
    };
  }, [actor, store, viewerRef, viewerReady]);

  return useMemo(
    () => ({ hoverRef, nearOriginRef, snapPreviewRef }),
    []
  );
}
