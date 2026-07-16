"use client";

// Shared base-surface method editor (RE-PIVOT wiring) — the "how" of a volume
// calculation, rendered by BOTH the drawing-time Calculation panel
// (MeasurePalette) and the FeatureInspector's editable config. One component so
// the two never diverge (the teardown's §2 "type is mutable after creation"
// depends on the same knobs pre- and post-save). State is CONTROLLED — hosts
// own it (store-backed in the palette, local-edit in the inspector) and receive
// patches via onChange.
//
// Method semantics per docs/contracts/surface-ref.md §3.1 (see lib/viewer/calc):
// reference-rl takes elevation_m XOR derive lowest/highest vertex; design needs
// a design_id (picker fed by listDesigns); previous-survey resolves server-side
// to the chronologically previous survey; custom-base awaits its vertex editor.

import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { listDesigns, type DesignRecord } from "@/lib/api/assetSvc";
import { VOLUME_METHODS, type CalcMethodState, type RefMode } from "@/lib/viewer/calc";

const REF_MODES: { id: RefMode; label: string }[] = [
  { id: "lowest_vertex", label: "Lowest boundary point" },
  { id: "highest_vertex", label: "Highest boundary point" },
  { id: "custom", label: "Custom elevation" },
];

export function CalcConfig({
  value,
  onChange,
  projectId,
  idPrefix = "calc",
}: {
  value: CalcMethodState;
  onChange: (patch: Partial<CalcMethodState>) => void;
  /** For the design picker; null hides the list (no manifest yet). */
  projectId: string | null;
  /** Keeps radio input ids unique when two hosts are mounted at once. */
  idPrefix?: string;
}) {
  // Designs load lazily the first time the design-surface method is picked.
  const [designs, setDesigns] = useState<DesignRecord[] | null>(null);
  const [designsError, setDesignsError] = useState<string | null>(null);
  const wantDesigns = value.method === "design-surface" && projectId !== null;

  useEffect(() => {
    if (!wantDesigns || designs !== null || designsError !== null) return;
    let cancelled = false;
    listDesigns(projectId!)
      .then((res) => {
        if (!cancelled) setDesigns(res.designs ?? []);
      })
      .catch((err) => {
        if (!cancelled) setDesignsError(err instanceof Error ? err.message : "Failed to load designs");
      });
    return () => {
      cancelled = true;
    };
  }, [wantDesigns, designs, designsError, projectId]);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-gray-400 mb-2 block">Base surface</Label>
        <RadioGroup
          value={value.method}
          onValueChange={(method) => onChange({ method })}
          className="gap-1"
        >
          {VOLUME_METHODS.map((item) => {
            const disabled = item.id === "custom-base";
            return (
              <div key={item.id} className="flex items-center space-x-2">
                <RadioGroupItem value={item.id} id={`${idPrefix}-${item.id}`} disabled={disabled} />
                <Label
                  htmlFor={`${idPrefix}-${item.id}`}
                  className={`font-normal ${disabled ? "text-gray-600" : "text-gray-300"}`}
                >
                  {item.label}
                  {disabled && <span className="ml-1.5 text-[10px] text-gray-600">later phase</span>}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </div>

      {value.method === "reference-rl" && (
        <div className="space-y-2 rounded-md border border-white/[0.06] bg-[#19191d] p-2.5">
          <Label className="text-[11px] text-gray-400 block">Reference level</Label>
          <RadioGroup
            value={value.refMode}
            onValueChange={(refMode) => onChange({ refMode: refMode as RefMode })}
            className="gap-1"
          >
            {REF_MODES.map((m) => (
              <div key={m.id} className="flex items-center space-x-2">
                <RadioGroupItem value={m.id} id={`${idPrefix}-ref-${m.id}`} />
                <Label htmlFor={`${idPrefix}-ref-${m.id}`} className="text-xs font-normal text-gray-300">
                  {m.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {value.refMode === "custom" && (
            <Input
              type="number"
              step="0.01"
              placeholder="Elevation (m, site datum)"
              value={value.refElevation ?? ""}
              onChange={(e) =>
                onChange({ refElevation: e.target.value === "" ? null : Number(e.target.value) })
              }
              className="h-8 bg-[#16181D] border-white/5 text-xs"
            />
          )}
        </div>
      )}

      {value.method === "previous-survey" && (
        <p className="rounded-md border border-white/[0.06] bg-[#19191d] p-2.5 text-[11px] text-gray-500">
          Compares against the chronologically previous survey of this project — resolved
          automatically when the compute runs.
        </p>
      )}

      {value.method === "design-surface" && (
        <div className="space-y-1.5 rounded-md border border-white/[0.06] bg-[#19191d] p-2.5">
          <Label className="text-[11px] text-gray-400 block">Design surface</Label>
          {designsError ? (
            <p className="text-[11px] text-red-400">{designsError}</p>
          ) : designs === null ? (
            <p className="text-[11px] text-gray-500">Loading designs…</p>
          ) : designs.length === 0 ? (
            <p className="text-[11px] text-gray-500">No designs uploaded to this project yet.</p>
          ) : (
            <select
              aria-label="Design surface"
              value={value.baseDesignId ?? ""}
              onChange={(e) => onChange({ baseDesignId: e.target.value || null })}
              className="w-full rounded-md border border-white/5 bg-[#16181D] px-2 py-1.5 text-xs text-gray-200"
            >
              <option value="">Pick a design…</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
