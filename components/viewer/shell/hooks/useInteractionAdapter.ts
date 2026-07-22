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
  Entity,
  KeyboardEventModifier,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer as CesiumViewer,
} from "cesium";
import type { ActorRefFrom } from "xstate";
import type { StoreApi } from "zustand/vanilla";
import { toast } from "sonner";

import { INTERACTION_V2 } from "@/lib/viewer/interaction/flag";
import type { interactionMachine } from "@/lib/viewer/interaction/machine";
import { hasSelfIntersection } from "@/lib/viewer/interaction/validity";
import { geometryPositions, pickScenePosition } from "@/lib/viewer/measure";
import type { ViewerShellState } from "@/lib/viewer/state/store";
import type { SelectionSeed } from "./useSelectionHandles";

// Same values as the legacy module constants in ViewerCanvas (P3 consolidates).
const ORIGIN_SNAP_PX = 15;
const VERTEX_SNAP_PX = 13;
const EDGE_PICK_PX = 10; // right-click within this of an edge erases it (opens the ring)
const HOVER_THROTTLE_MS = 100;
const DEDUPE_METERS = 0.01;

/** Shortest distance (px) from point p to segment a–b, all in screen space. */
function pointToSegmentPx(p: Cartesian2, a: Cartesian2, b: Cartesian2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

type InteractionActor = ActorRefFrom<typeof interactionMachine>;

/** Window-level `Enter` is shared with useViewerHotkeys — the first handler to
 * act stamps the event so the other ignores it (registration order varies). */
export type ClaimedKeyEvent = KeyboardEvent & { __geoidEnterClaimed?: boolean };

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
  store: StoreApi<ViewerShellState>,
  /** The edit handles the renderer exposes (vertex order) — GPU-picked here to
   * resolve a grab → its index. */
  handleEntitiesRef: RefObject<Entity[]>,
  /** The midpoint ghosts the renderer exposes (edge order) — GPU-picked here to
   * resolve an insert-on-edge click. */
  ghostEntitiesRef: RefObject<Entity[]>,
  /** Selection-overlay handles for a selected (not-yet-editing) measurement —
   * grabbing one promotes into an edit (P2c-2b). Empty when no overlay is shown. */
  selectionHandlesRef: RefObject<Entity[]>,
  /** The edit seed for the overlaid measurement (same lifted geometry as its
   * handles), else null — sent as EDIT_SHAPE when a selection handle is grabbed. */
  selectionSeedRef: RefObject<SelectionSeed | null>
): AdapterRefs {
  const hoverRef = useRef<Cartesian3 | null>(null);
  const nearOriginRef = useRef(false);
  const snapPreviewRef = useRef<Cartesian3 | null>(null);
  const snapTargetsRef = useRef<Cartesian3[]>([]);
  const hoverThrottleRef = useRef(0);
  // Hold-Alt transiently suspends vertex snapping (layer-1 override, §04).
  const altSuspendRef = useRef(false);

  // Session lifecycle: build the snap pool when a draw starts (idle → placing,
  // mirroring legacy startDraw's snapshot semantics) and clear the hover refs
  // when the session ends — a stale hover would ghost into the NEXT session's
  // preview before its first mousemove.
  useEffect(() => {
    if (!INTERACTION_V2) return;
    const wasDragging = (val: unknown) =>
      typeof val === "object" && val !== null && (val as { editing?: string }).editing === "dragging";
    let prevState = actor.getSnapshot().value;
    const sub = actor.subscribe((snap) => {
      const entering = snap.value === "placing" && prevState === "idle";
      const leaving = snap.value === "idle" && prevState !== "idle";
      // A cancel/ESC mid-drag jumps dragging → idle without a LEFT_UP, so the
      // camera lock (set on grab) must be released here too.
      if (wasDragging(prevState) && !wasDragging(snap.value)) {
        const v = viewerRef.current;
        if (v && !v.isDestroyed()) v.scene.screenSpaceCameraController.enableInputs = true;
      }
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
      const { measurements, measurementVisibility } = store.getState();
      for (const m of measurements) {
        if (!m.geometry) continue;
        // Only snap to measurements actually shown on the canvas. Visibility is
        // hidden-by-default (=== true, matching isMeasurementVisibleOnCanvas /
        // the renderer) until a tree row or eye toggle turns it on — a hidden
        // measurement has no rendered vertex, so snapping to it would magnetize
        // the cursor onto invisible points (erratic "snap not working").
        if (measurementVisibility[m.id] !== true) continue;
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
      // Vertex snapping honors the layer-2 toggle (S / toolbar chip) and the
      // layer-1 hold-Alt suspend. Origin-close above is a GESTURE (how a ring
      // closes), not snapping — it stays live regardless.
      if (!store.getState().snapEnabled || altSuspendRef.current) return null;
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

    // Machine state helpers for the edit plane.
    const editSubstate = (): "ready" | "dragging" | null => {
      const val = actor.getSnapshot().value;
      if (typeof val === "object" && val !== null && "editing" in val) {
        return (val as { editing: "ready" | "dragging" }).editing;
      }
      return null;
    };

    // Which edit handle is under `screenPos`? GPU pick (drillPick sees through
    // overlapping halos) against the renderer's handle entities → its index;
    // fall back to projecting the draft when the pick buffer is empty (headless)
    // — the terrain-height-safe pattern (memory: fyns-fe-draft-terrain-height).
    const pickHandleIndex = (screenPos: Cartesian2): number | null => {
      const handles = handleEntitiesRef.current;
      const picks = viewer.scene.drillPick(screenPos, 6);
      for (const p of picks) {
        const idx = p?.id ? handles.indexOf(p.id) : -1;
        if (idx >= 0) return idx;
      }
      const pts = actor.getSnapshot().context.draft as Cartesian3[];
      let best = -1;
      let bestD = VERTEX_SNAP_PX + 3; // handles render fatter than snap radius
      for (let i = 0; i < pts.length; i++) {
        const sc = viewer.scene.cartesianToCanvasCoordinates(pts[i]);
        if (!sc) continue;
        const d = Math.hypot(screenPos.x - sc.x, screenPos.y - sc.y);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 ? best : null;
    };

    // Which midpoint ghost (edge) is under `screenPos`? GPU pick, then project
    // each edge midpoint as the fallback. Returns the EDGE index.
    const pickGhostIndex = (screenPos: Cartesian2): number | null => {
      const ghosts = ghostEntitiesRef.current;
      const picks = viewer.scene.drillPick(screenPos, 6);
      for (const p of picks) {
        const idx = p?.id ? ghosts.indexOf(p.id) : -1;
        if (idx >= 0) return idx;
      }
      const pts = actor.getSnapshot().context.draft as Cartesian3[];
      const closed =
        actor.getSnapshot().context.primitive === "polygon" && !actor.getSnapshot().context.ringOpen;
      const edgeCount = closed ? pts.length : pts.length - 1;
      let best = -1;
      let bestD = VERTEX_SNAP_PX;
      for (let i = 0; i < edgeCount; i++) {
        const mid = Cartesian3.midpoint(pts[i], pts[(i + 1) % pts.length], new Cartesian3());
        const sc = viewer.scene.cartesianToCanvasCoordinates(mid);
        if (!sc) continue;
        const d = Math.hypot(screenPos.x - sc.x, screenPos.y - sc.y);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 ? best : null;
    };

    // Which EDGE segment is under `screenPos` (point-to-segment distance, so the
    // whole edge is a target, not just its midpoint)? Right-click one to erase it
    // and OPEN the ring. Returns the edge index. Projection-only — no GPU pick,
    // so it works headless (memory: fyns-fe-checkpoint-render-recipe).
    const pickEdgeIndex = (screenPos: Cartesian2): number | null => {
      const ctx = actor.getSnapshot().context;
      const pts = ctx.draft as Cartesian3[];
      const closed = ctx.primitive === "polygon" && !ctx.ringOpen;
      const edgeCount = closed ? pts.length : pts.length - 1;
      let best = -1;
      let bestD = EDGE_PICK_PX;
      for (let i = 0; i < edgeCount; i++) {
        const a = viewer.scene.cartesianToCanvasCoordinates(pts[i]);
        const b = viewer.scene.cartesianToCanvasCoordinates(pts[(i + 1) % pts.length]);
        if (!a || !b) continue;
        const d = pointToSegmentPx(screenPos, a, b);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 ? best : null;
    };

    // Ring open + cursor within the origin radius of the chain's START vertex:
    // clicking here RE-CLOSES the ring (mirror of the create-plane origin close).
    // Takes priority over grabbing/selecting that vertex's handle so a close
    // click never becomes a drag or a selection.
    const isCloseGapClick = (screenPos: Cartesian2): boolean => {
      const ctx = actor.getSnapshot().context;
      if (!ctx.ringOpen) return false;
      const pts = ctx.draft as Cartesian3[];
      if (pts.length < 3) return false;
      const p0 = viewer.scene.cartesianToCanvasCoordinates(pts[0]);
      return !!p0 && Math.hypot(screenPos.x - p0.x, screenPos.y - p0.y) <= ORIGIN_SNAP_PX;
    };

    // Shared finish path (double-click, Enter, Done button): a self-intersecting
    // shape can't be saved — the machine's noSelfIntersection guard drops the
    // commit silently, so the toast comes from HERE (min-points parity). Closed
    // the way commit serializes it: polygons re-close, lines stay open.
    const finishWithGuard = (finishEvent: "COMMIT" | "DOUBLE_CLICK"): void => {
      const ctx = actor.getSnapshot().context;
      if (hasSelfIntersection(ctx.draft, ctx.primitive === "polygon")) {
        toast.error("Shape can't cross itself — fix the crossing to save");
        return;
      }
      actor.send({ type: finishEvent });
    };

    // Which SELECTION-overlay handle (on a selected, not-yet-editing measurement)
    // is under `screenPos`? GPU pick against the overlay entities, then project
    // the seed geometry as the headless fallback. Grabbing one promotes to edit.
    const pickSelectionHandleIndex = (screenPos: Cartesian2): number | null => {
      const seed = selectionSeedRef.current;
      if (!seed) return null;
      const overlay = selectionHandlesRef.current;
      const picks = viewer.scene.drillPick(screenPos, 6);
      for (const p of picks) {
        const idx = p?.id ? overlay.indexOf(p.id) : -1;
        if (idx >= 0) return idx;
      }
      let best = -1;
      let bestD = VERTEX_SNAP_PX + 3;
      for (let i = 0; i < seed.geometry.length; i++) {
        const sc = viewer.scene.cartesianToCanvasCoordinates(seed.geometry[i]);
        if (!sc) continue;
        const d = Math.hypot(screenPos.x - sc.x, screenPos.y - sc.y);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 ? best : null;
    };

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    // --- edit plane: grab / drag / drop a vertex handle ---
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      // Idle + a selection-overlay handle grabbed → PROMOTE to edit: seed the
      // machine from the selected measurement (same lifted geometry as the
      // overlay), then grab that vertex. One motion: select → reshape.
      if (actor.getSnapshot().value === "idle") {
        const seed = selectionSeedRef.current;
        if (!seed) return;
        const idx = pickSelectionHandleIndex(event.position);
        if (idx === null) return;
        actor.send({
          type: "EDIT_SHAPE",
          measurementId: seed.measurementId,
          geometry: seed.geometry,
          primitive: seed.primitive,
        });
        actor.send({ type: "HANDLE_GRAB", index: idx });
        viewer.scene.screenSpaceCameraController.enableInputs = false;
        return;
      }
      if (editSubstate() !== "ready") return;
      // A close-the-ring click on the start vertex must stay a click, not a grab.
      if (isCloseGapClick(event.position)) return;
      const idx = pickHandleIndex(event.position);
      if (idx === null) return;
      actor.send({ type: "HANDLE_GRAB", index: idx });
      viewer.scene.screenSpaceCameraController.enableInputs = false; // don't spin
    }, ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction(() => {
      if (editSubstate() !== "dragging") return;
      actor.send({ type: "HANDLE_DROP" });
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      viewer.scene.requestRender();
    }, ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      // Edit plane click (no drag occurred): a midpoint ghost inserts a vertex
      // on that edge; a vertex handle selects it (the Delete target).
      if (editSubstate() === "ready") {
        // Ring open + click on the START vertex → re-close the ring (checked
        // before the handle pick, which sits on the same spot).
        if (isCloseGapClick(event.position)) {
          const pts = actor.getSnapshot().context.draft as Cartesian3[];
          actor.send({ type: "MAP_CLICK", position: pts[0], nearOrigin: true });
          viewer.scene.requestRender();
          return;
        }
        const gi = pickGhostIndex(event.position);
        if (gi !== null) {
          const pts = actor.getSnapshot().context.draft as Cartesian3[];
          const mid = Cartesian3.midpoint(pts[gi], pts[(gi + 1) % pts.length], new Cartesian3());
          actor.send({ type: "INSERT_VERTEX", edgeIndex: gi, position: mid });
          viewer.scene.requestRender();
          return;
        }
        const vi = pickHandleIndex(event.position);
        if (vi !== null) {
          actor.send({ type: "SELECT_VERTEX", index: vi });
          viewer.scene.requestRender();
          return;
        }
        // Ring open (an edge was erased): an empty-space click appends a vertex
        // into the gap. When the ring is closed, an empty click does nothing
        // (handles/ghosts are the only edit targets).
        if (actor.getSnapshot().context.ringOpen) {
          const pos = pickScenePosition(viewer, event.position);
          if (pos) {
            actor.send({ type: "MAP_CLICK", position: pos });
            viewer.scene.requestRender();
          }
        }
        return;
      }
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

    // Shift+click while editing: TOGGLE the clicked handle in the multi-
    // selection (Cesium routes modifier-held clicks to their own registration,
    // so this never collides with the plain-click insert/select/append path).
    handler.setInputAction(
      (event: ScreenSpaceEventHandler.PositionedEvent) => {
        if (editSubstate() !== "ready") return;
        const vi = pickHandleIndex(event.position);
        if (vi === null) return;
        actor.send({ type: "SELECT_VERTEX", index: vi, additive: true });
        viewer.scene.requestRender();
      },
      ScreenSpaceEventType.LEFT_CLICK,
      KeyboardEventModifier.SHIFT
    );

    handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
      // Edit plane: follow the grabbed handle across the terrain. When the
      // grabbed vertex is part of a MULTI-selection, the whole group rides the
      // same delta (rigid translation) — computed here, where Cartesian3 math
      // lives, and applied verbatim by the machine.
      if (editSubstate() === "dragging") {
        const pos = pickScenePosition(viewer, movement.endPosition);
        if (pos) {
          const ctx = actor.getSnapshot().context;
          const g = ctx.grabbedIndex;
          if (g === null) return;
          const draft = ctx.draft as Cartesian3[];
          const updates: Array<{ index: number; position: Cartesian3 }> = [
            { index: g, position: pos },
          ];
          if (ctx.selectedVertices.length > 1 && draft[g]) {
            const delta = Cartesian3.subtract(pos, draft[g], new Cartesian3());
            for (const i of ctx.selectedVertices) {
              if (i === g || !draft[i]) continue;
              updates.push({
                index: i,
                position: Cartesian3.add(draft[i], delta, new Cartesian3()),
              });
            }
          }
          actor.send({ type: "HANDLE_MOVE", updates });
          viewer.scene.requestRender();
        }
        return;
      }
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

    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      // Edit plane: right-click an edge to ERASE it (open the ring). The machine
      // guards line-vs-polygon and the already-open case; we only send on a hit.
      if (editSubstate() === "ready") {
        const ei = pickEdgeIndex(event.position);
        if (ei !== null) {
          actor.send({ type: "DELETE_EDGE", edgeIndex: ei });
          viewer.scene.requestRender();
        }
        return;
      }
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
      // Double-click commits in both planes (calcReady → save; editing → PATCH).
      if (!drafting() && editSubstate() === null) return;
      finishWithGuard("DOUBLE_CLICK");
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // NOTE: Esc is NOT handled here — the legacy useDrawInteraction key effect
    // (input-field-aware) calls actions.cancelDraw, which under the flag sends
    // CANCEL into the machine. One Esc path, no double-handling.

    // Keyboard finish/delete. Input-field-aware so typing a name never fires.
    //  - Delete/Backspace: remove the SELECTED vertex (editing only; guarded min).
    //  - Enter: commit — editing → COMMIT (PATCH), calcReady → the create finish.
    //    This is the primary commit path; double-click stays but its stray-click
    //    risk (insert on a ghost / append while open) is why Enter exists.
    const onKeyDown = (e: KeyboardEvent) => {
      // Alt suspend tracks regardless of focus — it only mutes snapping.
      if (e.key === "Alt") {
        altSuspendRef.current = true;
        snapPreviewRef.current = null; // drop the cyan halo immediately
        viewer.scene.requestRender();
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (editSubstate() === null) return;
        e.preventDefault();
        actor.send({ type: "DELETE_VERTEX" });
        viewer.scene.requestRender();
        return;
      }
      // Walk the vertex selection while editing: Tab / arrows step ±1 around
      // the ring (VS parity). Shift+Tab walks backward like ArrowLeft. Walking
      // always collapses to a SINGLE selection — it's a focus traversal.
      if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (editSubstate() !== "ready") return;
        const ctx = actor.getSnapshot().context;
        const n = ctx.draft.length;
        if (n === 0) return;
        e.preventDefault();
        const dir = e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
        const sel = ctx.selectedVertices;
        const from = sel.length > 0 ? sel[sel.length - 1] : dir === 1 ? -1 : 0;
        actor.send({ type: "SELECT_VERTEX", index: (from + dir + n) % n });
        viewer.scene.requestRender();
        return;
      }
      // Ctrl/Cmd+A while editing: select every vertex (batch move/delete).
      // preventDefault stops the browser's select-all.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (editSubstate() !== "ready") return;
        e.preventDefault();
        actor.send({ type: "SELECT_ALL_VERTICES" });
        viewer.scene.requestRender();
        return;
      }
      if (e.key === "Enter") {
        // One keypress, one meaning: the hotkeys hook and this handler share
        // window `Enter` and their registration ORDER is load-dependent (this
        // effect re-registers when viewerReady flips). Whichever acts first
        // claims the event so "Enter enters edit" can never cascade into an
        // instant COMMIT in the same dispatch.
        if ((e as ClaimedKeyEvent).__geoidEnterClaimed) return;
        if (editSubstate() === "ready") {
          e.preventDefault();
          (e as ClaimedKeyEvent).__geoidEnterClaimed = true;
          finishWithGuard("COMMIT");
        } else if (actor.getSnapshot().value === "calcReady") {
          e.preventDefault();
          (e as ClaimedKeyEvent).__geoidEnterClaimed = true;
          finishWithGuard("DOUBLE_CLICK");
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") altSuspendRef.current = false;
    };
    // Alt-Tab / window switches can eat the keyup — never leave snap stuck off.
    const onBlur = () => {
      altSuspendRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      handler.destroy();
      // A teardown mid-drag must hand the camera back.
      if (!viewer.isDestroyed()) {
        viewer.scene.screenSpaceCameraController.enableInputs = true;
      }
    };
  }, [actor, store, viewerRef, viewerReady, handleEntitiesRef, ghostEntitiesRef, selectionHandlesRef, selectionSeedRef]);

  return useMemo(
    () => ({ hoverRef, nearOriginRef, snapPreviewRef }),
    []
  );
}
