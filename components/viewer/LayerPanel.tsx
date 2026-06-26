"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export type LayerCategory = "terrain" | "ortho" | "pointcloud" | "lens" | "vector";

export interface LayerControl {
  key: string;
  label: string;
  category: LayerCategory;
  visible: boolean;
  opacity: number; // 0..1
  supportsOpacity: boolean;
}

/** A CAD/vector design overlay (DXF, LandXML, …) from the manifest. */
export interface DesignControl {
  key: string;
  label: string;
  visible: boolean;
  renderable: boolean; // false → no geometry to draw yet (e.g. raw DXF not tiled)
}

interface LayerPanelProps {
  surveyLabel: string;
  layers: LayerControl[];
  designs: DesignControl[];
  processing: boolean;
  surveyStatus?: string;
  onToggle: (key: string) => void;
  onOpacity: (key: string, opacity: number) => void;
  onToggleDesign: (key: string) => void;
}

/** Section heading — uppercase, tracked, muted. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-4 pb-1 text-[11px] uppercase tracking-[0.04em] text-[#71717a]">
      {children}
    </div>
  );
}

/** A single toggleable layer row: checkbox + label (+ opacity on hover). */
function LayerRow({
  label,
  visible,
  supportsOpacity,
  opacity,
  disabled,
  onToggle,
  onOpacity,
}: {
  label: string;
  visible: boolean;
  supportsOpacity?: boolean;
  opacity?: number;
  disabled?: boolean;
  onToggle: () => void;
  onOpacity?: (opacity: number) => void;
}) {
  return (
    <div className="group rounded-[4px] hover:bg-white/[0.03]">
      <label
        className={`flex h-8 items-center gap-2 px-2 ${
          disabled ? "cursor-default opacity-50" : "cursor-pointer"
        }`}
      >
        <Checkbox checked={visible} disabled={disabled} onCheckedChange={onToggle} />
        <span
          className={`min-w-0 flex-1 truncate text-xs ${
            visible ? "text-[#F3F4F6]" : "text-gray-500"
          }`}
        >
          {label}
        </span>
      </label>
      {supportsOpacity && visible && onOpacity && (
        <div className="hidden px-2 pb-2 group-hover:block">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((opacity ?? 1) * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            className="h-1 w-full cursor-pointer accent-[#C97A4E]"
          />
        </div>
      )}
    </div>
  );
}

export function LayerPanel({
  surveyLabel,
  layers = [],
  designs = [],
  processing,
  surveyStatus,
  onToggle,
  onOpacity,
  onToggleDesign,
}: LayerPanelProps) {
  return (
    <div className="flex flex-col px-2">
      <SectionLabel>{surveyLabel}</SectionLabel>

      {processing && layers.length === 0 && (
        <div className="mx-2 mb-2 mt-1 flex items-start gap-2 rounded-lg border border-[#2A2D35] bg-[#1E2028]/50 p-3">
          <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-[#C97A4E]" />
          <div>
            <p className="text-xs font-medium text-gray-300">Processing survey…</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Layers appear here when processors finish
              {surveyStatus ? ` (status: ${surveyStatus})` : ""}. Checking every 30s.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col">
        {layers.map((layer) => (
          <LayerRow
            key={layer.key}
            label={layer.label}
            visible={layer.visible}
            supportsOpacity={layer.supportsOpacity}
            opacity={layer.opacity}
            onToggle={() => onToggle(layer.key)}
            onOpacity={(o) => onOpacity(layer.key, o)}
          />
        ))}
        {!processing && layers.length === 0 && (
          <p className="px-2 py-1 text-[11px] italic text-gray-600">No layers</p>
        )}
      </div>

      {designs.length > 0 && (
        <>
          <SectionLabel>Designs</SectionLabel>
          <div className="flex flex-col">
            {designs.map((d) => (
              <LayerRow
                key={d.key}
                label={d.label}
                visible={d.visible}
                disabled={!d.renderable}
                onToggle={() => onToggleDesign(d.key)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
