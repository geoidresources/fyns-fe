import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createActor, fromPromise, waitFor } from "xstate";
import { toast } from "sonner";

import { interactionMachine, type CommitInput } from "../machine.ts";
import { attachStoreBridge } from "../bridge.ts";
import { createViewerStore } from "../../state/store.ts";
import type { Vec3 } from "../types.ts";

// Bridge = the one-way mirror machine → legacy Zustand store. It's entry-effect
// driven, so bugs here are invisible to the pure machine tests (the live
// drawMode-staleness regression proved that). These run the REAL machine + REAL
// createViewerStore + REAL attachStoreBridge under bare `node --test` — sonner
// and the store's runtime deps (zustand/react) import cleanly; every @/ import
// in store.ts is type-only. toast.info is intercepted per test.

const v = (x: number, y: number): Vec3 => ({ x, y, z: 0 });

/** Harness: real store + real bridge + a commit actor whose resolution we
 * control (deferred so we can observe the committing state), returning the
 * commits it received. */
function harness(opts?: { onCommit?: (input: CommitInput) => void; failCommit?: boolean }) {
  const store = createViewerStore("survey-1");
  const commits: CommitInput[] = [];
  const machine = interactionMachine.provide({
    actors: {
      commit: fromPromise<{ id: string }, CommitInput>(async ({ input }) => {
        commits.push(input);
        opts?.onCommit?.(input);
        if (opts?.failCommit) throw new Error("save failed");
        return { id: "m-new" };
      }),
    },
  });
  const actor = createActor(machine);
  const detach = attachStoreBridge(actor, store);
  actor.start();
  return { store, actor, commits, detach };
}

const s = (h: ReturnType<typeof harness>) => h.store.getState();

test("bridge: placing entry from idle mirrors the tool, clears selection, opens the measure panel", () => {
  const h = harness();
  h.store.getState().selectMeasurement("m-existing"); // pre-selected → detailPanel inspect
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  assert.equal(s(h).activeToolKey, "palette:line");
  assert.equal(s(h).drawMode, "polyline");
  assert.deepEqual(s(h).activeDrawOpts, { label: "Line", toolKey: "palette:line" });
  assert.equal(s(h).probing, false);
  assert.equal(s(h).detailPanel, "measure");
  assert.equal(s(h).selection, null);
  h.detach();
});

test("bridge: placing entry mirrors slope drawOpts", () => {
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "slope" });
  assert.equal(s(h).activeToolKey, "palette:slope");
  assert.equal(s(h).activeDrawOpts?.slope, true);
  h.detach();
});

test("bridge REGRESSION: calcReady re-mirrors drawMode after a line→polygon close-out", () => {
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0), nearOrigin: true }); // close
  // The live bug: store.drawMode stayed "polyline" so the calc panel offered
  // line calcs for a closed ring. Must now read "polygon".
  assert.equal(s(h).drawMode, "polygon");
  assert.equal(s(h).activeToolKey, null);
  assert.equal(s(h).detailPanel, "measure");
  h.detach();
});

test("bridge: calcReady via right-click keeps the polyline drawMode", () => {
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  h.actor.send({ type: "RIGHT_CLICK" });
  assert.equal(s(h).drawMode, "polyline");
  assert.equal(s(h).activeToolKey, null);
  h.detach();
});

test("bridge M1: a failed commit restores the draft mirror in calcReady (not 0 vertices)", async () => {
  const h = harness({ failCommit: true });
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  h.actor.send({ type: "RIGHT_CLICK" });
  assert.equal(s(h).draft.points.length, 3);
  h.actor.send({ type: "DOUBLE_CLICK" }); // committing → (fail) → calcReady
  await waitFor(h.actor, (snap) => snap.value === "calcReady");
  // Without the fix this reads 0 (committing-entry cancelDraw zeroed it and the
  // identity-guarded mirror below never re-fired) — the "0 m² beside a visible
  // polygon" bug. The calcReady-entry restore repairs it.
  assert.equal(s(h).draft.points.length, 3);
  h.detach();
});

test("bridge: committing entry runs store.cancelDraw but leaves the detail panel open", () => {
  // A commit that never resolves keeps the machine in `committing` so we can
  // inspect the store AFTER the bridge processed the entry effect (the actor's
  // sync prefix runs before subscribers, so onCommit would read pre-cancelDraw).
  const store = createViewerStore("survey-1");
  const machine = interactionMachine.provide({
    actors: { commit: fromPromise<{ id: string }, CommitInput>(() => new Promise(() => {})) },
  });
  const actor = createActor(machine);
  const detach = attachStoreBridge(actor, store);
  actor.start();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" }); // → committing; subscriber ran synchronously
  assert.equal(actor.getSnapshot().value, "committing");
  assert.equal(store.getState().drawMode, null);
  assert.equal(store.getState().activeToolKey, null);
  assert.equal(store.getState().draft.points.length, 0);
  assert.equal(store.getState().detailPanel, "measure"); // NOT closed mid-commit
  detach();
});

test("bridge: idle-from-committing hands off — the commit's selection + inspector survive", async () => {
  const h = harness({
    onCommit: () => {
      // commitMeasurement selects the created row + opens the inspector.
      h.store.getState().selectMeasurement("m-new");
    },
  });
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  h.actor.send({ type: "RIGHT_CLICK" });
  h.actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(h.actor, (snap) => snap.value === "idle");
  // The idle-from-committing branch must NOT closeDetail/clearSelection.
  assert.deepEqual(s(h).selection?.measurementIds, ["m-new"]);
  assert.equal(s(h).detailPanel, "inspect");
  h.detach();
});

test("bridge: idle-from-placing with a draft → cancelDraw + closeDetail + clearSelection + one toast", () => {
  const info = mock.method(toast, "info", () => "" as never);
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  h.actor.send({ type: "CANCEL" }); // the event ViewerCanvas.cancelDraw actually sends
  assert.equal(s(h).drawMode, null);
  assert.equal(s(h).activeToolKey, null);
  assert.equal(s(h).draft.points.length, 0);
  assert.equal(s(h).detailPanel, null);
  assert.equal(s(h).selection, null);
  assert.equal(info.mock.callCount(), 1);
  assert.equal(info.mock.calls[0].arguments[0], "Drawing discarded");
  info.mock.restore();
  h.detach();
});

test("bridge: empty-draft cancel is silent (toast gated on prior draft)", () => {
  const info = mock.method(toast, "info", () => "" as never);
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" }); // armed, no verts
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" }); // re-click → idle
  assert.equal(s(h).detailPanel, null);
  assert.equal(info.mock.callCount(), 0);
  info.mock.restore();
  h.detach();
});

const editVerts = (): Vec3[] => [v(0, 0), v(1, 0), v(1, 1)];

test("bridge editing entry: hides the measurement, mirrors the type, opens no discard", () => {
  const info = mock.method(toast, "info", () => "" as never);
  const h = harness();
  h.store.getState().selectMeasurement("m-7"); // inspector open
  h.actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  assert.equal(s(h).measurementVisibility["m-7"], false); // hidden during edit
  assert.equal(s(h).drawMode, "polygon"); // type mirrored
  assert.equal(s(h).activeToolKey, "palette:line"); // edit indicator
  assert.equal(s(h).draft.points.length, 3); // readout seeded
  assert.deepEqual(s(h).selection?.measurementIds, ["m-7"]); // stays selected
  assert.equal(info.mock.callCount(), 0);
  info.mock.restore();
  h.detach();
});

test("bridge editing CANCEL: re-shows the untouched measurement, clears the draft, no discard toast", () => {
  const info = mock.method(toast, "info", () => "" as never);
  const h = harness();
  h.store.getState().selectMeasurement("m-7");
  h.actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  h.actor.send({ type: "HANDLE_GRAB", index: 0 });
  h.actor.send({ type: "HANDLE_MOVE", updates: [{ index: 0, position: v(9, 9) }] });
  h.actor.send({ type: "CANCEL" });
  assert.equal(s(h).measurementVisibility["m-7"], true); // re-shown
  assert.equal(s(h).drawMode, null);
  assert.equal(s(h).draft.points.length, 0);
  assert.equal(info.mock.callCount(), 0); // "Drawing discarded" is a create-plane toast only
  info.mock.restore();
  h.detach();
});

test("bridge: the draft mirror tracks appends and undo while placing", () => {
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  h.actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  h.actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  assert.equal(s(h).draft.points.length, 3);
  assert.strictEqual(s(h).draft.points, h.actor.getSnapshot().context.draft); // same array
  h.actor.send({ type: "UNDO" });
  assert.equal(s(h).draft.points.length, 2);
  h.detach();
});

test("bridge: a WITHIN-placing template switch re-mirrors the lit tool (hotkey free-switch)", () => {
  const h = harness();
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  assert.equal(s(h).activeToolKey, "palette:polygon");
  // Empty draft → free switch to line stays IN placing (no re-entry) — the
  // entry mirror can't see it; the within-placing mirror must.
  h.actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  assert.equal(h.actor.getSnapshot().value, "placing");
  assert.equal(s(h).activeToolKey, "palette:line");
  assert.equal(s(h).drawMode, "polyline");
  h.detach();
});
