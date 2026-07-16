"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpDown,
  ChevronRight,
  Filter,
  Folder,
  FoldVertical,
  Hexagon,
  Loader2,
  Play,
  Search,
  Spline,
  Trash2,
} from "lucide-react";
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
import type { Measurement } from "@/lib/api/assetSvc";
import { metricsOf } from "@/lib/viewer/calc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

export type DrawMode = "polygon" | "polyline";

/** Preset carried by a draw tool: backend kind, compute params, target folder,
 * palette label, whether the polyline readout should report a grade (slope
 * tool), and the namespaced key of the toolbar button that launched it (so
 * exactly that one button highlights — multiple toolbars are on screen at
 * once).
 *
 * `params` carries pre-filled SurfaceRefs so a template lands its compute
 * inputs at draw time (template seam, viewer-shell §3.3/§4.3).
 *
 * `kind` is the full `Measurement["kind"]` (§3.3/§4.3) so template ids like
 * `cut_fill`/`contour`/`tin` flow through `startDraw`. Widened in task 1.3c once
 * SurveyViewer — which pinned `const kind: "volume" | "cross_section"` at its
 * :1737 — was deleted, unblocking the template seam. */
export interface DrawOptions {
  kind?: Measurement["kind"];
  params?: Record<string, unknown>;
  folder?: string;
  label?: string;
  slope?: boolean;
  toolKey?: string;
}

const UNGROUPED = "Ungrouped";

interface MeasurementPanelProps {
  measurements: PanelMeasurement[];
  /** Search box value + change handler. Name matching runs server-side
   * (asset-svc `?search=`) — the parent debounces and refetches. */
  query: string;
  onQueryChange: (value: string) => void;
  /** A server-side search fetch is in flight (drives the input spinner). */
  searching?: boolean;
  drawMode: DrawMode | null;
  busyIds: Set<string>;
  onStartDraw: (mode: DrawMode, opts?: DrawOptions) => void;
  onCancelDraw: () => void;
  onCompute: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (m: PanelMeasurement) => void;
}

/** Single-line row label, e.g. "SP-01 · limestone · 14,820 m³" (demo content
 * is pre-formatted into the name) or "<name> · 14,820 m³" for real results.
 * total_* keys are what the stockpile compute actually emits; the bare keys
 * cover client-side plan stats and future per-pile results. */
function measurementLabel(m: PanelMeasurement): string {
  if (m.demo) return m.name;
  const r = metricsOf(m.result); // unwraps the v1 result doc; legacy flat rows pass through

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (r) {
    const volume = r.total_volume_m3 ?? r.total_adjusted_volume_m3 ?? r.volume_m3 ?? r.adjusted_volume_m3;
    if (typeof volume === "number") return `${m.name} · ${fmt(volume)} m³`;
    if (typeof r.area_m2 === "number") return `${m.name} · ${fmt(r.area_m2)} m²`;
    const length = r.profile_length_m ?? r.length_m;
    if (typeof length === "number") return `${m.name} · ${fmt(length)} m`;
  }
  return m.name;
}

/** Small status dot reflecting compute state. */
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

export function MeasurementPanel({
  measurements,
  query,
  onQueryChange,
  searching,
  drawMode,
  busyIds,
  onStartDraw,
  onCancelDraw,
  onCompute,
  onDelete,
  onSelect,
}: MeasurementPanelProps) {
  const [sortRecent, setSortRecent] = useState(false);
  const [completedOnly, setCompletedOnly] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // Name search runs server-side; `measurements` already reflects the query.
  // Only the completed-only filter, folder grouping and sort stay client-side.
  const groups = useMemo(() => {
    let list = measurements;
    if (completedOnly) list = list.filter((m) => m.status === "completed");

    const byFolder = new Map<string, PanelMeasurement[]>();
    for (const m of list) {
      const folder = m.folder?.trim() || UNGROUPED;
      const arr = byFolder.get(folder);
      if (arr) arr.push(m);
      else byFolder.set(folder, [m]);
    }
    const entries = [...byFolder.entries()];
    // Default ("Sorting by name") sorts alphabetically; the toggle switches to
    // most-recently-updated first. Without the name branch the default just
    // preserved source order, so the "by name" label was a lie.
    for (const [, arr] of entries) {
      arr.sort((a, b) =>
        sortRecent
          ? b.updated_at.localeCompare(a.updated_at)
          : a.name.localeCompare(b.name)
      );
    }
    // Preserve first-appearance order (the source controls grouping order);
    // Ungrouped always sinks to the bottom.
    entries.sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return 0;
    });
    return entries;
  }, [measurements, completedOnly, sortRecent]);

  const allCollapsed = groups.length > 0 && collapsedFolders.size >= groups.length;

  const toggleAll = () => {
    setCollapsedFolders(allCollapsed ? new Set() : new Set(groups.map(([f]) => f)));
  };

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col px-2 pt-2">
        <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-[0.04em] text-[#71717a]">
          Measurements
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-1 pb-2">
          <ToolbarButton
            label="Draw polygon (area / volume)"
            active={drawMode === "polygon"}
            onClick={() => (drawMode === "polygon" ? onCancelDraw() : onStartDraw("polygon"))}
          >
            <Hexagon size={13} />
          </ToolbarButton>
          <ToolbarButton
            label="Draw polyline (cross-section)"
            active={drawMode === "polyline"}
            onClick={() => (drawMode === "polyline" ? onCancelDraw() : onStartDraw("polyline"))}
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

        {/* Search — matching runs server-side; the parent debounces + refetches. */}
        <div className="relative mb-1 px-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search measurements..."
            className="h-7 w-full rounded-[4px] border border-white/[0.08] bg-[#19191d] pl-7 pr-7 text-[11px] text-[#F3F4F6] placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C97A4E]"
          />
          {searching && (
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

        {/* Folder groups */}
        <div className="flex flex-col pb-2">
          {groups.length === 0 && (
            <p className="px-2 py-1 text-[11px] italic text-gray-600">
              {query || completedOnly ? "No matching measurements." : "No measurements yet — draw one above."}
            </p>
          )}

          {groups.map(([folder, items]) => {
            const open = !collapsedFolders.has(folder);
            return (
              <Collapsible key={folder} open={open} onOpenChange={() => toggleFolder(folder)}>
                <CollapsibleTrigger className="group flex h-8 w-full items-center gap-1.5 rounded-[4px] px-2 hover:bg-white/[0.03]">
                  <ChevronRight
                    size={14}
                    className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <Folder size={14} className="shrink-0 text-gray-500" />
                  <span className="min-w-0 flex-1 truncate text-left text-xs text-[#F3F4F6]">
                    {folder}
                  </span>
                  <span className="shrink-0 text-[11px] text-[#71717a]">({items.length})</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6">
                  {items.map((m) => {
                    const busy = busyIds.has(m.id);
                    const canCompute = m.status === "draft" || m.status === "failed";
                    const showDot = !m.demo && m.status !== "completed";
                    return (
                      <div
                        key={m.id}
                        className="group flex h-7 items-center gap-2 rounded-[4px] px-2 hover:bg-white/[0.03]"
                      >
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
                                {busy ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Play size={12} />
                                )}
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
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
