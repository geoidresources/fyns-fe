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
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

export type DrawMode = "polygon" | "polyline";

/** Preset carried by a draw tool: backend kind, target folder, palette label,
 * and whether the polyline readout should report a grade (slope tool). */
export interface DrawOptions {
  kind?: "volume" | "cross_section";
  folder?: string;
  label?: string;
  slope?: boolean;
}

const UNGROUPED = "Ungrouped";

interface MeasurementPanelProps {
  measurements: PanelMeasurement[];
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
  const r = m.result;
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
  drawMode,
  busyIds,
  onStartDraw,
  onCancelDraw,
  onCompute,
  onDelete,
  onSelect,
}: MeasurementPanelProps) {
  const [query, setQuery] = useState("");
  const [sortRecent, setSortRecent] = useState(false);
  const [completedOnly, setCompletedOnly] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = measurements;
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q));
    if (completedOnly) list = list.filter((m) => m.status === "completed");

    const byFolder = new Map<string, PanelMeasurement[]>();
    for (const m of list) {
      const folder = m.folder?.trim() || UNGROUPED;
      const arr = byFolder.get(folder);
      if (arr) arr.push(m);
      else byFolder.set(folder, [m]);
    }
    const entries = [...byFolder.entries()];
    if (sortRecent) {
      for (const [, arr] of entries) {
        arr.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      }
    }
    // Preserve first-appearance order (the source controls grouping order);
    // Ungrouped always sinks to the bottom.
    entries.sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return 0;
    });
    return entries;
  }, [measurements, query, completedOnly, sortRecent]);

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

        {/* Search */}
        <div className="relative mb-1 px-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search measurements..."
            className="h-7 w-full rounded-[4px] border border-white/[0.08] bg-[#19191d] pl-7 pr-2 text-[11px] text-[#F3F4F6] placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C97A4E]"
          />
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
