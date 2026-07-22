import { test } from "node:test";
import assert from "node:assert/strict";
import { createActor, fromPromise, waitFor } from "xstate";

import { interactionMachine, type CommitInput } from "../machine.ts";
import type { Vec3 } from "../types.ts";

// Pure machine tests — no Cesium, no React. The adapter's job (snap, dedupe,
// origin proximity) is out of scope here: events arrive pre-resolved.

const v = (x: number, y: number): Vec3 => ({ x, y, z: 0 });

/** Actor with a controllable commit. Returns [actor, commits] where commits
 * records every CommitInput the machine handed to the save actor. */
function startActor(opts?: { failCommit?: boolean }) {
  const commits: CommitInput[] = [];
  const machine = interactionMachine.provide({
    actors: {
      commit: fromPromise<{ id: string }, CommitInput>(async ({ input }) => {
        commits.push(input);
        if (opts?.failCommit) throw new Error("save failed");
        return { id: "m-new" };
      }),
    },
  });
  const actor = createActor(machine);
  actor.start();
  return { actor, commits };
}

const draftOf = (actor: ReturnType<typeof startActor>["actor"]) =>
  actor.getSnapshot().context.draft;

test("idle: draw template arms placing with a clean context", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  const s = actor.getSnapshot();
  assert.equal(s.value, "placing");
  assert.equal(s.context.template?.id, "line");
  assert.equal(s.context.primitive, "polyline");
  assert.deepEqual(s.context.draft, []);
});

test("idle: probe templates never enter the machine (legacy path)", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "probe" });
  assert.equal(actor.getSnapshot().value, "idle");
});

test("placing: clicks append with a snapshot each; undo/redo restore whole drafts", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  assert.equal(draftOf(actor).length, 3);
  assert.equal(actor.getSnapshot().context.history.length, 3);

  actor.send({ type: "UNDO" });
  assert.equal(draftOf(actor).length, 2);
  actor.send({ type: "UNDO" });
  assert.equal(draftOf(actor).length, 1);
  actor.send({ type: "REDO" });
  assert.equal(draftOf(actor).length, 2);
  // A new click after undo clears the redo branch.
  actor.send({ type: "MAP_CLICK", position: v(9, 9) });
  assert.equal(actor.getSnapshot().context.future.length, 0);
});

test("placing: right-click with enough vertices releases for calc; empty cancels; too few stays", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "RIGHT_CLICK" }); // empty → cancel
  assert.equal(actor.getSnapshot().value, "idle");

  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" }); // polygon needs 3 → stays placing
  assert.equal(actor.getSnapshot().value, "placing");

  actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  actor.send({ type: "RIGHT_CLICK" });
  assert.equal(actor.getSnapshot().value, "calcReady");
});

test("C5 / line→polygon close-out: origin click with ≥3 verts re-types and locks", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  // nearOrigin with only 2 verts: guard fails → plain append.
  actor.send({ type: "MAP_CLICK", position: v(1, 1), nearOrigin: true });
  assert.equal(actor.getSnapshot().value, "placing");
  assert.equal(draftOf(actor).length, 3);

  actor.send({ type: "MAP_CLICK", position: v(0, 0), nearOrigin: true });
  const s = actor.getSnapshot();
  assert.equal(s.value, "calcReady");
  assert.equal(s.context.primitive, "polygon"); // re-typed, verts kept
  assert.equal(s.context.draft.length, 3); // origin click adds NO vertex
});

test("calcReady: placement is locked (MAP_CLICK ignored), undo still works", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  assert.equal(actor.getSnapshot().value, "calcReady");

  actor.send({ type: "MAP_CLICK", position: v(5, 5) });
  assert.equal(draftOf(actor).length, 2); // locked

  actor.send({ type: "UNDO" });
  assert.equal(draftOf(actor).length, 1);
});

test("ledger #1: switching templates mid-draft is BLOCKED — the draft survives", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });

  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  const s = actor.getSnapshot();
  assert.equal(s.value, "placing");
  assert.equal(s.context.template?.id, "line"); // unchanged
  assert.equal(s.context.draft.length, 2); // NOT wiped
});

test("template switch with an empty draft is free; re-click toggles off", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "TEMPLATE_PICKED", templateId: "section" });
  assert.equal(actor.getSnapshot().context.template?.id, "section");

  actor.send({ type: "TEMPLATE_PICKED", templateId: "section" }); // same → cancel
  assert.equal(actor.getSnapshot().value, "idle");
});

test("Esc discards from placing and calcReady; context fully cleared", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "ESC" });
  let s = actor.getSnapshot();
  assert.equal(s.value, "idle");
  assert.deepEqual(s.context.draft, []);
  assert.equal(s.context.template, null);

  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "ESC" });
  s = actor.getSnapshot();
  assert.equal(s.value, "idle");
  assert.deepEqual(s.context.draft, []);
});

test("commit: double-click hands draft+primitive to the save actor, then resets", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 1), nearOrigin: true }); // append (only 2 before)
  actor.send({ type: "MAP_CLICK", position: v(0, 0), nearOrigin: true }); // close → polygon
  actor.send({ type: "DOUBLE_CLICK" });

  await waitFor(actor, (s) => s.value === "idle");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].primitive, "polygon"); // ledger #6: primitive, not armed tool
  assert.equal(commits[0].draft.length, 3);
  assert.equal(commits[0].measurementId, null); // create, not PATCH
  assert.deepEqual(actor.getSnapshot().context.draft, []); // reset after save
});

test("commit failure returns to calcReady with the draft intact (retryable)", async () => {
  const { actor } = startActor({ failCommit: true });
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" });

  await waitFor(actor, (s) => s.value === "calcReady");
  assert.equal(draftOf(actor).length, 2); // nothing lost
});

// ---------------------------------------------------------------------------
// Edge/invariant pins added after the P1 senior-QA + senior-frontend reviews.

test("committing is inert: every event is dropped; exactly one commit fires", async () => {
  const commits: CommitInput[] = [];
  let release!: (r: { id: string }) => void;
  const machine = interactionMachine.provide({
    actors: {
      commit: fromPromise<{ id: string }, CommitInput>(({ input }) => {
        commits.push(input);
        return new Promise((res) => {
          release = res;
        });
      }),
    },
  });
  const actor = createActor(machine);
  actor.start();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" }); // → committing (deferred)
  assert.equal(actor.getSnapshot().value, "committing");
  // Anti-double-submit: none of these do anything while a save is in flight.
  actor.send({ type: "DOUBLE_CLICK" });
  actor.send({ type: "ESC" });
  actor.send({ type: "CANCEL" });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  assert.equal(actor.getSnapshot().value, "committing");
  release({ id: "m-1" });
  await waitFor(actor, (s) => s.value === "idle");
  assert.equal(commits.length, 1); // never re-invoked
});

test("CANCEL discards from placing and calcReady (ESC parity — the event ViewerCanvas sends)", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "CANCEL" });
  assert.equal(actor.getSnapshot().value, "idle");
  assert.deepEqual(draftOf(actor), []);

  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "CANCEL" });
  assert.equal(actor.getSnapshot().value, "idle");
});

test("calcReady: undo below the minimum still hands the short draft to commit (validation is the commit's job)", async () => {
  const { actor, commits } = startActor({ failCommit: true });
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" }); // calcReady, 2 verts (min for a line)
  actor.send({ type: "UNDO" }); // 1 vert — below min, still calcReady
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (s) => s.value === "calcReady");
  assert.equal(commits[0].draft.length, 1); // machine does NOT re-validate
  assert.equal(draftOf(actor).length, 1); // rejection kept the draft
});

test("G3 characterization: undo after an origin close keeps primitive=polygon (re-type is not snapshotted)", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  actor.send({ type: "MAP_CLICK", position: v(0, 0), nearOrigin: true }); // close → polygon
  // Back in calcReady; UNDO pops a vertex but does NOT un-type the primitive.
  actor.send({ type: "UNDO" });
  const s = actor.getSnapshot();
  assert.equal(s.context.primitive, "polygon");
  assert.equal(s.context.draft.length, 2);
  // Backstop: commit re-validation rejects a <3-vert polygon (commitMeasurement),
  // so no bad payload escapes. Whether this SHOULD un-type is a P2 decision.
});

test("G2 fixed: a probe template cannot arm mid-placing (no primitive-null draft)", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" }); // empty line draft
  actor.send({ type: "TEMPLATE_PICKED", templateId: "probe" }); // must be ignored
  const s = actor.getSnapshot();
  assert.equal(s.value, "placing");
  assert.equal(s.context.template?.id, "line"); // unchanged — NOT probe
  assert.equal(s.context.primitive, "polyline"); // never null
});

test("polygon origin-close: nearOrigin click adds no vertex and jumps to calcReady", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  actor.send({ type: "MAP_CLICK", position: v(0, 0), nearOrigin: true });
  const s = actor.getSnapshot();
  assert.equal(s.value, "calcReady");
  assert.equal(s.context.draft.length, 3); // origin click is NOT appended
});

test("calcReady: RIGHT_CLICK and nearOrigin MAP_CLICK are no-ops (adapter still forwards them)", () => {
  const { actor } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 1) });
  actor.send({ type: "RIGHT_CLICK" }); // → calcReady
  actor.send({ type: "RIGHT_CLICK" }); // ignored
  actor.send({ type: "MAP_CLICK", position: v(2, 2), nearOrigin: true }); // ignored
  const s = actor.getSnapshot();
  assert.equal(s.value, "calcReady");
  assert.equal(s.context.draft.length, 3);
});

// ------------------------------------------------------------- edit plane (P2)

const editVerts = (): Vec3[] => [v(0, 0), v(1, 0), v(1, 1)];

test("EDIT_SHAPE seeds the editor: origin=edit, measurementId set, primitive preserved", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  const s = actor.getSnapshot();
  assert.deepEqual(s.value, { editing: "ready" });
  assert.equal(s.context.origin, "edit");
  assert.equal(s.context.measurementId, "m-7");
  assert.equal(s.context.primitive, "polygon");
  assert.equal(s.context.draft.length, 3);
});

test("editing: grab → move → drop relocates one vertex; undo reverts the whole drag", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "HANDLE_GRAB", index: 1 });
  assert.deepEqual(actor.getSnapshot().value, { editing: "dragging" });
  actor.send({ type: "HANDLE_MOVE", updates: [{ index: 1, position: v(5, 5) }] });
  actor.send({ type: "HANDLE_MOVE", updates: [{ index: 1, position: v(9, 9) }] }); // live follow, no new snapshot
  actor.send({ type: "HANDLE_DROP" });
  let s = actor.getSnapshot();
  assert.deepEqual(s.value, { editing: "ready" });
  assert.deepEqual(s.context.draft[1], v(9, 9));
  assert.equal(s.context.grabbedIndex, null);
  assert.equal(s.context.history.length, 1); // ONE snapshot for the whole drag
  actor.send({ type: "UNDO" });
  s = actor.getSnapshot();
  assert.deepEqual(s.context.draft[1], v(1, 0)); // back to the pre-drag position
});

test("editing COMMIT hands a PATCH (measurementId set) to the commit actor", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "HANDLE_GRAB", index: 0 });
  actor.send({ type: "HANDLE_MOVE", updates: [{ index: 0, position: v(-1, -1) }] });
  actor.send({ type: "HANDLE_DROP" });
  actor.send({ type: "COMMIT" });
  await waitFor(actor, (s) => s.value === "idle");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].measurementId, "m-7"); // PATCH, not create
  assert.equal(commits[0].primitive, "polygon");
  assert.deepEqual(commits[0].draft[0], v(-1, -1));
});

test("editing: double-click also commits", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (s) => s.value === "idle");
  assert.equal(commits.length, 1);
});

test("editing CANCEL/ESC discards to idle (mid-drag too) with a clean context", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "HANDLE_GRAB", index: 2 });
  actor.send({ type: "HANDLE_MOVE", updates: [{ index: 2, position: v(3, 3) }] });
  actor.send({ type: "ESC" }); // cancel mid-drag
  const s = actor.getSnapshot();
  assert.equal(s.value, "idle");
  assert.equal(s.context.measurementId, null);
  assert.equal(s.context.origin, "create");
  assert.deepEqual(s.context.draft, []);
});

test("edit commit FAILURE returns to editing.ready with the draft intact (origin routing)", async () => {
  const { actor } = startActor({ failCommit: true });
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "HANDLE_GRAB", index: 1 });
  actor.send({ type: "HANDLE_MOVE", updates: [{ index: 1, position: v(4, 4) }] });
  actor.send({ type: "HANDLE_DROP" });
  actor.send({ type: "COMMIT" });
  await waitFor(actor, (s) => JSON.stringify(s.value) === JSON.stringify({ editing: "ready" }));
  const s = actor.getSnapshot();
  assert.deepEqual(s.context.draft[1], v(4, 4)); // move preserved
  assert.equal(s.context.measurementId, "m-7");
});

test("editing INSERT_VERTEX splices on the edge, selects the new vertex, snapshots for undo", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  // edge 0 is v0→v1; insert its midpoint → [v0, MID, v1, v2]
  actor.send({ type: "INSERT_VERTEX", edgeIndex: 0, position: v(0.5, 0) });
  const s = actor.getSnapshot();
  assert.equal(s.context.draft.length, 4);
  assert.deepEqual(s.context.draft[1], v(0.5, 0));
  assert.deepEqual(s.context.selectedVertices, [1]);
  actor.send({ type: "UNDO" });
  assert.equal(actor.getSnapshot().context.draft.length, 3); // insert reverted
});

test("editing INSERT_VERTEX on the closing edge appends", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "INSERT_VERTEX", edgeIndex: 2, position: v(0.5, 0.5) }); // closing edge v2→v0
  const d = actor.getSnapshot().context.draft;
  assert.equal(d.length, 4);
  assert.deepEqual(d[3], v(0.5, 0.5)); // appended at the end
});

test("editing DELETE_VERTEX removes the selected vertex; ring stays closed and re-routes", () => {
  const { actor } = startActor();
  // 4-vertex square so a delete keeps it a valid (>=3) polygon
  actor.send({
    type: "EDIT_SHAPE",
    measurementId: "m-7",
    geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
    primitive: "polygon",
  });
  actor.send({ type: "SELECT_VERTEX", index: 1 });
  actor.send({ type: "DELETE_VERTEX" });
  const s = actor.getSnapshot();
  assert.equal(s.context.draft.length, 3);
  assert.deepEqual(s.context.draft, [v(0, 0), v(1, 1), v(0, 1)]); // v1 gone, ring re-routes
  assert.deepEqual(s.context.selectedVertices, []);
  assert.equal(s.context.ringOpen, false); // stays CLOSED (unlike edge-erase)
});

test("editing DELETE_VERTEX is BLOCKED below the polygon minimum (guarded, no-op)", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: editVerts(), primitive: "polygon" });
  actor.send({ type: "SELECT_VERTEX", index: 0 });
  actor.send({ type: "DELETE_VERTEX" }); // 3 → would be 2 < min
  assert.equal(actor.getSnapshot().context.draft.length, 3); // unchanged
});

test("editing DELETE_VERTEX with no selection is a no-op", () => {
  const { actor } = startActor();
  actor.send({
    type: "EDIT_SHAPE",
    measurementId: "m-7",
    geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
    primitive: "polygon",
  });
  actor.send({ type: "DELETE_VERTEX" }); // selectedVertex null
  assert.equal(actor.getSnapshot().context.draft.length, 4);
});

test("editing: grabbing a handle also selects it (Delete target)", () => {
  const { actor } = startActor();
  actor.send({
    type: "EDIT_SHAPE",
    measurementId: "m-7",
    geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
    primitive: "polygon",
  });
  actor.send({ type: "HANDLE_GRAB", index: 2 });
  actor.send({ type: "HANDLE_DROP" });
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [2]);
  actor.send({ type: "DELETE_VERTEX" }); // deletes the grabbed-then-selected vertex
  assert.equal(actor.getSnapshot().context.draft.length, 3);
});

test("create commit failure still returns to calcReady (origin=create unaffected)", async () => {
  const { actor } = startActor({ failCommit: true });
  actor.send({ type: "TEMPLATE_PICKED", templateId: "line" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 0) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (s) => s.value === "calcReady");
  assert.equal(actor.getSnapshot().context.origin, "create");
});

test("commit input forwards template + ringOpen; history is one snapshot per append (uncapped)", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  for (let i = 0; i < 10; i++) actor.send({ type: "MAP_CLICK", position: v(i, i) });
  assert.equal(actor.getSnapshot().context.history.length, 10); // documents no cap
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (s) => s.value === "idle");
  assert.equal(commits[0].template?.id, "polygon");
  assert.equal(commits[0].ringOpen, false);
});

// ---------------------------------------------------------------- P2b-2 edge-open plane

const square = (): Vec3[] => [v(0, 0), v(1, 0), v(1, 1), v(0, 1)];

test("DELETE_EDGE opens the ring: rotates the gap to the end, clears selection, snapshots", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "SELECT_VERTEX", index: 2 });
  actor.send({ type: "DELETE_EDGE", edgeIndex: 0 }); // erase v0→v1
  const s = actor.getSnapshot();
  assert.equal(s.context.ringOpen, true);
  // chain now runs v1 → v2 → v3 → v0, so the gap (old edge 0) sits between v0 and v1.
  assert.deepEqual(s.context.draft, [v(1, 0), v(1, 1), v(0, 1), v(0, 0)]);
  assert.deepEqual(s.context.selectedVertices, []);
  assert.equal(s.context.history.length, 1);
  assert.deepEqual(s.value, { editing: "ready" });
});

test("DELETE_EDGE on the closing edge opens without reordering", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "DELETE_EDGE", edgeIndex: 3 }); // closing edge v3→v0
  const s = actor.getSnapshot();
  assert.equal(s.context.ringOpen, true);
  assert.deepEqual(s.context.draft, square()); // order intact — gap already at the end
});

test("DELETE_EDGE is BLOCKED on a polyline (no ring to open) and when already open", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(2, 0)], primitive: "polyline" });
  actor.send({ type: "DELETE_EDGE", edgeIndex: 0 });
  assert.equal(actor.getSnapshot().context.ringOpen, false); // no-op on a line

  const b = startActor();
  b.actor.send({ type: "EDIT_SHAPE", measurementId: "m-8", geometry: square(), primitive: "polygon" });
  b.actor.send({ type: "DELETE_EDGE", edgeIndex: 1 }); // opens
  const opened = b.actor.getSnapshot().context.draft;
  b.actor.send({ type: "DELETE_EDGE", edgeIndex: 1 }); // second open is a no-op
  assert.deepEqual(b.actor.getSnapshot().context.draft, opened); // unchanged
});

test("append-into-gap: while the ring is open a MAP_CLICK appends a vertex at the end", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "DELETE_EDGE", edgeIndex: 0 }); // open
  actor.send({ type: "MAP_CLICK", position: v(2, 2) });
  const s = actor.getSnapshot();
  assert.equal(s.context.draft.length, 5);
  assert.deepEqual(s.context.draft[4], v(2, 2)); // appended into the gap
  assert.equal(s.context.ringOpen, true); // still open, keep routing
});

test("closeGap: clicking the start vertex (nearOrigin) while open re-closes without adding a vertex", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "DELETE_EDGE", edgeIndex: 0 }); // open
  actor.send({ type: "MAP_CLICK", position: v(9, 9), nearOrigin: true }); // click the start
  const s = actor.getSnapshot();
  assert.equal(s.context.ringOpen, false); // re-closed
  assert.equal(s.context.draft.length, 4); // NO vertex added
});

test("MAP_CLICK in editing is inert while the ring is CLOSED (adapter hit-tests instead)", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(9, 9) }); // not open, not nearOrigin
  const s = actor.getSnapshot();
  assert.equal(s.context.draft.length, 4); // untouched
  assert.equal(s.context.ringOpen, false);
});

test("UNDO after DELETE_EDGE restores the CLOSED ring in its original order", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "DELETE_EDGE", edgeIndex: 1 });
  actor.send({ type: "UNDO" });
  const s = actor.getSnapshot();
  assert.deepEqual(s.context.draft, square());
  assert.equal(s.context.ringOpen, false);
});

test("noSelfIntersection BLOCKS commit of a bowtie polygon (edit plane) — stays editing, no save fires", async () => {
  const { actor, commits } = startActor();
  const bowtie = [v(0, 0), v(2, 2), v(2, 0), v(0, 2)]; // crossed diagonals when closed
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: bowtie, primitive: "polygon" });
  actor.send({ type: "DOUBLE_CLICK" }); // blocked by guard
  actor.send({ type: "COMMIT" }); // also blocked
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(actor.getSnapshot().value, { editing: "ready" }); // never left editing
  assert.equal(commits.length, 0); // save never invoked
});

test("noSelfIntersection BLOCKS a self-intersecting create-plane polygon on double-click", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "TEMPLATE_PICKED", templateId: "polygon" });
  // Z-shape that self-crosses once the ring closes.
  for (const p of [v(0, 0), v(3, 0), v(0, 2), v(3, 2)]) actor.send({ type: "MAP_CLICK", position: p });
  actor.send({ type: "RIGHT_CLICK" }); // → calcReady
  assert.equal(actor.getSnapshot().value, "calcReady");
  actor.send({ type: "DOUBLE_CLICK" }); // blocked — bowtie ring
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(actor.getSnapshot().value, "calcReady"); // stayed put
  assert.equal(commits.length, 0);
});

test("a simple (non-crossing) polygon still commits — the guard is not over-eager", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: square(), primitive: "polygon" });
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (s) => s.value === "idle");
  assert.equal(commits.length, 1);
});

// ---------------------------------------------------------------- P2c-2 redraw

test("REDRAW_SHAPE enters the CREATE plane seeded to PATCH (measurementId set, empty draft, origin create)", async () => {
  const { actor, commits } = startActor();
  actor.send({ type: "REDRAW_SHAPE", measurementId: "m-9", primitive: "polygon" });
  const s = actor.getSnapshot();
  assert.equal(s.value, "placing");
  assert.equal(s.context.measurementId, "m-9");
  assert.equal(s.context.origin, "create"); // failure routes to calcReady, not the edit plane
  assert.equal(s.context.draft.length, 0); // a fresh outline, not the old vertices
  assert.equal(s.context.primitive, "polygon");
  // draw a fresh triangle and finish → commit PATCHes the redrawn row
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(2, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 2) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (st) => st.value === "idle");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].measurementId, "m-9"); // PATCH, not a new create
});

test("REDRAW_SHAPE commit FAILURE returns to calcReady (create plane), retry keeps the PATCH target", async () => {
  const { actor } = startActor({ failCommit: true });
  actor.send({ type: "REDRAW_SHAPE", measurementId: "m-9", primitive: "polygon" });
  actor.send({ type: "MAP_CLICK", position: v(0, 0) });
  actor.send({ type: "MAP_CLICK", position: v(2, 0) });
  actor.send({ type: "MAP_CLICK", position: v(1, 2) });
  actor.send({ type: "RIGHT_CLICK" });
  actor.send({ type: "DOUBLE_CLICK" });
  await waitFor(actor, (s) => s.value === "calcReady");
  assert.equal(actor.getSnapshot().context.measurementId, "m-9");
});

// ---------------------------------------------------------------- multi-vertex (Phase 2)

test("shift-click TOGGLES membership; plain click collapses to one", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], primitive: "polygon" });
  actor.send({ type: "SELECT_VERTEX", index: 0 });
  actor.send({ type: "SELECT_VERTEX", index: 2, additive: true });
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [0, 2]);
  actor.send({ type: "SELECT_VERTEX", index: 0, additive: true }); // toggle 0 off
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [2]);
  actor.send({ type: "SELECT_VERTEX", index: 1 }); // plain click replaces
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [1]);
});

test("SELECT_ALL_VERTICES selects the whole ring", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], primitive: "polygon" });
  actor.send({ type: "SELECT_ALL_VERTICES" });
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [0, 1, 2, 3]);
});

test("batch DELETE removes every selected vertex in one undoable step", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1), v(-1, 1)], primitive: "polygon" });
  actor.send({ type: "SELECT_VERTEX", index: 1 });
  actor.send({ type: "SELECT_VERTEX", index: 3, additive: true });
  actor.send({ type: "DELETE_VERTEX" }); // 5 - 2 = 3 ≥ polygon min → allowed
  const s = actor.getSnapshot();
  assert.deepEqual(s.context.draft, [v(0, 0), v(1, 1), v(-1, 1)]);
  assert.deepEqual(s.context.selectedVertices, []);
  actor.send({ type: "UNDO" }); // one step restores all five
  assert.equal(actor.getSnapshot().context.draft.length, 5);
});

test("batch DELETE is BLOCKED when it would drop below the minimum", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], primitive: "polygon" });
  actor.send({ type: "SELECT_ALL_VERTICES" }); // 4 - 4 = 0 < 3
  actor.send({ type: "DELETE_VERTEX" });
  assert.equal(actor.getSnapshot().context.draft.length, 4); // untouched
  actor.send({ type: "SELECT_VERTEX", index: 0 });
  actor.send({ type: "SELECT_VERTEX", index: 1, additive: true }); // 4 - 2 = 2 < 3
  actor.send({ type: "DELETE_VERTEX" });
  assert.equal(actor.getSnapshot().context.draft.length, 4); // still blocked
});

test("batch drag: grabbing INSIDE the selection keeps it; the machine applies every update", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], primitive: "polygon" });
  actor.send({ type: "SELECT_VERTEX", index: 0 });
  actor.send({ type: "SELECT_VERTEX", index: 1, additive: true });
  actor.send({ type: "HANDLE_GRAB", index: 0 }); // inside the selection → kept
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [0, 1]);
  // Adapter sends the whole group with the same delta (+2,+2 here).
  actor.send({ type: "HANDLE_MOVE", updates: [
    { index: 0, position: v(2, 2) },
    { index: 1, position: v(3, 2) },
  ]});
  actor.send({ type: "HANDLE_DROP" });
  const s = actor.getSnapshot();
  assert.deepEqual(s.context.draft[0], v(2, 2));
  assert.deepEqual(s.context.draft[1], v(3, 2));
  assert.deepEqual(s.context.draft[2], v(1, 1)); // unselected verts untouched
  actor.send({ type: "UNDO" }); // whole batch move is ONE step
  assert.deepEqual(actor.getSnapshot().context.draft[0], v(0, 0));
  assert.deepEqual(actor.getSnapshot().context.draft[1], v(1, 0));
});

test("grabbing OUTSIDE the selection collapses it to the grabbed vertex", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], primitive: "polygon" });
  actor.send({ type: "SELECT_VERTEX", index: 0 });
  actor.send({ type: "SELECT_VERTEX", index: 1, additive: true });
  actor.send({ type: "HANDLE_GRAB", index: 3 }); // outside → collapse
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [3]);
});

test("undo drops selection indices the restored draft no longer has", () => {
  const { actor } = startActor();
  actor.send({ type: "EDIT_SHAPE", measurementId: "m-7", geometry: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], primitive: "polygon" });
  actor.send({ type: "INSERT_VERTEX", edgeIndex: 2, position: v(2, 2) }); // draft 5, selection [3]
  actor.send({ type: "SELECT_VERTEX", index: 4, additive: true }); // [3, 4]
  actor.send({ type: "UNDO" }); // back to 4 verts — index 4 must drop
  assert.deepEqual(actor.getSnapshot().context.selectedVertices, [3]);
});
