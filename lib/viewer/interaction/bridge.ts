// Store bridge (plan §P1): mirrors machine state into the LEGACY store fields
// (activeToolKey / drawMode / activeDrawOpts / draft) so every panel — calc
// panel, status bar, tree, inspector — keeps working unchanged during the
// migration. One-way: machine → store. P3 deletes the mirrored fields and
// points panels at the machine directly.
//
// Entry/exit side effects replicated from the legacy paths:
//  - enter placing (from idle):  clearSelection + openDetail("measure")   [startDraw]
//  - enter calcReady:            activeToolKey → null + openDetail        [releaseForCalc]
//  - enter committing:           store.cancelDraw() — legacy finish cleared
//                                the mirrors synchronously at double-click
//  - enter idle from placing/calcReady (Esc/cancel/toggle): cancelDraw +
//    closeDetail + clearSelection + "Drawing discarded" toast [cancelDraw]
//  - enter idle from committing: nothing — commit selected the created row;
//    clearing here would stomp the inspector it just opened.

import { toast } from "sonner";
import type { StoreApi } from "zustand/vanilla";
import type { Cartesian3 } from "cesium";
import type { ActorRefFrom, SnapshotFrom } from "xstate";

import type { ViewerShellState } from "@/lib/viewer/state/store";
import type { interactionMachine } from "./machine.ts";
import { toolKeyFor } from "./templates.ts";

type InteractionActor = ActorRefFrom<typeof interactionMachine>;
type StateValue = SnapshotFrom<typeof interactionMachine>["value"];

/** Attach the mirror; returns unsubscribe. Idempotent per attach. */
export function attachStoreBridge(
  actor: InteractionActor,
  store: StoreApi<ViewerShellState>
): () => void {
  // Compound-state safe: collapse {editing:"ready"|"dragging"} → "editing" so
  // ready↔dragging isn't seen as re-entering the plane.
  const topKey = (val: StateValue): string =>
    typeof val === "string" ? val : Object.keys(val)[0];

  let prevTop = topKey(actor.getSnapshot().value);
  let prevMeasurementId: string | null = actor.getSnapshot().context.measurementId;
  let prevDraft: unknown = actor.getSnapshot().context.draft;

  const sub = actor.subscribe((snap) => {
    const ctx = snap.context;
    const top = topKey(snap.value);
    const entered = top !== prevTop;

    if (entered) {
      if (top === "placing") {
        const template = ctx.template;
        store.setState({
          drawMode: ctx.primitive,
          activeToolKey: template ? toolKeyFor(template.id) : null,
          activeDrawOpts: template
            ? { ...(template.drawOpts ?? {}), toolKey: toolKeyFor(template.id) }
            : null,
          probing: false,
          probePoint: null,
        });
        if (prevTop === "idle") {
          const s = store.getState();
          s.clearSelection();
          s.openDetail("measure");
        }
      } else if (top === "editing") {
        // Reshape an existing measurement: hide its rendered geometry (the draft
        // handles replace it), mirror the type for the panel, keep the inspector
        // open. The Line tool lights as the "you're editing" indicator (parity).
        if (ctx.measurementId) store.getState().setMeasurementVisible(ctx.measurementId, false);
        store.setState({
          drawMode: ctx.primitive,
          activeToolKey: "palette:line",
          activeDrawOpts: null,
          probing: false,
          probePoint: null,
        });
        store.getState().setDraft(ctx.draft as Cartesian3[], null);
      } else if (top === "calcReady") {
        // Unclip the toolbar tool; RE-mirror drawMode — the origin close-out
        // may have just re-typed a polyline draft to polygon, and the calc
        // panel keys its options off drawMode (legacy releaseForCalc kept it).
        store.setState({ activeToolKey: null, drawMode: ctx.primitive });
        store.getState().openDetail("measure");
        // RESTORE the draft mirror. On a COMMIT FAILURE (committing → calcReady)
        // committing-entry ran store.cancelDraw() which zeroed draft.points; the
        // machine's draft array identity is unchanged across that round-trip, so
        // the mirror block below (guarded on identity change) won't fire. Without
        // this the calc panel reads "0 vertices / 0 m²" beside a visible, fully
        // retryable shape (frontend M1). Idempotent for the normal right-click
        // path (draft already mirrored).
        store.getState().setDraft(ctx.draft as Cartesian3[], null);
      } else if (top === "committing") {
        store.getState().cancelDraw();
      } else if (top === "idle") {
        if (prevTop === "placing" || prevTop === "calcReady") {
          const s = store.getState();
          const hadDraft = ctxHadDraft(prevDraft);
          s.cancelDraw();
          s.closeDetail();
          s.clearSelection();
          if (hadDraft) toast.info("Drawing discarded");
        } else if (prevTop === "editing") {
          // Edit CANCELLED (Esc): the measurement was never mutated — just
          // re-show it and drop the draft mirror. Stays selected + inspected.
          if (prevMeasurementId) store.getState().setMeasurementVisible(prevMeasurementId, true);
          store.setState({ drawMode: null, activeToolKey: null, activeDrawOpts: null });
          store.getState().setDraft([], null);
        }
        // From committing: the commit impl owns selection/panels — hands off.
      }
    }

    // Draft mirror for the live readout (panel Area/Perimeter/Vertices).
    if (ctx.draft !== prevDraft && (top === "placing" || top === "calcReady" || top === "editing")) {
      store.getState().setDraft(ctx.draft as Cartesian3[], null);
    }
    prevDraft = ctx.draft;
    // Retain the id across the exit tick so the idle branch can unhide it.
    prevMeasurementId = ctx.measurementId ?? prevMeasurementId;
    if (top === "idle") prevMeasurementId = null;
    prevTop = top;
  });

  return () => sub.unsubscribe();
}

const ctxHadDraft = (draft: unknown): boolean =>
  Array.isArray(draft) && draft.length > 0;
