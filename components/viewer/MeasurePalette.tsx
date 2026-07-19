"use client";

// import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { CalcConfig } from "@/components/viewer/CalcConfig";
import { calcTypesFor, coerceMethodForKind } from "@/lib/viewer/calc";
import { useViewerStore } from "@/lib/viewer/state/store";
import { formatArea, formatDistance, type LngLatHeight } from "@/lib/viewer/measure";

// The right-panel CALCULATION module (RE-PIVOT 2026-07-16). The geometry tool
// grid that used to live here moved to the FloatingToolbar; this panel is
// "what to compute and how" over whatever geometry the toolbar started: a
// calculation-type picker contextual to the active primitive (lib/viewer/calc
// CALC_TYPES — persisted as the measurement's kind at save), the live readout,
// and — for volume-type calculations — the shared CalcConfig base-surface
// editor whose choices become params.from/params.to SurfaceRefs at save
// (ViewerCanvas.saveMeasurement). Calc state lives in store.view so the save
// path reads the same source of truth this panel edits.

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

// Back-compat re-export — VOLUME_METHODS moved to lib/viewer/calc.ts.
export { VOLUME_METHODS } from "@/lib/viewer/calc";

function ReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="tabular-nums text-gray-100">{value}</span>
    </p>
  );
}

export function MeasurePalette({
  readout,
  onClose,
  onCollapse,
  collapsed = false,
}: {
  readout: LiveReadout;
  onClose: () => void;
  onCollapse?: () => void;
  /** When true, only the title row is shown (panel chrome stays mounted). */
  collapsed?: boolean;
}) {
  const view = useViewerStore((s) => s.view);
  const setView = useViewerStore((s) => s.setView);
  const projectId = useViewerStore((s) => s.manifest?.survey.project_id ?? null);
  const activeToolKey = useViewerStore((s) => s.activeToolKey);
  const awaitingCalc = readout.mode !== "idle" && readout.mode !== "probe" && !activeToolKey;

  const types = calcTypesFor(readout.mode);
  // The stored pick, reconciled to the current geometry: a stale pick from
  // another primitive falls back to the mode's first (default) calc.
  const selectedType = types.find((t) => t.id === view.calcType) ?? types[0] ?? null;

  return (
    <div
      className={`flex flex-col text-sm text-gray-200 p-3 ${collapsed ? "" : "h-full gap-4"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate font-semibold text-base text-gray-100">Calculation</h3>
        <div className="flex shrink-0 items-center">
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? "Expand panel" : "Collapse panel"}
              aria-expanded={!collapsed}
              onClick={onCollapse}
              className="text-gray-400"
            >
              {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400">
            <X size={18} />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
      {/* What to compute — contextual to the geometry the toolbar started. */}
      <div>
        <Label className="text-xs text-gray-400 mb-2 block">What to compute</Label>
        {types.length === 0 ? (
          <p className="text-xs text-gray-500">
            Pick a tool in the toolbar and draw on the site to choose a calculation.
          </p>
        ) : (
          <>
            <RadioGroup
              value={selectedType?.id}
              onValueChange={(calcType) => setView({ calcType })}
              className="gap-1.5"
            >
              {types.map((t) => (
                <div key={t.id} className="flex items-start space-x-2">
                  <RadioGroupItem value={t.id} id={`ct-${t.id}`} className="mt-0.5" />
                  <Label htmlFor={`ct-${t.id}`} className="flex flex-col gap-0.5 font-normal">
                    <span className="text-gray-200">{t.label}</span>
                    <span className="text-[11px] text-gray-500">{t.hint}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="mt-2 text-[11px] text-gray-500">
              {awaitingCalc
                ? "Double-click the drawing to calculate, or press Esc to discard."
                : "Right-click when ready to choose a calculation. Esc discards."}
            </p>
          </>
        )}
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

      {/* How — the shared base-surface editor, only for volume-type calcs. The
          picked method + inputs become params.from/params.to at save. */}
      {selectedType?.needsBase && (
        <CalcConfig
          idPrefix="palette"
          kind={selectedType.kind}
          projectId={projectId}
          value={coerceMethodForKind(
            {
              method: view.volumeMethod,
              refMode: view.refMode,
              refElevation: view.refElevation,
              baseDesignId: view.baseDesignId,
            },
            selectedType.kind
          )}
          onChange={(patch) => {
            const { method, ...rest } = patch;
            setView(method !== undefined ? { ...rest, volumeMethod: method } : rest);
          }}
        />
      )}
        </>
      )}
    </div>
  );
}
