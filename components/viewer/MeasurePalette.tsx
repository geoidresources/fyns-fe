"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// The Measure palette from the design (§7.2): a functional tool grid, a template
// selector, a live readout that updates while vertices are placed, the
// volume-method selector, the stockpile factor inputs, and the calculated
// outputs — all persisted into the measurement's compute params.

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

/** Measurement presets. `stockpile` surfaces the factor inputs + outputs;
 * `cross_section` hides them (a polyline has no volume). */
export const MEASURE_TEMPLATES = [
  { id: "stockpile", label: "Stockpile", volumetric: true },
  { id: "volume", label: "Volume", volumetric: true },
  { id: "cross_section", label: "Cross-section", volumetric: false },
] as const;

/** Stockpile factor inputs, held as strings so decimals type cleanly; parsed at
 * save time. Values mirror the design's default preset. */
export interface StockpileFactors {
  moisture: string; // %
  grade: string; // quality/saleable multiplier
  swell: string; // bulking multiplier (1.15 = +15%)
  compaction: string; // placed-volume multiplier
}

export const DEFAULT_STOCKPILE_FACTORS: StockpileFactors = {
  moisture: "8.5",
  grade: "1.0",
  swell: "1.15",
  compaction: "0.85",
};

/** One computed-output row for the Calculated outputs card. */
export interface MeasureOutput {
  label: string;
  value: string;
}

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

const FACTOR_FIELDS: { key: keyof StockpileFactors; label: string }[] = [
  { key: "moisture", label: "Moisture %" },
  { key: "grade", label: "Grade/quality factor" },
  { key: "swell", label: "Swell factor" },
  { key: "compaction", label: "Compaction factor" },
];

/** The rows the Calculated outputs card renders. Values come from the computed
 * result; before compute every row shows an em dash. */
const OUTPUT_ROWS = [
  "In-situ volume",
  "Adjusted volume",
  "Compacted volume",
  "Tonnage",
  "Dry tonnage",
  "Saleable tonnage",
] as const;

interface MeasurePaletteProps {
  activeToolKey: string | null;
  readout: LiveReadout;
  template: string;
  onTemplate: (template: string) => void;
  volumeMethod: string;
  onVolumeMethod: (method: string) => void;
  factors: StockpileFactors;
  onFactor: (key: keyof StockpileFactors, value: string) => void;
  /** Computed outputs (empty until the measurement is saved + computed). */
  outputs?: MeasureOutput[];
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
  template,
  onTemplate,
  volumeMethod,
  onVolumeMethod,
  factors,
  onFactor,
  outputs,
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

  const volumetric =
    MEASURE_TEMPLATES.find((t) => t.id === template)?.volumetric ?? true;
  const outputByLabel = new Map((outputs ?? []).map((o) => [o.label, o.value]));

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

      <div>
        <Label className="text-xs text-gray-400 mb-2 block">Template</Label>
        <Select value={template} onValueChange={onTemplate}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEASURE_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {volumetric && (
        <>
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

          {template === "stockpile" &&
            FACTOR_FIELDS.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`factor-${f.key}`} className="text-xs text-gray-400 mb-2 block">
                  {f.label}
                </Label>
                <Input
                  id={`factor-${f.key}`}
                  inputMode="decimal"
                  value={factors[f.key]}
                  onChange={(e) => onFactor(f.key, e.target.value)}
                  className="bg-[#19191d] border-white/[0.08] font-mono"
                />
              </div>
            ))}

          <Card className="bg-[#19191d] border-white/[0.08]">
            <CardHeader className="p-3">
              <CardTitle className="text-xs font-medium text-gray-400">Calculated outputs</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-1 text-xs text-gray-200">
              {OUTPUT_ROWS.map((label) => (
                <ReadoutRow key={label} label={label} value={outputByLabel.get(label) ?? "—"} />
              ))}
              {outputByLabel.size === 0 && (
                <p className="pt-1 text-[11px] text-gray-500">
                  Populated after you save &amp; run compute.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
