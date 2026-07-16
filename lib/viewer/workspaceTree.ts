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
  depth: number;
  children: WorkspaceTreeNode[];
  /** Ids of measurements that live directly in this node (not descendants). */
  itemIds: string[];
}

export interface TreeSource {
  load(projectId: string, surveyId: string): Promise<WorkspaceTreeNode[]>;
  capabilities: { crud: boolean; dnd: boolean };
}

/** Folder nesting cap — the workspace is depth 0, folders are depths 1–5
 * (mirrors the asset-svc `folders.depth BETWEEN 0 AND 5` invariant, §6.2). */
const MAX_FOLDER_DEPTH = 5;
const WORKSPACE_ID = "workspace:measurements";
const WORKSPACE_NAME = "Measurements";
const UNGROUPED_ID = "folder:__ungrouped__";
const UNGROUPED_NAME = "Ungrouped";

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
