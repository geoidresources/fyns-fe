// folderApiTreeSource (viewer-shell §6.2, task 1.6) — the real-backend
// TreeSource over asset-svc's folders API, swapped in for
// `legacyFolderTreeSource` at the §6.1 seam. Network lives HERE;
// lib/viewer/workspaceTree.ts keeps the pure transforms.

import { getFolderTree, type Measurement } from "@/lib/api/assetSvc";
import {
  buildLegacyFolderTree,
  mergeApiTree,
  type TreeSource,
  type WorkspaceTreeNode,
} from "@/lib/viewer/workspaceTree";

/**
 * Backend-backed tree source. `load` fetches the project's folder tree and
 * merges it with the (already search/filter-narrowed) measurement list —
 * synthetic pinned root, real workspaces as its children, Ungrouped last.
 *
 * `onRaw` hands the component the UNfiltered backend workspaces (membership
 * map, sibling-name dedupe, drop guards) — or null when the backend tree is
 * unavailable, in which case `load` degrades to the legacy folder-string tree
 * so the panel still renders (CRUD/DnD should be hidden by the caller then).
 */
export function folderApiTreeSource(
  measurements: Measurement[],
  opts: {
    pruneEmpty?: boolean;
    onRaw?: (workspaces: WorkspaceTreeNode[] | null) => void;
  } = {}
): TreeSource {
  return {
    capabilities: { crud: true, dnd: true },
    load: async (projectId: string, surveyId: string) => {
      if (!projectId || !surveyId) {
        opts.onRaw?.(null);
        return buildLegacyFolderTree(measurements);
      }
      try {
        const { workspaces } = await getFolderTree(projectId, surveyId);
        opts.onRaw?.(workspaces ?? []);
        return mergeApiTree(workspaces ?? [], measurements, {
          pruneEmpty: opts.pruneEmpty,
        });
      } catch {
        // Folders backend unreachable — degrade to the read-only legacy tree
        // rather than an empty panel; the caller disables folder actions.
        opts.onRaw?.(null);
        return buildLegacyFolderTree(measurements);
      }
    },
  };
}
