"use client";

// WorkspaceTree (viewer-shell §6.3 base / §4.2) — the `measure` module's zone-2
// content, replacing the rendered MeasurementPanel (whose FILE stays: it is the
// home of the DrawMode/DrawOptions types the store consumes).
//
// Structure comes from the `TreeSource` seam (§6.1): 1.3 ships
// `legacyFolderTreeSource` (workspace → folders nested by splitting
// `measurement.folder` on "/") and 1.6 swaps in `folderApiTreeSource` by
// changing ONE line here. Row/status behaviors are ported from
// MeasurementPanel: status dots, result-suffixed labels, hover
// compute/delete actions, demo badges, quick-draw + sort + filter +
// collapse-all toolbar, and the server-debounced search box (the store's
// `measurementSearch` — useMeasurementsPoll debounces 300 ms and refetches).
//
// DATA comes from store selectors; Cesium-bound callbacks come from
// `useViewerActions()` (§3.6 / the 1.3c-i actions seam). Quick-draw buttons
// mint `tree:*` tool keys (§3.5).

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronRight,
  Filter,
  Folder,
  FolderTree,
  FoldVertical,
  Hexagon,
  Loader2,
  Play,
  Search,
  Spline,
  Trash2,
} from "lucide-react";
import { motion } from "framer-motion";

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
import {
  legacyFolderTreeSource,
  type WorkspaceTreeNode,
} from "@/lib/viewer/workspaceTree";
import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import { metricsOf } from "@/lib/viewer/calc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

// ------------------------------------------------------- ported row helpers

/** Single-line row label, e.g. "SP-01 · 14,820 m³" (ported from
 * MeasurementPanel). total_* keys are what the stockpile compute emits; the
 * bare keys cover client-side plan stats and future per-pile results. */
function measurementLabel(m: PanelMeasurement): string {
  if (m.demo) return m.name;
  // metricsOf unwraps the §7.1 v1 result doc (metrics nested under .metrics);
  // legacy flat rows pass through unchanged.
  const r = metricsOf(m.result);
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

// -------------------------------------------------------------- measurement row

function MeasurementRow({
  m,
  busy,
  onSelect,
  onCompute,
  onDelete,
}: {
  m: PanelMeasurement;
  busy: boolean;
  onSelect: (m: PanelMeasurement) => void;
  onCompute: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const canCompute = m.status === "draft" || m.status === "failed";
  const showDot = !m.demo && m.status !== "completed";
  return (
    <div className="group flex h-7 items-center gap-2 rounded-[4px] px-2 hover:bg-white/[0.03]">
      {showDot && <StatusDot status={m.status} />}
      <button
        type="button"
        onClick={() => onSelect(m)}
        title="Inspect measurement"
        className="min-w-0 flex-1 truncate text-left text-[11px] text-[#a1a1aa] transition-colors hover:text-[#F3F4F6]"
      >
        {measurementLabel(m)}
      </button>
      {m.demo && (
        <span
          title="Sample data — not from this survey"
          className="shrink-0 rounded-[3px] border border-white/10 px-1 text-[9px] uppercase tracking-wide text-gray-500"
        >
          demo
        </span>
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

// ------------------------------------------------------------------ tree node

function TreeNode({
  node,
  byId,
  sortRecent,
  busyIds,
  collapsed,
  onToggle,
  onSelect,
  onCompute,
  onDelete,
}: {
  node: WorkspaceTreeNode;
  byId: Map<string, PanelMeasurement>;
  sortRecent: boolean;
  busyIds: Set<string>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (m: PanelMeasurement) => void;
  onCompute: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const open = !collapsed.has(node.id);
  const isWorkspace = node.kind === "workspace";
  const NodeIcon = isWorkspace ? FolderTree : Folder;

  // Resolve + sort this node's direct items. Default sorts by name; the
  // toggle switches to most-recently-updated first (ported behavior).
  const items = node.itemIds
    .map((id) => byId.get(id))
    .filter((m): m is PanelMeasurement => Boolean(m))
    .sort((a, b) =>
      sortRecent ? b.updated_at.localeCompare(a.updated_at) : a.name.localeCompare(b.name)
    );

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(node.id)}>
      <CollapsibleTrigger
        className="group flex h-8 w-full items-center gap-1.5 rounded-[4px] px-2 hover:bg-white/[0.03]"
        style={{ paddingLeft: `${8 + node.depth * 14}px` }}
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <NodeIcon size={14} className="shrink-0 text-gray-500" />
        <span
          className={`min-w-0 flex-1 truncate text-left text-xs ${
            isWorkspace ? "font-medium text-[#F3F4F6]" : "text-[#F3F4F6]"
          }`}
        >
          {node.name}
        </span>
        <span className="shrink-0 text-[11px] text-[#71717a]">({subtreeCount(node)})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            byId={byId}
            sortRecent={sortRecent}
            busyIds={busyIds}
            collapsed={collapsed}
            onToggle={onToggle}
            onSelect={onSelect}
            onCompute={onCompute}
            onDelete={onDelete}
          />
        ))}
        <div style={{ paddingLeft: `${14 + node.depth * 14}px` }}>
          {items.map((m) => (
            <MeasurementRow
              key={m.id}
              m={m}
              busy={busyIds.has(m.id)}
              onSelect={onSelect}
              onCompute={onCompute}
              onDelete={onDelete}
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
  const measurementSearch = useViewerStore((s) => s.measurementSearch);
  const searchingMeasurements = useViewerStore((s) => s.searchingMeasurements);
  const drawMode = useViewerStore((s) => s.drawMode);
  const busyIds = useViewerStore((s) => s.busyIds);
  const activeToolKey = useViewerStore((s) => s.activeToolKey);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? "");
  const surveyId = useViewerStore((s) => s.surveyId);
  const setMeasurementSearch = useViewerStore((s) => s.setMeasurementSearch);
  const actions = useViewerActions();

  const [sortRecent, setSortRecent] = useState(false);
  const [completedOnly, setCompletedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<WorkspaceTreeNode[]>([]);

  // Name search runs server-side (`measurements` already reflects the query);
  // only the completed-only filter is client-side, applied BEFORE the tree
  // builds so empty folders drop out (ported MeasurementPanel behavior).
  const visible = useMemo(
    () => (completedOnly ? measurements.filter((m) => m.status === "completed") : measurements),
    [measurements, completedOnly]
  );

  // The TreeSource seam (§6.1): swap this one line for `folderApiTreeSource`
  // in 1.6 once the folders backend (1.5) is consumed.
  const source = useMemo(() => legacyFolderTreeSource(visible), [visible]);

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

  const treeEmpty = nodes.every((n) => subtreeCount(n) === 0);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col px-2 pt-2">
        <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-[0.04em] text-[#71717a]">
          Measurements
        </div>

        {/* Toolbar — quick-draw (tree:* keys, §3.5), sort, filter, collapse-all. */}
        <div className="flex items-center gap-1 px-1 pb-2">
          <ToolbarButton
            label="Draw polygon (area / volume)"
            active={activeToolKey === "tree:polygon"}
            onClick={() =>
              activeToolKey === "tree:polygon"
                ? actions.cancelDraw()
                : actions.startDraw("polygon", { toolKey: "tree:polygon" })
            }
          >
            <Hexagon size={13} />
          </ToolbarButton>
          <ToolbarButton
            label="Draw polyline (cross-section)"
            active={activeToolKey === "tree:polyline"}
            onClick={() =>
              activeToolKey === "tree:polyline"
                ? actions.cancelDraw()
                : actions.startDraw("polyline", { toolKey: "tree:polyline" })
            }
          >
            <Spline size={13} />
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
            Click the globe to add vertices. Double-click or right-click to finish.
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
                byId={byId}
                sortRecent={sortRecent}
                busyIds={busyIds}
                collapsed={collapsed}
                onToggle={toggleNode}
                onSelect={actions.selectMeasurementRow}
                onCompute={actions.triggerCompute}
                onDelete={actions.removeMeasurement}
              />
            ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
