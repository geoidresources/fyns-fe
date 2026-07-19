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
}

const emptyCtx: InteractionCtx = {
  template: null,
  primitive: null,
  draft: [],
  ringOpen: false,
  measurementId: null,
  history: [],
  future: [],
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
  | { type: "CANCEL" };

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
      };
    }),
    clear: assign(() => ({ ...emptyCtx })),
  },
}).createMachine({
  id: "interaction",
  context: emptyCtx,
  initial: "idle",
  states: {
    idle: {
      on: {
        TEMPLATE_PICKED: { guard: "isDrawTemplate", target: "placing", actions: "arm" },
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
        DOUBLE_CLICK: "committing",
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
        // Failure (network, CalcParamsError): keep the draft — user retries.
        onError: { target: "calcReady" },
      },
    },
  },
});

export type InteractionMachine = typeof interactionMachine;
