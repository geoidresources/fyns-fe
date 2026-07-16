import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLegacyFolderTree,
  legacyFolderTreeSource,
} from "../workspaceTree.ts";
import type { Measurement } from "../../api/assetSvc.ts";

function m(id: string, folder?: string): Measurement {
  return {
    id,
    client_id: "c",
    survey_id: "s",
    kind: "volume",
    name: id,
    folder,
    status: "completed",
    created_at: "",
    updated_at: "",
  };
}

test("single workspace root named Measurements at depth 0", () => {
  const tree = buildLegacyFolderTree([m("m1", "A")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].kind, "workspace");
  assert.equal(tree[0].name, "Measurements");
  assert.equal(tree[0].depth, 0);
});

test("nests A/B/C into folders with ascending depths and item on the leaf", () => {
  const tree = buildLegacyFolderTree([m("m1", "A/B/C")]);
  const a = tree[0].children[0];
  assert.equal(a.name, "A");
  assert.equal(a.kind, "folder");
  assert.equal(a.depth, 1);
  const b = a.children[0];
  assert.equal(b.name, "B");
  assert.equal(b.depth, 2);
  const c = b.children[0];
  assert.equal(c.name, "C");
  assert.equal(c.depth, 3);
  assert.deepEqual(c.itemIds, ["m1"]);
  assert.deepEqual(a.itemIds, []); // parents hold only their direct items
});

test("depth is capped at 5 — deeper path segments are dropped", () => {
  const tree = buildLegacyFolderTree([m("m1", "A/B/C/D/E/F/G")]);
  let node = tree[0];
  const depths: number[] = [];
  const names: string[] = [];
  while (node.children.length > 0) {
    node = node.children[0];
    depths.push(node.depth);
    names.push(node.name);
  }
  assert.deepEqual(depths, [1, 2, 3, 4, 5]);
  assert.deepEqual(names, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(node.itemIds, ["m1"]); // item lands in the 5th-level folder
});

test("folder-less measurements collect under an Ungrouped folder pinned last", () => {
  const tree = buildLegacyFolderTree([
    m("m1", "Zebra"),
    m("m2"),
    m("m3", "Alpha"),
  ]);
  const names = tree[0].children.map((c) => c.name);
  assert.deepEqual(names, ["Alpha", "Zebra", "Ungrouped"]); // sorted, Ungrouped last
  const ungrouped = tree[0].children[tree[0].children.length - 1];
  assert.equal(ungrouped.name, "Ungrouped");
  assert.deepEqual(ungrouped.itemIds, ["m2"]);
});

test("shared parent folders merge and sort their children", () => {
  const tree = buildLegacyFolderTree([m("m1", "A/C"), m("m2", "A/B")]);
  const a = tree[0].children[0];
  assert.equal(a.name, "A");
  assert.equal(a.children.length, 2);
  assert.deepEqual(
    a.children.map((c) => c.name),
    ["B", "C"]
  );
});

test("legacyFolderTreeSource loads the tree and is read-only", async () => {
  const source = legacyFolderTreeSource([m("m1", "A")]);
  assert.deepEqual(source.capabilities, { crud: false, dnd: false });
  const tree = await source.load("project-1", "survey-1");
  assert.equal(tree[0].children[0].name, "A");
  assert.deepEqual(tree[0].children[0].itemIds, ["m1"]);
});
