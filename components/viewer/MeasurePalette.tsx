"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  AreaChart,
  Circle,
  Minus,
  MousePointer,
  Pentagon,
  Scissors,
  X,
} from "lucide-react";

import type { DrawMode, DrawOptions } from "@/components/viewer/MeasurementPanel";
import { formatArea, formatDistance, type LngLatHeight } from "@/lib/viewer/measure";

// The Measure palette from the design (§7.2): a functional tool grid, a live
// readout that updates while vertices are placed, and the volume-method
// selector persisted into the measurement's compute params.

/** Live values computed by the viewer while a tool is active. */
export interface LiveReadout {
  mode: "idle" | "probe" | "polyline" | "polygon";
  vertexCount: number;
  lengthMeters?: number;
  areaSquareMeters?: number;
  perimeterMeters?: number;
  gradePercent?: number;
  point?: LngLatHeight | null;
}

export const VOLUME_METHODS = [
  { id: "smart-base", label: "Smart base" },
  { id: "reference-rl", label: "Reference RL" },
  { id: "previous-survey", label: "Previous survey" },
  { id: "design-surface", label: "Design surface" },
  { id: "custom-base", label: "Custom base" },
] as const;

type PaletteToolId = "point" | "line" | "polygon" | "section" | "probe" | "slope";

interface PaletteTool {
  id: PaletteToolId;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  probe?: boolean;
  draw?: DrawMode;
  opts?: DrawOptions;
}

const TOOLS: PaletteTool[] = [
  { id: "point", icon: MousePointer, label: "Point", probe: true },
  { id: "line", icon: Minus, label: "Line", draw: "polyline", opts: { label: "Line" } },
  { id: "polygon", icon: Pentagon, label: "Polygon", draw: "polygon", opts: { label: "Polygon" } },
  { id: "section", icon: Scissors, label: "Section", draw: "polyline", opts: { label: "Section" } },
  { id: "probe", icon: Circle, label: "Probe", probe: true },
  { id: "slope", icon: AreaChart, label: "Slope", draw: "polyline", opts: { label: "Slope", slope: true } },
];

interface MeasurePaletteProps {
  activeToolKey: string | null;
  readout: LiveReadout;
  volumeMethod: string;
  onVolumeMethod: (method: string) => void;
  onStartDraw: (mode: DrawMode, opts?: DrawOptions) => void;
  onStartProbe: (toolKey?: string) => void;
  onClose: () => void;
}

// Namespaced so this palette's buttons never collide with the tool rail or the
// top draw toolbar in the shared activeToolKey.
const keyFor = (id: PaletteToolId) => `palette:${id}`;

function ReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="tabular-nums text-gray-100">{value}</span>
    </p>
  );
}

export function MeasurePalette({
  activeToolKey,
  readout,
  volumeMethod,
  onVolumeMethod,
  onStartDraw,
  onStartProbe,
  onClose,
}: MeasurePaletteProps) {
  const handle = (t: PaletteTool) => {
    // Re-clicking the active tool cancels it — starting the same draw again
    // would call startDraw and discard the in-progress vertices.
    if (activeToolKey === keyFor(t.id)) {
      onClose();
      return;
    }
    if (t.probe) onStartProbe(keyFor(t.id));
    else if (t.draw) onStartDraw(t.draw, { ...t.opts, toolKey: keyFor(t.id) });
  };

  return (
    <div className="h-full flex flex-col text-sm text-gray-200 p-3 gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base text-gray-100">Measure</h3>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400">
          <X size={18} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TOOLS.map((t) => {
          const active = activeToolKey === keyFor(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handle(t)}
              aria-pressed={active}
              className={`rounded-md border p-3 flex flex-col items-center justify-center gap-2 transition-colors ${
                active
                  ? "border-[#C97A4E]/60 bg-[#C97A4E]/[0.12] text-[#C97A4E]"
                  : "bg-[#19191d] border-white/[0.08] hover:bg-white/5"
              }`}
            >
              <t.icon size={20} className={active ? "text-[#C97A4E]" : "text-gray-400"} />
              <span className={`text-xs ${active ? "text-[#C97A4E]" : "text-gray-300"}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="bg-[#19191d] border-white/[0.08]">
        <CardHeader className="p-3">
          <CardTitle className="text-xs font-medium text-gray-400">Live readout</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-1 text-xs text-gray-200">
          {readout.mode === "idle" && (
            <p className="text-gray-500">Pick a tool, then click the site to start.</p>
          )}

          {readout.mode === "probe" &&
            (readout.point ? (
              <>
                <ReadoutRow label="Latitude" value={`${readout.point.latitude.toFixed(6)}°`} />
                <ReadoutRow label="Longitude" value={`${readout.point.longitude.toFixed(6)}°`} />
                <ReadoutRow label="Elevation" value={`${readout.point.height.toFixed(2)} m`} />
              </>
            ) : (
              <p className="text-gray-500">Click the site to sample a point.</p>
            ))}

          {readout.mode === "polyline" && (
            <>
              <ReadoutRow label="Length" value={formatDistance(readout.lengthMeters)} />
              {readout.gradePercent !== undefined && (
                <ReadoutRow label="Grade" value={`${readout.gradePercent.toFixed(1)} %`} />
              )}
              <ReadoutRow label="Vertices" value={String(readout.vertexCount)} />
            </>
          )}

          {readout.mode === "polygon" && (
            <>
              <ReadoutRow label="Area" value={formatArea(readout.areaSquareMeters)} />
              <ReadoutRow label="Perimeter" value={formatDistance(readout.perimeterMeters)} />
              <ReadoutRow label="Vertices" value={String(readout.vertexCount)} />
              <p className="pt-1 text-[11px] text-gray-500">
                Volume: — m³ · computed after save
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div>
        <Label className="text-xs text-gray-400 mb-2 block">Volume method</Label>
        <RadioGroup value={volumeMethod} onValueChange={onVolumeMethod} className="gap-1">
          {VOLUME_METHODS.map((item) => (
            <div key={item.id} className="flex items-center space-x-2">
              <RadioGroupItem value={item.id} id={item.id} />
              <Label htmlFor={item.id} className="text-gray-300 font-normal">
                {item.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
