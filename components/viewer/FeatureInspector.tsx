"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";
import type { Measurement } from "@/lib/api/assetSvc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";
import { geometryLocalStats } from "@/lib/viewer/measure";
import { CalcConfig } from "@/components/viewer/CalcConfig";
import {
  CalcParamsError,
  DEFAULT_METHOD_STATE,
  isVolumeKind,
  methodFromParams,
  metricsOf,
  provenanceOf,
  resultErrorOf,
  surfaceRefsForMethod,
  type CalcMethodState,
} from "@/lib/viewer/calc";

// Right contextual inspector (§7.1). Three modes:
//  - a freshly drawn shape being named (isNew) — local plan stats + save;
//  - a saved measurement — real status + computed result metrics, the failure
//    reason when compute failed, an editable base-method config (teardown §2:
//    "type is mutable after creation") whose edits ride the compute override,
//    and the provenance "receipt" of the last run;
//  - a picked map feature (GeoJSON vector / 3D-tiles feature) — the property
//    inspector ported from rendering-engine-fe's InspectorPanel.

interface FeatureInspectorProps {
  measurement: Measurement | PanelMeasurement | null;
  /** Property bag of a non-measurement feature picked on the map. */
  feature?: Record<string, unknown> | null;
  /** For the design picker in the editable calc config. */
  projectId?: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
  onDelete?: (id: string) => void;
  onCompute?: (id: string, override?: Record<string, unknown>) => void;
  isNew: boolean;
  saving: boolean;
  /** A compute/delete request for this measurement is in flight. */
  busy?: boolean;
}

// The total_*/delta_*/profile_* keys are what the compute processors actually
// emit into measurement.result (stockpile-inventory, cut-fill, profile-extract);
// the bare keys cover the client-side plan stats and per-pile analytics.
const METRIC_LABELS: [key: string, label: string, unit: string][] = [
  ["total_volume_m3", "Volume", "m³"],
  ["total_adjusted_volume_m3", "Adj. volume", "m³"],
  ["total_tonnage_t", "Tonnage", "t"],
  ["delta_volume_m3", "Δ volume", "m³"],
  ["delta_tonnage_t", "Δ tonnage", "t"],
  ["active_pile_count", "Piles", ""],
  ["volume_m3", "Volume", "m³"],
  ["adjusted_volume_m3", "Adj. volume", "m³"],
  ["tonnage_t", "Tonnage", "t"],
  ["area_m2", "Area", "m²"],
  ["perimeter_m", "Perimeter", "m"],
  ["length_m", "Length", "m"],
  ["grade_percent", "Grade", "%"],
  ["cut_volume_m3", "Cut", "m³"],
  ["fill_volume_m3", "Fill", "m³"],
  ["net_change_m3", "Net change", "m³"],
  ["total_moved_m3", "Moved", "m³"],
  ["profile_length_m", "Profile length", "m"],
  ["profile_point_count", "Samples", ""],
];

function formatMetric(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 10 ? 1 : 0;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "haul_distance_m" → "Haul distance m" for result keys we don't know. */
function prettifyKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function resultMetrics(result: Record<string, number>): { label: string; value: string }[] {
  const metrics: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const [key, label, unit] of METRIC_LABELS) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics.push({ label, value: `${formatMetric(value)} ${unit}` });
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(result)) {
    if (seen.has(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
    metrics.push({ label: prettifyKey(key), value: formatMetric(value) });
  }
  return metrics;
}

function StatusChip({ status, demo }: { status: string; demo?: boolean }) {
  if (demo) {
    return (
      <span className="inline-flex items-center rounded-md bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/20">
        Approved
      </span>
    );
  }
  const styles: Record<string, string> = {
    completed: "bg-green-500/10 text-green-400 ring-green-500/20",
    computing: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
    failed: "bg-red-500/10 text-red-400 ring-red-500/20",
    draft: "bg-gray-400/10 text-gray-400 ring-gray-400/20",
  };
  const style = styles[status] ?? styles.draft;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {status === "computing" && <Loader2 size={11} className="animate-spin" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function MetricsGrid({ metrics }: { metrics: { label: string; value: string }[] }) {
  return (
    <div className="bg-[#19191d] p-3 rounded-lg grid grid-cols-2 gap-3">
      {metrics.map((m) => (
        <div key={m.label}>
          <div className="text-gray-500 text-xs">{m.label}</div>
          <div className="tabular-nums">{m.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Property inspector for a picked, non-measurement map feature. */
function PickedFeatureView({
  feature,
  onClose,
}: {
  feature: Record<string, unknown>;
  onClose: () => void;
}) {
  const entries = Object.entries(feature).filter(
    ([key, value]) =>
      !key.startsWith("_") && (typeof value !== "object" || value === null)
  );

  return (
    <div className="h-full flex flex-col text-sm text-gray-200 p-3 gap-3 min-h-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Selected feature</p>
          <h3 className="truncate font-semibold text-base text-gray-100">
            {String(feature.name ?? feature.id ?? "Unnamed feature")}
          </h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 text-gray-400">
          <X size={18} />
        </Button>
      </div>

      <span className="self-start rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {String(feature._source ?? "feature")}
      </span>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        <div className="rounded-lg bg-[#19191d] p-3 space-y-1.5">
          {entries.length === 0 && (
            <p className="text-xs text-gray-500">No feature properties.</p>
          )}
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="shrink-0 text-gray-500">{key}</span>
              <span className="truncate text-right text-gray-200">{String(value)}</span>
            </div>
          ))}
        </div>

        <pre className="whitespace-pre-wrap break-all rounded-lg border border-white/[0.08] bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-gray-400">
          {JSON.stringify(feature, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export function FeatureInspector({
  measurement,
  feature,
  projectId = null,
  onClose,
  onSave,
  onDelete,
  onCompute,
  isNew,
  saving,
  busy,
}: FeatureInspectorProps) {
  const [name, setName] = React.useState(measurement?.name || "");
  // Editable base-method config, seeded from the stored params; null until the
  // measurement is known to be volume-kind.
  const [calcCfg, setCalcCfg] = React.useState<CalcMethodState | null>(null);
  const [showReceipt, setShowReceipt] = React.useState(false);
  const [prevId, setPrevId] = React.useState(measurement?.id);

  // Reset the editable state when a different feature is selected. Adjusting
  // state during render (instead of in an effect) avoids the cascading
  // re-render the effect caused — https://react.dev/learn/you-might-not-need-an-effect
  if (measurement?.id !== prevId) {
    setPrevId(measurement?.id);
    setName(measurement?.name || "");
    setCalcCfg(
      measurement && isVolumeKind(measurement.kind)
        ? methodFromParams(measurement.params) ?? DEFAULT_METHOD_STATE
        : null
    );
    setShowReceipt(false);
  }

  if (feature) return <PickedFeatureView feature={feature} onClose={onClose} />;
  if (!measurement) return null;

  const demo = (measurement as PanelMeasurement).demo === true;
  const isVolume = isVolumeKind(measurement.kind);
  // Volume kinds may re-run on completed too (edit method → recompute); the
  // backend's in-flight gate (409) covers the computing state.
  const canCompute =
    !demo &&
    (measurement.status === "draft" ||
      measurement.status === "failed" ||
      (isVolume && measurement.status === "completed"));

  // Backend result wins; otherwise fall back to plan stats derived from the
  // stored geometry (client-side, heights not included).
  const resultMetricMap = metricsOf(measurement.result);
  const localStats =
    !demo && Object.keys(resultMetricMap).length === 0 && measurement.geometry
      ? geometryLocalStats(measurement.geometry)
      : null;
  const metrics = demo
    ? [
        { label: "Volume", value: "12,840 m³" },
        { label: "Tonnage", value: "32,100 t" },
        { label: "Area", value: "1,420 m²" },
        { label: "Perimeter", value: "142 m" },
      ]
    : resultMetrics(localStats ?? resultMetricMap);

  const computeError = demo ? null : resultErrorOf(measurement.result);
  const receipt = demo ? null : provenanceOf(measurement.result);

  const runCompute = () => {
    if (!onCompute) return;
    // Volume kinds always send the edited config as the override — the backend
    // persists the merge, so the row states what ran (§6.1).
    if (isVolume && calcCfg) {
      try {
        const refs = surfaceRefsForMethod(calcCfg);
        onCompute(measurement.id, {
          volume_method: calcCfg.method,
          from: refs.from,
          to: refs.to,
        });
      } catch (err) {
        if (err instanceof CalcParamsError) toast.warning(err.message);
        else throw err;
      }
      return;
    }
    onCompute(measurement.id);
  };

  const title = isNew
    ? `Name this ${measurement.geometry?.type === "LineString" ? "polyline" : "polygon"}`
    : measurement.name;

  return (
    <div className="h-full flex flex-col text-sm text-gray-200 p-3 gap-4 min-h-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate font-semibold text-base text-gray-100">{title}</h3>
        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 text-gray-400">
          <X size={18} />
        </Button>
      </div>

      {isNew ? (
        <>
          <p className="text-xs text-gray-500 -mt-3">
            {`Saved as a ${measurement.kind.replace(/_/g, " ")} measurement${
              isVolume ? " and computed with the configured base surface" : ""
            }.`}
            {measurement.folder ? ` Filed under “${measurement.folder}”.` : ""}
          </p>
          {metrics.length > 0 && <MetricsGrid metrics={metrics} />}
          <Input
            autoFocus
            placeholder="e.g. Stockpile SP-12"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-[#16181D] border-white/5"
          />
          <div className="flex gap-3 mt-auto">
            <Button onClick={() => onSave(name)} disabled={!name.trim() || saving} className="flex-1">
              {saving ? "Saving…" : isVolume ? "Save & compute" : "Save"}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Tabs defaultValue="properties" className="flex flex-col flex-1 min-h-0">
          <TabsList className="bg-transparent p-0">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
          </TabsList>

          <TabsContent
            value="properties"
            className="flex-1 flex flex-col gap-4 mt-2 min-h-0 overflow-y-auto"
          >
            <div className="flex flex-wrap gap-2">
              <StatusChip status={measurement.status} demo={demo} />
              <span className="inline-flex items-center rounded-md bg-gray-400/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-400/20">
                {demo ? "Limestone" : measurement.kind.replace(/_/g, " ")}
              </span>
              {measurement.folder && (
                <span className="inline-flex items-center rounded-md bg-gray-400/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-400/20">
                  {measurement.folder}
                </span>
              )}
            </div>

            {/* Failure reason — the v1 result doc's error block (class +
                message straight from the processor's Permanent error). */}
            {measurement.status === "failed" && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] p-3 text-xs">
                <p className="font-medium text-red-400">
                  Compute failed{computeError ? ` · ${computeError.class.replace(/_/g, " ")}` : ""}
                </p>
                <p className="mt-1 text-red-300/80">
                  {computeError?.message ??
                    "No failure detail was recorded for this run. Re-run compute to retry."}
                </p>
              </div>
            )}

            {metrics.length > 0 ? (
              <MetricsGrid metrics={metrics} />
            ) : (
              measurement.status !== "failed" && (
                <p className="rounded-lg bg-[#19191d] p-3 text-xs text-gray-500">
                  {measurement.status === "computing"
                    ? "Computing — results will appear here shortly."
                    : "No computed metrics yet. Run compute to populate volume and area."}
                </p>
              )
            )}

            {localStats && metrics.length > 0 && (
              <p className="-mt-2 text-[10px] text-gray-600">
                Plan values measured from the drawn geometry — run compute for surface-true results.
              </p>
            )}

            {demo ? (
              <div className="text-gray-400 space-y-1">
                <p>Material: Limestone</p>
                <p>Density: 2.5 t/m³</p>
              </div>
            ) : (
              <>
                {/* Editable calc config (volume kinds) — same component as the
                    drawing panel; edits ride the next Run compute as the §6.1
                    params override. Replaces the old static "Base method" line. */}
                {isVolume && calcCfg && (
                  <CalcConfig
                    idPrefix="inspect"
                    projectId={projectId}
                    value={calcCfg}
                    onChange={(patch) => setCalcCfg((c) => ({ ...(c ?? DEFAULT_METHOD_STATE), ...patch }))}
                  />
                )}
                <div className="text-gray-400 space-y-1 text-xs">
                  {measurement.updated_at && (
                    <p>Updated: {measurement.updated_at.slice(0, 16).replace("T", " ")}</p>
                  )}
                </div>
              </>
            )}

            <div className="mt-auto flex flex-col gap-1">
              {canCompute && onCompute && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={runCompute}
                  className="justify-between text-gray-300"
                >
                  <span className="flex items-center gap-2">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    {measurement.status === "completed" ? "Re-run compute" : "Run compute"}
                  </span>
                  <ChevronRight size={16} />
                </Button>
              )}
              {receipt && (
                <>
                  <Button
                    variant="ghost"
                    className="justify-between text-gray-300"
                    onClick={() => setShowReceipt((v) => !v)}
                  >
                    Receipt {showReceipt ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </Button>
                  {showReceipt && (
                    <div className="rounded-lg border border-white/[0.08] bg-[#19191d] p-2.5 text-[11px] text-gray-400 space-y-1.5">
                      {receipt.processor && (
                        <p>
                          <span className="text-gray-500">Processor:</span> {receipt.processor}
                        </p>
                      )}
                      {receipt.tools && Object.keys(receipt.tools).length > 0 && (
                        <p>
                          <span className="text-gray-500">Tools:</span>{" "}
                          {Object.entries(receipt.tools)
                            .map(([k, v]) => `${k} ${v}`)
                            .join(" · ")}
                        </p>
                      )}
                      {receipt.effective !== undefined && (
                        <>
                          <p className="text-gray-500">Effective parameters (as run):</p>
                          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-gray-400">
                            {JSON.stringify(receipt.effective, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              {!demo && onDelete && (
                <Button
                  variant="destructive"
                  disabled={busy}
                  className="w-full mt-4"
                  onClick={() => {
                    onDelete(measurement.id);
                    onClose();
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="style" className="mt-2 flex-1">
            <p className="rounded-lg bg-[#19191d] p-3 text-xs text-gray-500">
              Styling controls are coming soon.
            </p>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
