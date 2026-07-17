// Workspace tree source (viewer-shell §6.1, decision D4). Zone 2 codes against
// the `TreeSource` interface so it never hard-binds to the backend tree: 1.3
// ships `legacyFolderTreeSource` (a zero-BE-dependency adapter over
// `measurement.folder`), and 1.6 swaps in `folderApiTreeSource` (task 1.5 BE)
// by changing one line in TreePanel.
//
// Pure data transform — no React, no Cesium, no network — so it is unit-testable
// directly.

import type { Measurement } from "@/lib/api/assetSvc";

export interface WorkspaceTreeNode {
  id: string;
  name: string;
  kind: "workspace" | "folder";
  /** BE depth for real nodes (0 = workspace … 5); display indent is derived
   * from recursion level in the component, NOT from this. */
  depth: number;
  children: WorkspaceTreeNode[];
  /** Ids of measurements that live directly in this node (not descendants). */
  itemIds: string[];
  /** Client-only nodes: the pinned "Measurements" root and "Ungrouped". They
   * have no backend row — CRUD/DnD handlers special-case them. */
  synthetic?: "root" | "ungrouped";
}

export interface TreeSource {
  load(projectId: string, surveyId: string): Promise<WorkspaceTreeNode[]>;
  capabilities: { crud: boolean; dnd: boolean };
}

/** Folder nesting cap — the workspace is depth 0, folders are depths 1–5
 * (mirrors the asset-svc `folders.depth BETWEEN 0 AND 5` invariant, §6.2). */
export const MAX_FOLDER_DEPTH = 5;
const WORKSPACE_ID = "workspace:measurements";
const WORKSPACE_NAME = "Measurements";
const UNGROUPED_ID = "folder:__ungrouped__";
const UNGROUPED_NAME = "Ungrouped";

/** Stable ids of the two synthetic nodes (drop handlers special-case them). */
export const SYNTHETIC_ROOT_ID = WORKSPACE_ID;
export const SYNTHETIC_UNGROUPED_ID = UNGROUPED_ID;

/** Case-insensitive name sort for sibling folders (deterministic ordering). */
function sortChildren(node: WorkspaceTreeNode): void {
  node.children.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  for (const child of node.children) sortChildren(child);
}

/**
 * Build the legacy single-workspace tree from a flat measurement list. One
 * workspace ("Measurements") holds folder nodes derived by splitting each
 * `measurement.folder` on "/" (capped at depth 5); folder-less measurements
 * collect under an "Ungrouped" folder pinned last (§6.1).
 */
export function buildLegacyFolderTree(
  measurements: Measurement[]
): WorkspaceTreeNode[] {
  const workspace: WorkspaceTreeNode = {
    id: WORKSPACE_ID,
    name: WORKSPACE_NAME,
    kind: "workspace",
    depth: 0,
    children: [],
    itemIds: [],
  };

  const folderNodes = new Map<string, WorkspaceTreeNode>();
  const ungroupedItemIds: string[] = [];

  for (const m of measurements) {
    const segments = (m.folder ?? "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_FOLDER_DEPTH);

    if (segments.length === 0) {
      ungroupedItemIds.push(m.id);
      continue;
    }

    let parent = workspace;
    let pathKey = "";
    for (let i = 0; i < segments.length; i++) {
      pathKey = pathKey ? `${pathKey}/${segments[i]}` : segments[i];
      let node = folderNodes.get(pathKey);
      if (!node) {
        node = {
          id: `folder:${pathKey}`,
          name: segments[i],
          kind: "folder",
          depth: i + 1,
          children: [],
          itemIds: [],
        };
        folderNodes.set(pathKey, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.itemIds.push(m.id);
  }

  // Sort named folders alphabetically at every level, THEN append Ungrouped so
  // it always lands last regardless of name ordering (§6.1).
  sortChildren(workspace);

  if (ungroupedItemIds.length > 0) {
    workspace.children.push({
      id: UNGROUPED_ID,
      name: UNGROUPED_NAME,
      kind: "folder",
      depth: 1,
      children: [],
      itemIds: ungroupedItemIds,
    });
  }

  return [workspace];
}

/**
 * Zero-BE-dependency tree source (ships 1.3). Structure is derived purely from
 * the provided measurements' `folder` strings, so `load`'s project/survey args
 * are accepted for interface conformance but unused (survey filtering is a
 * `folderApiTreeSource` concern, §6.2). Read-only — all row behaviors are live
 * but folder CRUD and drag-and-drop are disabled (`capabilities`, §6.1).
 */
export function legacyFolderTreeSource(
  measurements: Measurement[]
): TreeSource {
  return {
    load: async () => buildLegacyFolderTree(measurements),
    capabilities: { crud: false, dnd: false },
  };
}

// --------------------------------------------------------- API-tree merging
// Pure transforms over the folders backend's tree (GET /projects/:id/
// folder-tree — §6.2). Network lives in lib/viewer/folderTreeSource.ts; these
// stay import-free of it so they remain unit-testable.

/**
 * Merge the backend workspaces into the single pinned display root: synthetic
 * "Measurements" → [real workspaces as its children…] → synthetic "Ungrouped"
 * (measurements in NO folder) pinned last. Each node's itemIds are filtered
 * to the provided (already search/filter-narrowed) measurement list.
 *
 * `pruneEmpty` (search/filter active): real folders whose whole subtree holds
 * no matching measurement drop out — matching the legacy tree, where a folder
 * with no hits vanishes. When false, empty folders STAY (they are drop
 * targets and freshly created folders must be visible).
 */
export function mergeApiTree(
  workspaces: WorkspaceTreeNode[],
  measurements: Measurement[],
  opts: { pruneEmpty?: boolean } = {}
): WorkspaceTreeNode[] {
  const known = new Set(measurements.map((m) => m.id));
  const grouped = new Set<string>();

  const filter = (node: WorkspaceTreeNode): WorkspaceTreeNode | null => {
    const itemIds = node.itemIds.filter((id) => known.has(id));
    for (const id of itemIds) grouped.add(id);
    const children = node.children
      .map(filter)
      .filter((c): c is WorkspaceTreeNode => c !== null);
    if (opts.pruneEmpty && itemIds.length === 0 && children.length === 0) return null;
    return { ...node, itemIds, children };
  };

  const realRoots = workspaces
    .map(filter)
    .filter((n): n is WorkspaceTreeNode => n !== null);

  const ungroupedIds = measurements.filter((m) => !grouped.has(m.id)).map((m) => m.id);

  const root: WorkspaceTreeNode = {
    id: WORKSPACE_ID,
    name: WORKSPACE_NAME,
    kind: "workspace",
    depth: 0,
    children: realRoots,
    itemIds: [],
    synthetic: "root",
  };
  if (ungroupedIds.length > 0) {
    root.children = [
      ...root.children,
      {
        id: UNGROUPED_ID,
        name: UNGROUPED_NAME,
        kind: "folder",
        depth: 1,
        children: [],
        itemIds: ungroupedIds,
        synthetic: "ungrouped",
      },
    ];
  }
  return [root];
}

/** measurementId → ids of the REAL folders it currently sits in (from the
 * unfiltered backend tree). Drives move semantics: add to target, remove from
 * every other membership. */
export function folderMembership(
  workspaces: WorkspaceTreeNode[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (node: WorkspaceTreeNode) => {
    for (const id of node.itemIds) {
      const list = out.get(id) ?? [];
      list.push(node.id);
      out.set(id, list);
    }
    node.children.forEach(walk);
  };
  workspaces.forEach(walk);
  return out;
}

/** Depth-first lookup by node id. */
export function findNode(
  nodes: WorkspaceTreeNode[],
  id: string
): WorkspaceTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Height of a subtree in levels (a leaf folder is 1). */
export function levelsOf(node: WorkspaceTreeNode): number {
  return 1 + node.children.reduce((acc, c) => Math.max(acc, levelsOf(c)), 0);
}

/**
 * Client-side guard for folder→folder drops, mirroring the backend's §6.2
 * validation so obviously-invalid drops never leave the client:
 *  • never onto Ungrouped, itself, or its own descendant (cycle);
 *  • onto the pinned root = promote to workspace (allowed unless it already
 *    is one);
 *  • otherwise the moved subtree must still fit under MAX_FOLDER_DEPTH
 *    (target.depth + levels ≤ MAX).
 */
export function canDropFolder(
  dragged: WorkspaceTreeNode,
  target: WorkspaceTreeNode
): boolean {
  if (target.synthetic === "ungrouped") return false;
  if (target.synthetic === "root") return dragged.depth > 0;
  if (target.id === dragged.id) return false;
  if (findNode(dragged.children, target.id)) return false; // would cycle
  return target.depth + levelsOf(dragged) <= MAX_FOLDER_DEPTH;
}

/** "New folder", "New folder 2", … — first name free among the siblings
 * (case-insensitive), dodging the backend's 409 sibling-name uniqueness. */
export function nextFolderName(siblings: WorkspaceTreeNode[], base = "New folder"): string {
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
