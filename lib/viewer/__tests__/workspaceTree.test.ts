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

// ------------------------------------------------------------ API-tree merge

import {
  canDropFolder,
  folderMembership,
  levelsOf,
  mergeApiTree,
  nextFolderName,
  type WorkspaceTreeNode,
} from "../workspaceTree.ts";

function node(
  id: string,
  depth: number,
  children: WorkspaceTreeNode[] = [],
  itemIds: string[] = []
): WorkspaceTreeNode {
  return { id, name: id, kind: depth === 0 ? "workspace" : "folder", depth, children, itemIds };
}

test("mergeApiTree pins one synthetic root; real workspaces become its children", () => {
  const tree = mergeApiTree([node("w1", 0, [node("f1", 1)])], [m("m1")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].synthetic, "root");
  assert.equal(tree[0].children[0].id, "w1");
  assert.equal(tree[0].children[0].children[0].id, "f1");
});

test("mergeApiTree: ungrouped measurements land in a synthetic Ungrouped pinned last", () => {
  const tree = mergeApiTree(
    [node("w1", 0, [], ["m1"])],
    [m("m1"), m("m2"), m("m3")]
  );
  const kids = tree[0].children;
  const last = kids[kids.length - 1];
  assert.equal(last.synthetic, "ungrouped");
  assert.deepEqual(last.itemIds.sort(), ["m2", "m3"]);
  // grouped one stays in its workspace, not in Ungrouped
  assert.deepEqual(kids[0].itemIds, ["m1"]);
});

test("mergeApiTree filters itemIds to known measurements (stale links vanish)", () => {
  const tree = mergeApiTree([node("w1", 0, [], ["m1", "ghost"])], [m("m1")]);
  assert.deepEqual(tree[0].children[0].itemIds, ["m1"]);
});

test("mergeApiTree keeps empty folders by default (drop targets) but prunes them when filtering", () => {
  const ws = [node("w1", 0, [node("empty", 1)], [])];
  const keep = mergeApiTree(ws, [m("m1")]);
  assert.equal(keep[0].children[0].children.length, 1);
  const pruned = mergeApiTree(ws, [m("m1")], { pruneEmpty: true });
  assert.equal(pruned[0].children.length, 1); // only Ungrouped(m1) survives
  assert.equal(pruned[0].children[0].synthetic, "ungrouped");
});

test("mergeApiTree with no workspaces still yields root + Ungrouped", () => {
  const tree = mergeApiTree([], [m("m1")]);
  assert.equal(tree[0].synthetic, "root");
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].synthetic, "ungrouped");
});

test("folderMembership maps measurement → every containing folder", () => {
  const ws = [node("w1", 0, [node("f1", 1, [], ["m1"])], ["m1", "m2"])];
  const map = folderMembership(ws);
  assert.deepEqual(map.get("m1")?.sort(), ["f1", "w1"]);
  assert.deepEqual(map.get("m2"), ["w1"]);
  assert.equal(map.get("m3"), undefined);
});

test("canDropFolder: rejects self, own descendant, and Ungrouped; allows root promote", () => {
  const child = node("child", 2);
  const parent = node("parent", 1, [child]);
  const other = node("other", 1);
  const root: WorkspaceTreeNode = { ...node("rootX", 0), synthetic: "root" };
  const ungrouped: WorkspaceTreeNode = { ...node("u", 1), synthetic: "ungrouped" };
  assert.equal(canDropFolder(parent, parent), false);
  assert.equal(canDropFolder(parent, child), false); // cycle
  assert.equal(canDropFolder(parent, ungrouped), false);
  assert.equal(canDropFolder(parent, other), true);
  assert.equal(canDropFolder(parent, root), true); // promote to workspace
  const ws = node("w", 0);
  assert.equal(canDropFolder(ws, root), false); // already a workspace
});

test("canDropFolder enforces the depth-5 cap on the whole moved subtree", () => {
  // dragged subtree is 2 levels tall; target at depth 3 → lands at 4+5 ≤ 5 ok
  const dragged = node("d", 1, [node("dc", 2)]);
  assert.equal(levelsOf(dragged), 2);
  assert.equal(canDropFolder(dragged, node("t3", 3)), true); // 3+2=5 ok
  assert.equal(canDropFolder(dragged, node("t4", 4)), false); // 4+2=6 too deep
});

test("nextFolderName dodges sibling collisions case-insensitively", () => {
  const siblings = [node("New folder", 1), node("NEW FOLDER 2", 1)];
  siblings[0].name = "New folder";
  siblings[1].name = "NEW FOLDER 2";
  assert.equal(nextFolderName([]), "New folder");
  assert.equal(nextFolderName(siblings), "New folder 3");
});
