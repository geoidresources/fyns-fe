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
  let prev: StateValue = actor.getSnapshot().value;
  let prevDraft: unknown = actor.getSnapshot().context.draft;

  const sub = actor.subscribe((snap) => {
    const value = snap.value;
    const ctx = snap.context;
    const entered = value !== prev;

    if (entered) {
      if (value === "placing") {
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
        if (prev === "idle") {
          const s = store.getState();
          s.clearSelection();
          s.openDetail("measure");
        }
      } else if (value === "calcReady") {
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
      } else if (value === "committing") {
        store.getState().cancelDraw();
      } else if (value === "idle") {
        if (prev === "placing" || prev === "calcReady") {
          const s = store.getState();
          const hadDraft = ctxHadDraft(prevDraft);
          s.cancelDraw();
          s.closeDetail();
          s.clearSelection();
          if (hadDraft) toast.info("Drawing discarded");
        }
        // From committing: the commit impl owns selection/panels — hands off.
      }
    }

    // Draft mirror for the live readout (panel Area/Perimeter/Vertices).
    if (ctx.draft !== prevDraft && (value === "placing" || value === "calcReady")) {
      store.getState().setDraft(ctx.draft as Cartesian3[], null);
    }
    prevDraft = ctx.draft;
    prev = value;
  });

  return () => sub.unsubscribe();
}

const ctxHadDraft = (draft: unknown): boolean =>
  Array.isArray(draft) && draft.length > 0;
