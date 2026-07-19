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
