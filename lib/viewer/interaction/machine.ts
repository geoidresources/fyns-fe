// The viewer interaction machine (plan §3) — THE single source of truth for
// draw/edit mode + draft geometry. Everything here is pure and Cesium-free:
// the adapter translates raw scene input into the events below, the renderer
// draws whatever the current snapshot says, and side effects live in exactly
// two places — the provided `commit` actor (save) and the store bridge that
// mirrors state for the panels. Every transition is unit-tested in
// __tests__/machine.test.ts; the P2 edit plane adds states, never flags.
//
// P1 scope: create plane only — idle / placing / calcReady / committing.
// Probe templates never enter the machine (legacy path); the edit plane
// (selected/editing) lands in P2 as new states on this same machine.

import { assign, fromPromise, setup } from "xstate";

import type { Primitive, Snapshot, Vec3 } from "./types.ts";
import { snapshotOf } from "./types.ts";
import type { MeasureTemplate, TemplateId } from "./templates.ts";
import { templateById } from "./templates.ts";
import { hasSelfIntersection } from "./validity.ts";

// ------------------------------------------------------------------ context

export interface InteractionCtx {
  /** Armed template while placing (drives toolbar lit state + commit kind). */
  template: MeasureTemplate | null;
  /** Geometry primitive being placed. Line→polygon close-out RETYPES this. */
  primitive: Primitive | null;
  /** The draft vertices — replaces draftPositionsRef. */
  draft: Vec3[];
  /** An erase opened the ring (P2); serialized draws are never open. */
  ringOpen: boolean;
  /** Set → commit PATCHes this measurement instead of creating (P2). */
  measurementId: string | null;
  /** Snapshot undo/redo — one entry per MUTATION, restored whole (ledger #3). */
  history: Snapshot[];
  future: Snapshot[];
  /** "create" (placing a new shape) vs "edit" (reshaping an existing one) —
   * drives commit routing (PATCH vs POST rides on measurementId) AND where a
   * failed commit returns (editing.ready vs calcReady). */
  origin: "create" | "edit";
  /** Index of the vertex being dragged in the edit plane, else null. */
  grabbedIndex: number | null;
  /** The highlighted vertices in the edit plane (multi-select, P2 Phase-2) —
   * the targets of DELETE_VERTEX and of a batch drag. Single-click selection
   * is simply a one-element array. */
  selectedVertices: number[];
}

const emptyCtx: InteractionCtx = {
  template: null,
  primitive: null,
  draft: [],
  ringOpen: false,
  measurementId: null,
  history: [],
  future: [],
  origin: "create",
  grabbedIndex: null,
  selectedVertices: [],
};

// ------------------------------------------------------------------- events

export type InteractionEvent =
  | { type: "TEMPLATE_PICKED"; templateId: TemplateId }
  | { type: "MAP_CLICK"; position: Vec3; nearOrigin?: boolean }
  | { type: "RIGHT_CLICK" }
  | { type: "DOUBLE_CLICK" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "ESC" }
  // Programmatic cancel — actions.cancelDraw parity (panel close buttons etc.).
  | { type: "CANCEL" }
  // --- edit plane (P2) ---
  // Enter the geometry editor on an existing measurement (from the inspector
  // "Edit shape", a handle grab, or a context menu). Geometry is seeded as
  // terrain-lifted Vec3s; primitive preserves the shape's type.
  | { type: "EDIT_SHAPE"; measurementId: string; geometry: Vec3[]; primitive: Primitive }
  // Redraw: place a FRESH outline that REPLACES an existing measurement — the
  // create plane (placing → calcReady) but with measurementId set so commit
  // PATCHes. origin stays "create" so a failed commit returns to calcReady.
  | { type: "REDRAW_SHAPE"; measurementId: string; primitive: Primitive }
  | { type: "HANDLE_GRAB"; index: number }
  // Batch-aware drag frame: the ADAPTER computes every moved vertex (it owns
  // the Cartesian3 delta math) and the machine applies verbatim — keeps this
  // module Cesium-free while real Cartesian3 instances flow to the renderer.
  | { type: "HANDLE_MOVE"; updates: Array<{ index: number; position: Vec3 }> }
  | { type: "HANDLE_DROP" }
  // Highlight a vertex (click without drag) — the DELETE_VERTEX target.
  // `additive` (Shift+click) toggles the vertex in the multi-selection.
  | { type: "SELECT_VERTEX"; index: number; additive?: boolean }
  // Select every vertex of the draft (Ctrl/Cmd+A while editing).
  | { type: "SELECT_ALL_VERTICES" }
  // Insert a vertex on an edge (click its midpoint ghost).
  | { type: "INSERT_VERTEX"; edgeIndex: number; position: Vec3 }
  // Remove the selected vertex — the ring stays closed and re-routes.
  | { type: "DELETE_VERTEX" }
  // Erase an edge — OPENS the polygon ring at that edge (P2b-2). The chain is
  // rotated so the gap sits at the end; subsequent MAP_CLICKs append into it.
  | { type: "DELETE_EDGE"; edgeIndex: number }
  // Commit the current edit (Enter / double-click) → PATCH + recompute.
  | { type: "COMMIT" };

// ------------------------------------------------------------------- commit

/** Input handed to the provided `commit` actor. The impl (ViewerCanvas) owns
 * kind resolution, params, POST/PATCH, selection, recompute — machine only
 * hands over geometry + intent. */
export interface CommitInput {
  draft: Vec3[];
  primitive: Primitive;
  template: MeasureTemplate | null;
  measurementId: string | null;
  ringOpen: boolean;
}

export interface CommitResult {
  id: string;
}

// ------------------------------------------------------------------ machine

export const interactionMachine = setup({
  types: {
    context: {} as InteractionCtx,
    events: {} as InteractionEvent,
  },
  actors: {
    // Placeholder — ViewerCanvas provides the real save via machine.provide();
    // tests provide fakes. Reaching committing without one is a programmer error.
    commit: fromPromise<CommitResult, CommitInput>(async () => {
      throw new Error("interactionMachine: no `commit` actor provided");
    }),
  },
  guards: {
    isDrawTemplate: ({ event }) => {
      if (event.type !== "TEMPLATE_PICKED") return false;
      return templateById(event.templateId)?.primitive != null;
    },
    isSameTemplate: ({ context, event }) =>
      event.type === "TEMPLATE_PICKED" && context.template?.id === event.templateId,
    draftEmpty: ({ context }) => context.draft.length === 0,
    /** Free tool switch: empty draft AND a real DRAW template. Guards against
     * arming a probe (primitive:null) mid-session — which would build a draft
     * with no primitive and commit via the "polyline" fallback (QA G2). */
    isEmptyDrawSwitch: ({ context, event }) =>
      context.draft.length === 0 &&
      event.type === "TEMPLATE_PICKED" &&
      templateById(event.templateId)?.primitive != null,
    /** Origin click with enough vertices closes the ring (checklist C5). */
    closesRing: ({ context, event }) =>
      event.type === "MAP_CLICK" && event.nearOrigin === true && context.draft.length >= 3,
    hasMinPoints: ({ context }) =>
      context.draft.length >= (context.primitive === "polygon" ? 3 : 2),
    canUndo: ({ context }) => context.history.length > 0,
    canRedo: ({ context }) => context.future.length > 0,
    isEditOrigin: ({ context }) => context.origin === "edit",
    /** At least one vertex is selected AND removing them ALL keeps the shape at
     * or above its minimum (3 for a polygon, 2 for a line) — else the delete is
     * dropped (the adapter toasts). */
    canDeleteVertex: ({ context }) =>
      context.selectedVertices.length > 0 &&
      context.draft.length - context.selectedVertices.length >=
        (context.primitive === "polygon" ? 3 : 2),
    /** The polygon ring is currently open (an edge was erased) — MAP_CLICK then
     * appends into the gap instead of hit-testing handles/ghosts. */
    ringIsOpen: ({ context }) => context.ringOpen === true,
    /** Clicking the open chain's start vertex while the ring is open re-closes
     * it (mirror of `closesRing` on the create plane). */
    closesGap: ({ context, event }) =>
      event.type === "MAP_CLICK" &&
      event.nearOrigin === true &&
      context.ringOpen === true &&
      context.draft.length >= 3,
    /** Only a still-closed polygon with room to spare can have an edge erased —
     * a line has no ring, and re-opening an open ring is a no-op. */
    canDeleteEdge: ({ context }) =>
      context.primitive === "polygon" && !context.ringOpen && context.draft.length >= 3,
    /** The draft, closed the way commit will serialize it (polygons re-close),
     * has no crossing edges. Blocks the commit; the adapter toasts (parity with
     * hasMinPoints — the machine stays silent, the bridge can't react to no-ops). */
    noSelfIntersection: ({ context }) =>
      !hasSelfIntersection(context.draft, context.primitive === "polygon"),
  },
  actions: {
    arm: assign(({ event }) => {
      if (event.type !== "TEMPLATE_PICKED") return {};
      const template = templateById(event.templateId) ?? null;
      return {
        ...emptyCtx,
        template,
        primitive: template?.primitive ?? null,
      };
    }),
    /** Record the pre-mutation snapshot, then append the clicked vertex. */
    snapshotAppend: assign(({ context, event }) => {
      if (event.type !== "MAP_CLICK") return {};
      return {
        history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
        future: [],
        draft: [...context.draft, event.position],
      };
    }),
    /** Origin click on a polyline draft re-types it to a polygon (C5) — the
     * vertices stay; serialization closes the ring at commit. */
    becomePolygon: assign({ primitive: "polygon" as Primitive }),
    undo: assign(({ context }) => {
      const prev = context.history[context.history.length - 1];
      if (!prev) return {};
      return {
        history: context.history.slice(0, -1),
        future: [...context.future, snapshotOf(context.draft, context.ringOpen)],
        draft: prev.draft,
        ringOpen: prev.ringOpen,
        // The restored draft can be SHORTER — drop selection indices that no
        // longer exist so a stale index can't ghost-highlight or ghost-delete.
        selectedVertices: context.selectedVertices.filter((i) => i < prev.draft.length),
      };
    }),
    redo: assign(({ context }) => {
      const next = context.future[context.future.length - 1];
      if (!next) return {};
      return {
        future: context.future.slice(0, -1),
        history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
        draft: next.draft,
        ringOpen: next.ringOpen,
        selectedVertices: context.selectedVertices.filter((i) => i < next.draft.length),
      };
    }),
    clear: assign(() => ({ ...emptyCtx })),

    // --- edit plane (P2) ---
    /** Seed the editor from an existing measurement. origin="edit" so commit
     * PATCHes and a failed commit returns to editing. */
    enterEdit: assign(({ event }) => {
      if (event.type !== "EDIT_SHAPE") return {};
      return {
        ...emptyCtx,
        origin: "edit" as const,
        measurementId: event.measurementId,
        primitive: event.primitive,
        draft: [...event.geometry],
      };
    }),
    /** Seed a REDRAW: empty draft on the create plane, but measurementId set so
     * commit PATCHes the existing row. origin stays "create" (emptyCtx default)
     * so a failed commit returns to calcReady, not the edit plane. */
    enterRedraw: assign(({ event }) => {
      if (event.type !== "REDRAW_SHAPE") return {};
      return {
        ...emptyCtx,
        measurementId: event.measurementId,
        primitive: event.primitive,
      };
    }),
    /** Snapshot before a drag begins (undo reverts the whole move, ledger #3).
     * Grabbing a vertex INSIDE the multi-selection keeps it (the whole group
     * drags together); grabbing outside collapses the selection to that vertex. */
    grabHandle: assign(({ context, event }) => {
      if (event.type !== "HANDLE_GRAB") return {};
      return {
        history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
        future: [],
        grabbedIndex: event.index,
        selectedVertices: context.selectedVertices.includes(event.index)
          ? context.selectedVertices
          : [event.index],
      };
    }),
    /** Apply a drag frame verbatim (new array; the outline callback follows).
     * The adapter sends every moved vertex — one entry for a solo drag, the
     * whole selection (same delta) for a batch drag. */
    moveGrabbed: assign(({ context, event }) => {
      if (event.type !== "HANDLE_MOVE" || context.grabbedIndex === null) return {};
      const next = [...context.draft];
      for (const u of event.updates) {
        if (u.index >= 0 && u.index < next.length) next[u.index] = u.position;
      }
      return { draft: next };
    }),
    dropHandle: assign({ grabbedIndex: null }),
    /** Click selects; Shift+click (additive) TOGGLES membership in the group. */
    selectVertex: assign(({ context, event }) => {
      if (event.type !== "SELECT_VERTEX") return {};
      if (!event.additive) return { selectedVertices: [event.index] };
      return {
        selectedVertices: context.selectedVertices.includes(event.index)
          ? context.selectedVertices.filter((i) => i !== event.index)
          : [...context.selectedVertices, event.index],
      };
    }),
    selectAllVertices: assign(({ context }) => ({
      selectedVertices: context.draft.map((_, i) => i),
    })),
    /** Insert on an edge: splice the new vertex AFTER edgeIndex; the closing
     * edge of a ring (edgeIndex n-1) appends. The inserted vertex is selected. */
    insertVertex: assign(({ context, event }) => {
      if (event.type !== "INSERT_VERTEX") return {};
      const at = event.edgeIndex + 1;
      const next = [...context.draft.slice(0, at), event.position, ...context.draft.slice(at)];
      return {
        history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
        future: [],
        draft: next,
        selectedVertices: [at],
      };
    }),
    /** Remove EVERY selected vertex — the ring re-routes across the survivors
     * and stays CLOSED (distinct from edge-erase, which opens the ring). */
    deleteVertex: assign(({ context }) => {
      if (context.selectedVertices.length === 0) return {};
      const doomed = new Set(context.selectedVertices);
      return {
        history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
        future: [],
        draft: context.draft.filter((_, i) => !doomed.has(i)),
        selectedVertices: [],
      };
    }),
    /** Erase edge k (between vk and v_{k+1}): OPEN the ring and rotate the chain
     * so it runs v_{k+1} → … → vk, putting the gap at the end. Appends then land
     * where the edge was. Erasing the closing edge (k = n-1) leaves order intact. */
    deleteEdge: assign(({ context, event }) => {
      if (event.type !== "DELETE_EDGE") return {};
      const k = event.edgeIndex;
      const d = context.draft;
      const rotated = [...d.slice(k + 1), ...d.slice(0, k + 1)];
      return {
        history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
        future: [],
        draft: rotated,
        ringOpen: true,
        selectedVertices: [],
      };
    }),
    /** Re-close an opened ring (clicked the start vertex) — no vertex added. */
    closeGap: assign(({ context }) => ({
      history: [...context.history, snapshotOf(context.draft, context.ringOpen)],
      future: [],
      ringOpen: false,
    })),
  },
}).createMachine({
  id: "interaction",
  context: emptyCtx,
  initial: "idle",
  states: {
    idle: {
      on: {
        TEMPLATE_PICKED: { guard: "isDrawTemplate", target: "placing", actions: "arm" },
        EDIT_SHAPE: { target: "editing", actions: "enterEdit" },
        REDRAW_SHAPE: { target: "placing", actions: "enterRedraw" },
      },
    },

    // Sticky create tool: clicks append vertices until the draw is released
    // for calc (right-click / origin close) or discarded (Esc / toggle-off).
    placing: {
      on: {
        MAP_CLICK: [
          { guard: "closesRing", target: "calcReady", actions: "becomePolygon" },
          { actions: "snapshotAppend" },
        ],
        RIGHT_CLICK: [
          { guard: "draftEmpty", target: "idle", actions: "clear" },
          { guard: "hasMinPoints", target: "calcReady" },
          // Below the minimum: no transition. The ADAPTER checks hasMinPoints
          // before sending and toasts "need N points" (the bridge is entry-
          // driven and can't react to a no-op event) — see useInteractionAdapter.
        ],
        UNDO: { guard: "canUndo", actions: "undo" },
        REDO: { guard: "canRedo", actions: "redo" },
        TEMPLATE_PICKED: [
          // Re-click the armed tool → cancel (C10).
          { guard: "isSameTemplate", target: "idle", actions: "clear" },
          // Empty draft + a real draw template → switch tools freely.
          { guard: "isEmptyDrawSwitch", actions: "arm" },
          // Non-empty draft (ledger #1) or a probe: BLOCKED — no silent discard,
          // no primitive-null arm. The toolbar surfaces the toast.
        ],
        ESC: { target: "idle", actions: "clear" },
        CANCEL: { target: "idle", actions: "clear" },
      },
    },

    // Vertex placement locked; the calc panel drives; double-click commits.
    calcReady: {
      on: {
        DOUBLE_CLICK: { guard: "noSelfIntersection", target: "committing" },
        UNDO: { guard: "canUndo", actions: "undo" },
        REDO: { guard: "canRedo", actions: "redo" },
        TEMPLATE_PICKED: [
          { guard: "isSameTemplate", target: "idle", actions: "clear" },
          // Different tool with a live draft: blocked, same as placing.
        ],
        ESC: { target: "idle", actions: "clear" },
        CANCEL: { target: "idle", actions: "clear" },
      },
    },

    // Editing an EXISTING measurement's geometry. `ready` shows draggable
    // handles; `dragging` follows one. Commit PATCHes (measurementId set);
    // cancel discards the draft — the bridge unhides the untouched measurement.
    editing: {
      initial: "ready",
      states: {
        ready: {
          on: {
            HANDLE_GRAB: { target: "dragging", actions: "grabHandle" },
            SELECT_VERTEX: { actions: "selectVertex" },
            SELECT_ALL_VERTICES: { actions: "selectAllVertices" },
            INSERT_VERTEX: { actions: "insertVertex" },
            DELETE_VERTEX: { guard: "canDeleteVertex", actions: "deleteVertex" },
            DELETE_EDGE: { guard: "canDeleteEdge", actions: "deleteEdge" },
            // Ring open (an edge was erased): a click re-closes it at the start
            // vertex, else appends a vertex into the gap. When closed, clicks
            // hit-test handles/ghosts in the adapter (no MAP_CLICK is sent).
            MAP_CLICK: [
              { guard: "closesGap", actions: "closeGap" },
              { guard: "ringIsOpen", actions: "snapshotAppend" },
            ],
            COMMIT: { guard: "noSelfIntersection", target: "#interaction.committing" },
            DOUBLE_CLICK: { guard: "noSelfIntersection", target: "#interaction.committing" },
            UNDO: { guard: "canUndo", actions: "undo" },
            REDO: { guard: "canRedo", actions: "redo" },
          },
        },
        dragging: {
          on: {
            HANDLE_MOVE: { actions: "moveGrabbed" },
            HANDLE_DROP: { target: "ready", actions: "dropHandle" },
          },
        },
      },
      on: {
        // Cancel from anywhere in editing (even mid-drag) — discard the draft.
        ESC: { target: "idle", actions: "clear" },
        CANCEL: { target: "idle", actions: "clear" },
      },
    },

    committing: {
      invoke: {
        src: "commit",
        input: ({ context }): CommitInput => ({
          draft: context.draft,
          primitive: context.primitive ?? "polyline",
          template: context.template,
          measurementId: context.measurementId,
          ringOpen: context.ringOpen,
        }),
        // Commit impl owns store/side effects (select row, recompute, toasts).
        onDone: { target: "idle", actions: "clear" },
        // Failure (network, CalcParamsError): keep the draft — user retries from
        // whichever plane they were in (editing.ready vs calcReady).
        onError: [
          { guard: "isEditOrigin", target: "editing" },
          { target: "calcReady" },
        ],
      },
    },
  },
});

export type InteractionMachine = typeof interactionMachine;
