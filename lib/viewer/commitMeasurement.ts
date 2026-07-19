// Commit a finished draft (interaction v2, plan §P1) — the machine's `commit`
// actor implementation. EXTRACTED from ViewerCanvas.finish() with identical
// semantics (checklist C7/C8/E8): kind resolves at commit time (template kind →
// panel calcType → primitive default), volume params come from the calc panel's
// config, geometry serializes by the PRIMITIVE (a re-typed line commits as a
// closed Polygon ring — ledger #6), create is DRAFT-FIRST, edit PATCHes in
// place, and volume kinds auto-compute.
//
// Contract with the machine: THROW to signal a retryable failure (machine
// returns to calcReady with the draft intact); user-facing toasts fire here so
// the machine stays pure. On success the machine resets to idle and the store
// bridge clears the mirrors — this module must NOT touch draft entities.

import type { StoreApi } from "zustand/vanilla";
import { toast } from "sonner";
import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";

import { createMeasurement, updateMeasurement } from "@/lib/api/assetSvc";
import {
  CalcParamsError,
  LEAN_RENDER,
  coerceMethodForKind,
  defaultKindFor,
  isVolumeKind,
  kindForCalcType,
  surfaceRefsForMethod,
} from "@/lib/viewer/calc";
import { fromPromise } from "xstate";

import type { ViewerShellState } from "@/lib/viewer/state/store";
import {
  interactionMachine,
  type CommitInput,
  type CommitResult,
} from "@/lib/viewer/interaction/machine";

export interface CommitDeps {
  surveyId: string;
  store: StoreApi<ViewerShellState>;
  refreshMeasurements: () => Promise<void>;
  triggerCompute: (id: string) => Promise<void> | void;
}

/** The interaction machine with its commit actor bound to a LATEST-deps slot.
 * The slot lives in this closure (not a React ref and not React state — the
 * compiler forbids both patterns in render scope): the component lazy-inits
 * once, then re-points the deps via `setDeps` in an effect after each render,
 * so the actor is created exactly once yet always saves with live closures. */
export function machineWithCommit(): {
  machine: ReturnType<typeof interactionMachine.provide>;
  setDeps: (deps: CommitDeps) => void;
} {
  let current: CommitDeps | null = null;
  return {
    machine: interactionMachine.provide({
      actors: {
        commit: fromPromise<CommitResult, CommitInput>(async ({ input }) => {
          if (!current) throw new Error("interaction commit: deps unavailable");
          return commitDraftMeasurement(input, current);
        }),
      },
    }),
    setDeps: (deps) => {
      current = deps;
    },
  };
}

/** Thrown for validation failures the user can fix and retry (already toasted). */
export class CommitRejected extends Error {}

export async function commitDraftMeasurement(
  input: CommitInput,
  deps: CommitDeps
): Promise<CommitResult> {
  const { surveyId, store, refreshMeasurements, triggerCompute } = deps;
  const mode = input.primitive === "polygon" ? "polygon" : "polyline";

  // Undo in calcReady can drop below the minimum — re-validate at commit.
  const minPoints = mode === "polygon" ? 3 : 2;
  if (input.draft.length < minPoints) {
    toast.error(`Need at least ${minPoints} points for a ${mode}`);
    throw new CommitRejected("too few points");
  }

  // Kind: template preset → panel calcType (validated for this geometry) →
  // primitive default. When EDITING, the row's stored kind always wins.
  const kind =
    input.template?.defaultKind ??
    kindForCalcType(store.getState().view.calcType, mode) ??
    defaultKindFor(mode);
  const existing = input.measurementId
    ? store.getState().measurements.find((m) => m.id === input.measurementId)
    : null;
  const resolvedKind = existing?.kind ?? kind;

  const params: Record<string, unknown> = {};
  if (input.template?.drawOpts?.slope) params.slope = true;
  if (isVolumeKind(resolvedKind)) {
    const view = store.getState().view;
    // Coerced onto the kind's method list — what persists always equals what
    // the panel displayed (a stale cut/fill pick never rides along).
    const cfg = coerceMethodForKind(
      {
        method: view.volumeMethod,
        refMode: view.refMode,
        refElevation: view.refElevation,
        baseDesignId: view.baseDesignId,
      },
      resolvedKind
    );
    params.volume_method = cfg.method;
    params.render = LEAN_RENDER; // number-only compute; tiles are a later, explicit ask
    try {
      const refs = surfaceRefsForMethod(cfg);
      params.from = refs.from;
      params.to = refs.to;
    } catch (err) {
      if (err instanceof CalcParamsError) {
        // Invalid panel config (e.g. custom RL without a value): keep the draw
        // alive — the user fixes the panel and double-clicks again.
        toast.warning(err.message);
        throw new CommitRejected(err.message);
      }
      throw err;
    }
  }

  const coords: [number, number][] = input.draft.map((p) => {
    // Vec3 is machine-side opaque; rebuild a real Cartesian3 for the transform.
    const c = Cartographic.fromCartesian(new Cartesian3(p.x, p.y, p.z));
    return [
      Number(CesiumMath.toDegrees(c.longitude).toFixed(8)),
      Number(CesiumMath.toDegrees(c.latitude).toFixed(8)),
    ];
  });
  // A double-click lands two near-identical trailing vertices — drop the dup.
  if (coords.length > minPoints) {
    const [lastLng, lastLat] = coords[coords.length - 1];
    const [prevLng, prevLat] = coords[coords.length - 2];
    if (Math.abs(lastLng - prevLng) < 1e-7 && Math.abs(lastLat - prevLat) < 1e-7) {
      coords.pop();
    }
  }

  const geometry =
    mode === "polygon"
      ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
      : { type: "LineString", coordinates: coords };

  // EDIT (P2): PATCH geometry in place, reselect, recompute.
  if (input.measurementId) {
    const editId = input.measurementId;
    await updateMeasurement(surveyId, editId, { geometry });
    const s = store.getState();
    s.setMeasurementVisible(editId, true);
    s.selectMeasurement(editId, { fly: false });
    await refreshMeasurements();
    toast.success("Geometry updated");
    if (isVolumeKind(resolvedKind)) await triggerCompute(editId);
    return { id: editId };
  }

  // CREATE — draft-first: persist immediately, no naming gate; the user
  // promotes (Save) or discards from the inspector.
  try {
    const created = await createMeasurement(surveyId, {
      kind: resolvedKind,
      name: `Untitled ${resolvedKind.replace(/_/g, " ")}`,
      geometry,
      params,
      draft: true,
    });
    const s = store.getState();
    s.setMeasurements([created, ...s.measurements]); // optimistic — list is newest-first
    s.setMeasurementVisible(created.id, true); // show the just-drawn shape
    s.selectMeasurement(created.id, { fly: false }); // opens the inspector on the draft
    await refreshMeasurements();
    if (isVolumeKind(resolvedKind)) await triggerCompute(created.id);
    return { id: created.id };
  } catch (err) {
    if (err instanceof Error) toast.error(`Couldn't create the draft: ${err.message}`);
    throw err; // machine → calcReady; the drawn shape stays; Esc clears it
  }
}
