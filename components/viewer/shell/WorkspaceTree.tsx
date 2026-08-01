"use client";

// WorkspaceTree (viewer-shell §6.3 / §4.2) — the `measure` module's zone-2
// content. Structure comes from the `TreeSource` seam (§6.1): 1.6 swapped in
// `folderApiTreeSource` (asset-svc folders backend, §6.2) — real folder CRUD
// (create / inline-rename / delete) and native HTML5 drag-and-drop: drag a
// measurement onto a folder to group it (root/Ungrouped = ungroup), drag a
// folder onto a folder to nest it (root = promote to workspace). Cycle/depth
// guards run client-side (canDropFolder) and again server-side (§6.2).
// When the folders backend is unreachable the source degrades to the legacy
// read-only folder-string tree and every folder affordance hides.
//
// Row/status behaviors are ported from MeasurementPanel: status dots,
// result-suffixed labels, hover compute/delete actions, demo badges, sort +
// filter + collapse-all toolbar, and the server-debounced search box. (The
// quick-draw polygon/polyline buttons were removed — the floating canvas
// toolbar owns drawing.)

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  Folder,
  FolderPlus,
  FolderTree,
  FoldVertical,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { measurementDeleteRequest } from "@/components/viewer/deleteConfirm";
import {
  canDropFolder,
  findNode,
  folderMembership,
  nextFolderName,
  MAX_FOLDER_DEPTH,
  type WorkspaceTreeNode,
} from "@/lib/viewer/workspaceTree";
import { folderApiTreeSource } from "@/lib/viewer/folderTreeSource";
import {
  createFolder,
  deleteFolder,
  updateFolder,
  updateFolderItems,
} from "@/lib/api/assetSvc";
import {
  isMeasurementVisibleOnCanvas,
  useViewerStore,
} from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { useInteractionActor } from "@/components/viewer/shell/interactionContext";
import { useSelector } from "@xstate/react";
import { isComputeStuck, metricsOf, resultForKind } from "@/lib/viewer/calc";
import { useComputeClock } from "@/components/viewer/shell/hooks/useComputeClock";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

// ------------------------------------------------------- ported row helpers

/** Single-line row label, e.g. "SP-01 · 14,820 m³" (ported from
 * MeasurementPanel). total_* keys are what the stockpile compute emits; the
 * bare keys cover client-side plan stats and future per-pile results. */
function measurementLabel(m: PanelMeasurement): string {
  if (m.demo) return m.name;
  // The CURRENT kind's stored doc (per-kind results map; legacy fallback) —
  // the label always matches what the inspector shows for this type.
  const r = metricsOf(m.demo ? m.result : resultForKind(m));
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (r) {
    const volume =
      r.total_volume_m3 ?? r.total_adjusted_volume_m3 ?? r.volume_m3 ?? r.adjusted_volume_m3;
    if (typeof volume === "number") return `${m.name} · ${fmt(volume)} m³`;
    if (typeof r.area_m2 === "number") return `${m.name} · ${fmt(r.area_m2)} m²`;
    const length = r.profile_length_m ?? r.length_m;
    if (typeof length === "number") return `${m.name} · ${fmt(length)} m`;
  }
  return m.name;
}

/** Small status dot reflecting compute state (ported from MeasurementPanel). */
function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-green-400"
      : status === "computing"
        ? "bg-blue-400"
        : status === "failed"
          ? "bg-red-400"
          : "bg-gray-600";
  if (status === "computing") {
    return <Loader2 size={11} className="shrink-0 animate-spin text-blue-400" />;
  }
  return <span className={`size-1.5 shrink-0 rounded-full ${color}`} title={status} />;
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          className={`flex size-7 items-center justify-center rounded-[4px] transition-colors ${
            active
              ? "bg-[#C97A4E] text-[#0A0D14]"
              : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
          }`}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ----------------------------------------------------------- tree utilities

function subtreeCount(node: WorkspaceTreeNode): number {
  return node.itemIds.length + node.children.reduce((acc, c) => acc + subtreeCount(c), 0);
}

function collectNodeIds(nodes: WorkspaceTreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id);
    collectNodeIds(n.children, out);
  }
  return out;
}

/** All measurement ids under a folder/workspace (direct + nested). */
function collectSubtreeItemIds(node: WorkspaceTreeNode): string[] {
  const ids = [...node.itemIds];
  for (const child of node.children) ids.push(...collectSubtreeItemIds(child));
  return ids;
}

/** Nested folders beneath a node, excluding the node itself — deleteFolder is a
 * HARD delete that cascades to them (assetSvc §deleteFolder), so the
 * confirmation has to state how many go with it. */
function countDescendantFolders(node: WorkspaceTreeNode): number {
  return node.children.reduce((acc, c) => acc + 1 + countDescendantFolders(c), 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------- DnD plumbing

/** What's being dragged (set at dragstart, same-window only — dataTransfer
 * payloads are unreadable during dragover, so guards read this instead). */
interface DragPayload {
  kind: "measurement" | "folder";
  id: string;
}

interface DndHandlers {
  ready: boolean;
  dropTargetId: string | null;
  startMeasurement: (e: React.DragEvent, id: string) => void;
  startFolder: (e: React.DragEvent, node: WorkspaceTreeNode) => void;
  end: () => void;
  overNode: (e: React.DragEvent, node: WorkspaceTreeNode) => void;
  leaveNode: (node: WorkspaceTreeNode) => void;
  dropNode: (e: React.DragEvent, node: WorkspaceTreeNode) => void;
}

interface FolderOps {
  ready: boolean;
  renamingId: string | null;
  create: (parent: WorkspaceTreeNode | null) => void;
  renameStart: (id: string) => void;
  renameCommit: (node: WorkspaceTreeNode, name: string) => void;
  renameCancel: () => void;
  remove: (node: WorkspaceTreeNode) => void;
}

// -------------------------------------------------------------- measurement row

function MeasurementRow({
  m,
  busy,
  visible,
  stuck,
  dnd,
  onSelect,
  onCompute,
  onForceCompute,
  onDelete,
  onToggleVisible,
}: {
  m: PanelMeasurement;
  busy: boolean;
  visible: boolean;
  /** Has been `computing` past the stuck threshold (ORB-39). */
  stuck: boolean;
  dnd: DndHandlers;
  onSelect: (m: PanelMeasurement) => void;
  onCompute: (id: string) => void;
  onForceCompute: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
}) {
  const canCompute = m.status === "draft" || m.status === "failed";
  const showDot = !m.demo && m.status !== "completed";
  const draggable = dnd.ready && !m.demo;
  return (
    <div
      data-m-id={m.id}
      draggable={draggable}
      onDragStart={draggable ? (e) => dnd.startMeasurement(e, m.id) : undefined}
      onDragEnd={draggable ? dnd.end : undefined}
      title={draggable ? "Drag onto a folder to group" : undefined}
      className={`group flex h-7 items-center gap-2 rounded-[4px] px-2 transition-colors ${
        visible
          ? "bg-[#C97A4E]/10 hover:bg-[#C97A4E]/15"
          : "hover:bg-white/[0.03]"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {showDot && <StatusDot status={m.status} />}
      <button
        type="button"
        onClick={() => onSelect(m)}
        title="Inspect measurement"
        className={`min-w-0 flex-1 truncate text-left text-[11px] transition-colors ${
          visible
            ? "font-medium text-[#F3F4F6] hover:text-white"
            : "text-[#52525b] hover:text-[#a1a1aa]"
        }`}
      >
        {measurementLabel(m)}
      </button>
      {m.draft && !m.demo && (
        <span
          title="Draft — save it from the inspector to keep it"
          className="shrink-0 rounded-[3px] border border-amber-500/25 px-1 text-[9px] uppercase tracking-wide text-amber-400/90"
        >
          draft
        </span>
      )}
      {m.demo && (
        <span
          title="Sample data — not from this survey"
          className="shrink-0 rounded-[3px] border border-white/10 px-1 text-[9px] uppercase tracking-wide text-gray-500"
        >
          demo
        </span>
      )}
      {!m.demo && (
        <button
          type="button"
          onClick={() => onToggleVisible(m.id, !visible)}
          title={visible ? "Hide on viewer" : "Show on viewer"}
          className={`shrink-0 transition-colors ${
            visible
              ? "text-[#C97A4E] hover:text-[#E09A6E]"
              : "text-gray-600 hover:text-gray-400"
          }`}
        >
          {visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      )}
      {!m.demo && (
        <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
          {canCompute && (
            <button
              type="button"
              onClick={() => onCompute(m.id)}
              disabled={busy}
              title="Compute"
              className="text-gray-500 transition-colors hover:text-[#C97A4E] disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            </button>
          )}
          {/* ORB-39: a compute stuck past the threshold gets a force re-run here
              too — the ordinary Play button above is hidden for `computing`. */}
          {stuck && (
            <button
              type="button"
              onClick={() => onForceCompute(m.id)}
              disabled={busy}
              title="This compute looks stuck — force a re-run"
              className="text-amber-500/80 transition-colors hover:text-amber-400 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(m.id)}
            disabled={busy}
            title="Delete"
            className="text-gray-500 transition-colors hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ inline rename

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const committed = useRef(false);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(value);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          committed.current = true;
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-5 min-w-0 flex-1 rounded-[3px] border border-[#C97A4E]/60 bg-[#19191d] px-1 text-xs text-[#F3F4F6] focus-visible:outline-none"
    />
  );
}

// ------------------------------------------------------------------ tree node

function TreeNode({
  node,
  level,
  byId,
  sortRecent,
  busyIds,
  collapsed,
  visibility,
  now,
  folderOps,
  dnd,
  onToggle,
  onSelect,
  onCompute,
  onForceCompute,
  onDelete,
  onToggleVisible,
  onToggleFolderVisible,
}: {
  node: WorkspaceTreeNode;
  level: number;
  byId: Map<string, PanelMeasurement>;
  sortRecent: boolean;
  busyIds: Set<string>;
  collapsed: Set<string>;
  visibility: Record<string, boolean>;
  /** Clock for the stuck-compute check (ORB-39). */
  now: number;
  folderOps: FolderOps;
  dnd: DndHandlers;
  onToggle: (id: string) => void;
  onSelect: (m: PanelMeasurement) => void;
  onCompute: (id: string) => void;
  onForceCompute: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleFolderVisible: (ids: string[]) => void;
}) {
  const open = !collapsed.has(node.id);
  const isWorkspace = node.kind === "workspace";
  const NodeIcon = isWorkspace ? FolderTree : Folder;
  // Real backend folders get CRUD affordances + are draggable; the pinned
  // root and Ungrouped are client-side fixtures.
  const isReal = !node.synthetic && folderOps.ready;
  const renaming = folderOps.renamingId === node.id;
  const isDropTarget = dnd.dropTargetId === node.id;

  // Resolve + sort this node's direct items. Default sorts by name; the
  // toggle switches to most-recently-updated first (ported behavior).
  const items = node.itemIds
    .map((id) => byId.get(id))
    .filter((m): m is PanelMeasurement => Boolean(m))
    .sort((a, b) =>
      sortRecent ? b.updated_at.localeCompare(a.updated_at) : a.name.localeCompare(b.name)
    );

  // Folder eye covers every non-demo measurement in the subtree.
  const subtreeIds = collectSubtreeItemIds(node);
  const toggleableIds = subtreeIds.filter((id) => {
    const m = byId.get(id);
    return m && !m.demo;
  });
  const anyVisible = toggleableIds.some(
    (id) => byId.get(id) != null && isMeasurementVisibleOnCanvas(byId.get(id)!, visibility)
  );
  const folderEyeActive = toggleableIds.length > 0 && anyVisible;

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(node.id)}>
      <div
        data-node-id={node.id}
        draggable={isReal && dnd.ready && !renaming}
        onDragStart={isReal ? (e) => dnd.startFolder(e, node) : undefined}
        onDragEnd={isReal ? dnd.end : undefined}
        onDragOver={(e) => dnd.overNode(e, node)}
        onDragLeave={() => dnd.leaveNode(node)}
        onDrop={(e) => dnd.dropNode(e, node)}
        className={`group flex h-8 w-full items-center gap-1.5 rounded-[4px] px-2 transition-colors ${
          isDropTarget
            ? "bg-[#C97A4E]/15 ring-1 ring-inset ring-[#C97A4E]/60"
            : "hover:bg-white/[0.03]"
        }`}
        style={{ paddingLeft: `${8 + level * 14}px` }}
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight
            size={14}
            className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <NodeIcon size={14} className="shrink-0 text-gray-500" />
          {renaming ? (
            <RenameInput
              initial={node.name}
              onCommit={(name) => folderOps.renameCommit(node, name)}
              onCancel={folderOps.renameCancel}
            />
          ) : (
            <span
              className={`min-w-0 flex-1 truncate text-left text-xs ${
                isWorkspace
                  ? "font-medium text-[#F3F4F6]"
                  : folderEyeActive
                    ? "text-[#F3F4F6]"
                    : "text-[#a1a1aa]"
              }`}
            >
              {node.name}
            </span>
          )}
          {!renaming && (
            <span className="shrink-0 text-[11px] text-[#71717a]">({subtreeCount(node)})</span>
          )}
        </CollapsibleTrigger>

        {/* Folder management — real backend folders only. */}
        {isReal && !renaming && (
          <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
            {node.depth < MAX_FOLDER_DEPTH && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  folderOps.create(node);
                }}
                title="New subfolder"
                className="text-gray-500 transition-colors hover:text-[#C97A4E]"
              >
                <FolderPlus size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                folderOps.renameStart(node.id);
              }}
              title="Rename folder"
              className="text-gray-500 transition-colors hover:text-gray-200"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                folderOps.remove(node);
              }}
              title="Delete folder (measurements move to Ungrouped)"
              className="text-gray-500 transition-colors hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}

        {toggleableIds.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFolderVisible(toggleableIds);
            }}
            title={folderEyeActive ? "Hide all in group" : "Show all in group"}
            className={`shrink-0 transition-colors ${
              folderEyeActive
                ? "text-[#C97A4E] hover:text-[#E09A6E]"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            {folderEyeActive ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        )}
      </div>
      <CollapsibleContent>
        {node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            level={level + 1}
            byId={byId}
            sortRecent={sortRecent}
            busyIds={busyIds}
            collapsed={collapsed}
            visibility={visibility}
            now={now}
            folderOps={folderOps}
            dnd={dnd}
            onToggle={onToggle}
            onSelect={onSelect}
            onCompute={onCompute}
            onForceCompute={onForceCompute}
            onDelete={onDelete}
            onToggleVisible={onToggleVisible}
            onToggleFolderVisible={onToggleFolderVisible}
          />
        ))}
        <div style={{ paddingLeft: `${14 + level * 14}px` }}>
          {items.map((m) => (
            <MeasurementRow
              key={m.id}
              m={m}
              busy={busyIds.has(m.id)}
              visible={isMeasurementVisibleOnCanvas(m, visibility)}
              stuck={!m.demo && isComputeStuck(m, now)}
              dnd={dnd}
              onSelect={onSelect}
              onCompute={onCompute}
              onForceCompute={onForceCompute}
              onDelete={onDelete}
              onToggleVisible={onToggleVisible}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// -------------------------------------------------------------- WorkspaceTree

export function WorkspaceTree() {
  const measurements = useViewerStore((s) => s.measurements);
  const measurementVisibility = useViewerStore((s) => s.measurementVisibility);
  const measurementSearch = useViewerStore((s) => s.measurementSearch);
  const searchingMeasurements = useViewerStore((s) => s.searchingMeasurements);
  const drawMode = useViewerStore((s) => s.drawMode);
  // v2: reshaping an existing measurement mirrors drawMode too, so the drawing
  // hint below would read wrong — swap to edit guidance when the machine says so.
  const interactionActor = useInteractionActor();
  const isEditingGeometry = useSelector(
    interactionActor,
    (s) => typeof s.value === "object" && s.value !== null && "editing" in s.value
  );
  const busyIds = useViewerStore((s) => s.busyIds);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? "");
  const surveyId = useViewerStore((s) => s.surveyId);
  const setMeasurementSearch = useViewerStore((s) => s.setMeasurementSearch);
  const setMeasurementVisible = useViewerStore((s) => s.setMeasurementVisible);
  const setMeasurementsVisible = useViewerStore((s) => s.setMeasurementsVisible);
  const actions = useViewerActions();

  const [sortRecent, setSortRecent] = useState(false);
  const [completedOnly, setCompletedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<WorkspaceTreeNode[]>([]);
  // The UNfiltered backend workspaces (membership map, name dedupe, drop
  // guards); null = folders backend unavailable → legacy read-only tree.
  const [rawWorkspaces, setRawWorkspaces] = useState<WorkspaceTreeNode[] | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragRef = useRef<DragPayload | null>(null);
  // ORB-37: both destructive tree affordances (row trash, folder trash) route
  // through this before touching the backend.
  const { confirm, confirmDialog } = useConfirm();
  // ORB-39: ticks only while something is computing, so stuck rows can grow
  // their force-rerun affordance without any data changing.
  const now = useComputeClock(measurements.some((m) => m.status === "computing"));

  // Name search runs server-side (`measurements` already reflects the query);
  // only the completed-only filter is client-side, applied BEFORE the tree
  // builds so empty folders drop out while filtering (ported behavior).
  const visible = useMemo(
    () => (completedOnly ? measurements.filter((m) => m.status === "completed") : measurements),
    [measurements, completedOnly]
  );
  const filtering = completedOnly || measurementSearch.trim().length > 0;

  // The TreeSource seam (§6.1): folderApiTreeSource (1.6). refreshTick forces
  // a re-load after every folder mutation.
  const source = useMemo(
    () =>
      folderApiTreeSource(visible, { pruneEmpty: filtering, onRaw: setRawWorkspaces }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, filtering, refreshTick]
  );

  useEffect(() => {
    let alive = true;
    source
      .load(projectId, surveyId)
      .then((ws) => {
        if (alive) setNodes(ws);
      })
      .catch(() => {
        if (alive) setNodes([]);
      });
    return () => {
      alive = false;
    };
  }, [source, projectId, surveyId]);

  const byId = useMemo(
    () => new Map<string, PanelMeasurement>(measurements.map((m) => [m.id, m])),
    [measurements]
  );

  const allNodeIds = useMemo(() => collectNodeIds(nodes), [nodes]);
  const allCollapsed = allNodeIds.length > 0 && allNodeIds.every((id) => collapsed.has(id));

  const toggleNode = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(allNodeIds));
  };

  /** Folder eye: if any saved item is visible → hide all; else show all. */
  const toggleFolderVisible = (ids: string[]) => {
    const anyOn = ids.some((id) => {
      const m = byId.get(id);
      return m ? isMeasurementVisibleOnCanvas(m, measurementVisibility) : false;
    });
    setMeasurementsVisible(ids, !anyOn);
  };

  // ------------------------------------------------------- folder mutations

  const refresh = () => setRefreshTick((t) => t + 1);
  const mutationError = (err: unknown, fallback: string) =>
    toast.error(err instanceof Error && err.message ? err.message : fallback);

  const folderOps: FolderOps = {
    ready: rawWorkspaces !== null,
    renamingId,
    create: (parent) => {
      if (rawWorkspaces === null || !projectId) {
        toast.error("Folders are unavailable right now");
        return;
      }
      // parent === null (toolbar) → top-level; parent real → subfolder. The
      // synthetic root also means top-level (drop-created path).
      const parentReal = parent && !parent.synthetic ? parent : null;
      const siblings = parentReal
        ? (findNode(rawWorkspaces, parentReal.id)?.children ?? [])
        : rawWorkspaces;
      const name = nextFolderName(siblings);
      createFolder({
        project_id: projectId,
        parent_id: parentReal ? parentReal.id : null,
        name,
      })
        .then((created) => {
          // Reveal the new row and drop straight into rename mode.
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (parentReal) next.delete(parentReal.id);
            return next;
          });
          setRenamingId(created.id);
          refresh();
        })
        .catch((err) => mutationError(err, "Could not create the folder"));
    },
    renameStart: setRenamingId,
    renameCommit: (node, name) => {
      setRenamingId(null);
      const next = name.trim();
      if (!next || next === node.name) return;
      updateFolder(node.id, { name: next })
        .then(refresh)
        .catch((err) => mutationError(err, "Could not rename the folder"));
    },
    renameCancel: () => setRenamingId(null),
    remove: (node) => {
      // deleteFolder is a HARD delete that cascades to child folders and
      // membership rows (assetSvc §deleteFolder). Measurements survive and fall
      // back to Ungrouped — the copy says all three things explicitly, because
      // "are you sure?" would hide the cascade (ORB-37).
      const subfolders = countDescendantFolders(node);
      const grouped = collectSubtreeItemIds(node).length;
      confirm({
        title: `Delete the folder ${node.name}?`,
        description: (
          <>
            This permanently deletes the folder
            {subfolders > 0 ? (
              <>
                {" "}
                and the{" "}
                <span className="text-gray-300">{plural(subfolders, "folder", "folders")}</span>{" "}
                nested inside it
              </>
            ) : null}
            , and clears the grouping for{" "}
            <span className="text-gray-300">
              {plural(grouped, "measurement", "measurements")}
            </span>
            . The measurements themselves are not deleted — they move back to Ungrouped. This
            cannot be undone.
          </>
        ),
        confirmLabel: "Delete folder",
        onConfirm: async () => {
          try {
            await deleteFolder(node.id);
            toast.success("Folder deleted — its measurements moved to Ungrouped");
            refresh();
          } catch (err) {
            mutationError(err, "Could not delete the folder");
          }
        },
      });
    },
  };

  // ------------------------------------------------------------ DnD wiring

  const moveMeasurement = async (mid: string, target: WorkspaceTreeNode) => {
    if (rawWorkspaces === null) return;
    const membership = folderMembership(rawWorkspaces).get(mid) ?? [];
    const targetReal = !target.synthetic;
    const ops: Promise<unknown>[] = [];
    if (targetReal && !membership.includes(target.id)) {
      ops.push(updateFolderItems(target.id, { add: [mid] }));
    }
    for (const fid of membership) {
      if (!targetReal || fid !== target.id) {
        ops.push(updateFolderItems(fid, { remove: [mid] }));
      }
    }
    if (ops.length === 0) return; // dropped where it already lives
    try {
      await Promise.all(ops);
      refresh();
    } catch (err) {
      mutationError(err, "Could not move the measurement");
      refresh(); // partial moves: reconcile with the backend's actual state
    }
  };

  const moveFolder = async (fid: string, target: WorkspaceTreeNode) => {
    if (rawWorkspaces === null) return;
    const dragged = findNode(rawWorkspaces, fid);
    if (!dragged || !canDropFolder(dragged, target)) return;
    try {
      await updateFolder(fid, {
        parent_id: target.synthetic === "root" ? null : target.id,
      });
      refresh();
    } catch (err) {
      mutationError(err, "Could not move the folder");
    }
  };

  const dnd: DndHandlers = {
    ready: rawWorkspaces !== null,
    dropTargetId,
    startMeasurement: (e, id) => {
      dragRef.current = { kind: "measurement", id };
      e.dataTransfer.setData("application/x-geoid-measurement", id);
      e.dataTransfer.effectAllowed = "move";
    },
    startFolder: (e, node) => {
      dragRef.current = { kind: "folder", id: node.id };
      e.dataTransfer.setData("application/x-geoid-folder", node.id);
      e.dataTransfer.effectAllowed = "move";
      e.stopPropagation();
    },
    end: () => {
      dragRef.current = null;
      setDropTargetId(null);
    },
    overNode: (e, node) => {
      const drag = dragRef.current;
      if (!drag || rawWorkspaces === null) return;
      let ok = false;
      if (drag.kind === "measurement") {
        ok = true; // folders group; root/Ungrouped ungroup
      } else {
        const dragged = findNode(rawWorkspaces, drag.id);
        ok = !!dragged && canDropFolder(dragged, node);
      }
      if (ok) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTargetId !== node.id) setDropTargetId(node.id);
      }
    },
    leaveNode: (node) => {
      setDropTargetId((prev) => (prev === node.id ? null : prev));
    },
    dropNode: (e, node) => {
      e.preventDefault();
      e.stopPropagation();
      const drag = dragRef.current;
      dragRef.current = null;
      setDropTargetId(null);
      if (!drag) return;
      if (drag.kind === "measurement") void moveMeasurement(drag.id, node);
      else void moveFolder(drag.id, node);
    },
  };

  /** Amber refresh icon on a stuck row → re-dispatch with `force`, bypassing
   * asset-svc's compute-in-flight 409 (ORB-39). */
  const forceCompute = (id: string) => actions.triggerCompute(id, undefined, { force: true });

  /** Row trash icon → confirm, then the real delete (ORB-37). */
  const confirmRemoveMeasurement = (id: string) => {
    const m = byId.get(id);
    if (!m) return;
    confirm(
      measurementDeleteRequest({ name: m.name, draft: m.draft }, () =>
        actions.removeMeasurement(id)
      )
    );
  };

  const treeEmpty = nodes.every((n) => subtreeCount(n) === 0 && n.children.length === 0);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col px-2 pt-2">
        <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-[0.04em] text-[#71717a]">
          Measurements
        </div>

        {/* Toolbar — new folder, sort, filter, collapse-all. (The quick-draw
            polygon/polyline buttons were removed — the floating canvas toolbar
            owns drawing.) */}
        <div className="flex items-center gap-1 px-1 pb-2">
          <ToolbarButton label="New folder" onClick={() => folderOps.create(null)}>
            <FolderPlus size={13} />
          </ToolbarButton>
          <ToolbarButton
            label={sortRecent ? "Sorting by recent" : "Sorting by name"}
            active={sortRecent}
            onClick={() => setSortRecent((v) => !v)}
          >
            <ArrowUpDown size={13} />
          </ToolbarButton>
          <ToolbarButton
            label={completedOnly ? "Showing completed only" : "Filter: completed only"}
            active={completedOnly}
            onClick={() => setCompletedOnly((v) => !v)}
          >
            <Filter size={13} />
          </ToolbarButton>
          <ToolbarButton label={allCollapsed ? "Expand all" : "Collapse all"} onClick={toggleAll}>
            <FoldVertical size={13} />
          </ToolbarButton>
        </div>

        {/* Search — matching runs server-side; useMeasurementsPoll debounces
            the store's measurementSearch 300 ms and refetches. */}
        <div className="relative mb-1 px-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={measurementSearch}
            onChange={(e) => setMeasurementSearch(e.target.value)}
            placeholder="Search measurements..."
            className="h-7 w-full rounded-[4px] border border-white/[0.08] bg-[#19191d] pl-7 pr-7 text-[11px] text-[#F3F4F6] placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C97A4E]"
          />
          {searchingMeasurements && (
            <Loader2
              size={12}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-500"
            />
          )}
        </div>

        {drawMode && (
          <p className="px-2 py-1.5 text-[11px] text-gray-500">
            {isEditingGeometry
              ? "Drag a handle to move it · click a midpoint dot to add a point · right-click an edge to open the ring. Enter or Done saves; Esc cancels."
              : "Click the globe to add vertices. Right-click to choose a calculation. Double-click to calculate. Esc discards."}
          </p>
        )}

        {/* Workspace → folders → measurements. */}
        <div className="flex flex-col pb-2">
          {treeEmpty && (
            <p className="px-2 py-1 text-[11px] italic text-gray-600">
              {measurementSearch || completedOnly
                ? "No matching measurements."
                : "No measurements yet — draw one above."}
            </p>
          )}
          {!treeEmpty &&
            nodes.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                byId={byId}
                sortRecent={sortRecent}
                busyIds={busyIds}
                collapsed={collapsed}
                visibility={measurementVisibility}
                now={now}
                folderOps={folderOps}
                dnd={dnd}
                onToggle={toggleNode}
                onSelect={actions.selectMeasurementRow}
                onCompute={actions.triggerCompute}
                onForceCompute={forceCompute}
                onDelete={confirmRemoveMeasurement}
                onToggleVisible={setMeasurementVisible}
                onToggleFolderVisible={toggleFolderVisible}
              />
            ))}
        </div>
        {confirmDialog}
      </div>
    </TooltipProvider>
  );
}
