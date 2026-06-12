"use client";

import React from "react";
import { Hexagon, Loader2, Play, Spline, Trash2, X } from "lucide-react";
import type { Measurement } from "@/lib/api/assetSvc";

export type DrawMode = "polygon" | "polyline";

interface MeasurementPanelProps {
  measurements: Measurement[];
  drawMode: DrawMode | null;
  busyIds: Set<string>;
  onStartDraw: (mode: DrawMode) => void;
  onCancelDraw: () => void;
  onCompute: (id: string) => void;
  onDelete: (id: string) => void;
}

const METRIC_LABELS: Record<string, string> = {
  volume_m3: "Volume (m³)",
  adjusted_volume_m3: "Adj. volume (m³)",
  area_m2: "Area (m²)",
  tonnage_t: "Tonnage (t)",
  cut_volume_m3: "Cut (m³)",
  fill_volume_m3: "Fill (m³)",
  net_change_m3: "Net change (m³)",
  length_m: "Length (m)",
};

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-400 border border-green-500/20";
    case "computing":
      return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
    case "failed":
      return "bg-red-500/10 text-red-400 border border-red-500/20";
    default:
      return "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20";
  }
}

export function MeasurementPanel({
  measurements,
  drawMode,
  busyIds,
  onStartDraw,
  onCancelDraw,
  onCompute,
  onDelete,
}: MeasurementPanelProps) {
  return (
    <div className="flex flex-col border-t border-[#1E2028]">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 tracking-wider uppercase">Measurements</h3>
      </div>

      {/* Toolbar */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <button
          onClick={() => (drawMode === "polygon" ? onCancelDraw() : onStartDraw("polygon"))}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border transition-colors ${
            drawMode === "polygon"
              ? "bg-[#C97A4E] text-[#0A0D14] border-[#C97A4E] font-medium"
              : "bg-[#1E2028]/50 text-gray-300 border-[#2A2D35] hover:border-[#3A3D45]"
          }`}
        >
          <Hexagon size={13} />
          Polygon
        </button>
        <button
          onClick={() => (drawMode === "polyline" ? onCancelDraw() : onStartDraw("polyline"))}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border transition-colors ${
            drawMode === "polyline"
              ? "bg-[#C97A4E] text-[#0A0D14] border-[#C97A4E] font-medium"
              : "bg-[#1E2028]/50 text-gray-300 border-[#2A2D35] hover:border-[#3A3D45]"
          }`}
        >
          <Spline size={13} />
          Polyline
        </button>
        {drawMode && (
          <button
            onClick={onCancelDraw}
            className="text-gray-500 hover:text-gray-200 transition-colors"
            title="Cancel drawing"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {drawMode && (
        <p className="px-4 pb-3 text-[11px] text-gray-500">
          Click on the globe to add vertices. Double-click or right-click to finish.
        </p>
      )}

      <div className="flex flex-col gap-2 px-3 pb-4 overflow-y-auto">
        {measurements.length === 0 && (
          <p className="px-1 text-[11px] text-gray-600 italic">No measurements yet — draw one above.</p>
        )}
        {measurements.map((m) => {
          const busy = busyIds.has(m.id);
          return (
            <div key={m.id} className="p-2.5 rounded-lg bg-[#1E2028]/50 border border-[#2A2D35]">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-200 truncate">{m.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(m.status === "draft" || m.status === "failed") && (
                    <button
                      onClick={() => onCompute(m.id)}
                      disabled={busy}
                      className="text-gray-500 hover:text-[#C97A4E] transition-colors disabled:opacity-50"
                      title="Compute"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(m.id)}
                    disabled={busy}
                    className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">{m.kind}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${statusBadge(m.status)}`}>
                  {m.status === "computing" ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 size={9} className="animate-spin" />
                      computing
                    </span>
                  ) : (
                    m.status
                  )}
                </span>
              </div>
              {m.status === "failed" && (
                <p className="text-[10px] text-red-400/80 mt-1">Compute failed — retry or check inputs.</p>
              )}
              {m.result && Object.keys(m.result).length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {Object.entries(m.result).map(([k, v]) => (
                    <div key={k} className="bg-[#12141A] rounded px-1.5 py-1">
                      <div className="text-[9px] text-gray-500 truncate">{METRIC_LABELS[k] || k}</div>
                      <div className="text-[11px] text-gray-200 font-medium">
                        {typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
