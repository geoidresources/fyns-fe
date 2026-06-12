"use client";

import React from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export type LayerCategory = "terrain" | "ortho" | "pointcloud" | "lens" | "vector";

export interface LayerControl {
  key: string;
  label: string;
  category: LayerCategory;
  visible: boolean;
  opacity: number; // 0..1
  supportsOpacity: boolean;
}

interface LayerPanelProps {
  layers: LayerControl[];
  processing: boolean;
  surveyStatus?: string;
  onToggle: (key: string) => void;
  onOpacity: (key: string, opacity: number) => void;
}

const CATEGORY_ORDER: { category: LayerCategory; title: string }[] = [
  { category: "ortho", title: "ORTHOMOSAIC" },
  { category: "terrain", title: "TERRAIN" },
  { category: "pointcloud", title: "POINT CLOUD" },
  { category: "lens", title: "LENSES" },
  { category: "vector", title: "VECTORS" },
];

export function LayerPanel({ layers, processing, surveyStatus, onToggle, onOpacity }: LayerPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-xs font-semibold text-gray-500 tracking-wider uppercase">Layers</h3>
      </div>

      {processing && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-[#1E2028]/50 border border-[#2A2D35] flex items-start gap-2">
          <Loader2 size={14} className="text-[#C97A4E] animate-spin mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-gray-300 font-medium">Processing survey…</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Layers will appear here when processors finish
              {surveyStatus ? ` (status: ${surveyStatus})` : ""}. Checking every 30s.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 px-2 pb-3">
        {CATEGORY_ORDER.map(({ category, title }) => {
          const group = layers.filter((l) => l.category === category);
          return (
            <div key={category} className="px-2 py-1">
              <div className="text-[10px] font-semibold text-gray-600 tracking-wider mb-1">{title}</div>
              {group.length === 0 ? (
                <div className="text-[11px] text-gray-600 italic pb-1">
                  {processing ? "processing…" : "none"}
                </div>
              ) : (
                group.map((layer) => (
                  <div key={layer.key} className="py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs truncate ${layer.visible ? "text-gray-200" : "text-gray-500"}`}>
                        {layer.label}
                      </span>
                      <button
                        onClick={() => onToggle(layer.key)}
                        className="text-gray-500 hover:text-gray-200 transition-colors shrink-0"
                        title={layer.visible ? "Hide layer" : "Show layer"}
                      >
                        {layer.visible ? <Eye size={14} className="text-[#C97A4E]" /> : <EyeOff size={14} />}
                      </button>
                    </div>
                    {layer.supportsOpacity && layer.visible && (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(layer.opacity * 100)}
                        onChange={(e) => onOpacity(layer.key, Number(e.target.value) / 100)}
                        className="w-full h-1 mt-1.5 accent-[#C97A4E] cursor-pointer"
                      />
                    )}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
