"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Loader2,
  Pencil,
  Play,
  Save,
  Spline,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { EstimateResult, Measurement } from "@/lib/api/assetSvc";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";
import { geometryLocalStats } from "@/lib/viewer/measure";
import { CalcConfig } from "@/components/viewer/CalcConfig";
import {
  CalcParamsError,
  DEFAULT_METHOD_STATE,
  calcTypesFor,
  coerceMethodForKind,
  isVolumeKind,
  methodFromParams,
  LEAN_RENDER,
  metricsOf,
  provenanceOf,
  resultErrorOf,
  resultForKind,
  surfaceRefsForMethod,
  type CalcMethodState,
} from "@/lib/viewer/calc";
import { UNIT_SYSTEMS, convertForDisplay, unitSystemOf, type UnitSystem } from "@/lib/viewer/units";
import { STYLE_SWATCHES, styleOf, type MeasurementStyle } from "@/lib/viewer/style";
import { temporalComparePair } from "@/lib/viewer/compare";
import { ComparisonCard } from "@/components/viewer/shell/ComparisonCard";

// Right contextual inspector — the DESIGN panel (SP-12 mock): header title with
// pencil-rename; a type dropdown (re-template, teardown §2 "type is mutable
// after creation") + units dropdown row; Properties | Style tabs; chips →
// metrics grid (mono) → metadata block (base-method editable via disclosure) →
// icon action ROWS (Receipt · Run compute · Add to report · Save draft ·
// Delete) → STYLE tab: fill/stroke/label
// controls persisted to params.style (PATCH deep-merge) and applied to the
// Cesium entities. Draft-first: draft-ness is a chip + a Save row — never a
// blocking prompt; compute keeps running underneath.

interface FeatureInspectorProps {
  measurement: Measurement | PanelMeasurement | null;
  /** Property bag of a non-measurement feature picked on the map. */
  feature?: Record<string, unknown> | null;
  /** For the design picker in the editable calc config. */
  projectId?: string | null;
  onClose: () => void;
  /** Optional collapse control rendered next to the close button. */
  onCollapse?: () => void;
  /** When true, only the title row is shown (panel chrome stays mounted). */
  collapsed?: boolean;
  /** Promote a draw-first draft: PATCH {name, draft:false}. */
  onSave: (id: string, name: string) => void;
  /** Generic PATCH (rename / re-kind / units / style) + refresh. */
  onPatch?: (
    id: string,
    body: { name?: string; kind?: string; params?: Record<string, unknown>; draft?: boolean }
  ) => Promise<void>;
  onDelete?: (id: string) => void;
  onCompute?: (id: string, override?: Record<string, unknown>) => void;
  /** Enter the vertex-drag geometry editor for this measurement (Line tool lit
   * as the edit indicator); double-click on the map commits + recomputes. */
  onEditGeometry?: () => void;
  /** v2 only: commit the active geometry edit (the "Done editing" twin of Enter
   * / double-click). Present regardless of flag; the button only shows while the
   * v2 machine is editing THIS measurement. */
  onCommitGeometry?: () => void;
  /** v2 only: the id of the measurement whose geometry is being edited right now
   * (from the interaction machine), else null. When it matches this measurement,
   * the inspector shows "Done editing" instead of "Edit shape". */
  editingGeometryId?: string | null;
  /** The instant PostGIS estimate for this measurement's current kind, shown
   * (with an "Instant" badge) until the authoritative worker doc lands. */
  estimate?: EstimateResult | null;
  /** Drop the stale estimate (called when the kind/method changes). */
  onClearEstimate?: () => void;
  saving: boolean;
  /** A compute/delete request for this measurement is in flight. */
  busy?: boolean;
}

// The total_*/delta_*/profile_* keys are what the compute processors actually
// emit into measurement.result; the bare keys cover client-side plan stats.
const METRIC_LABELS: [key: string, label: string][] = [
  ["total_volume_m3", "Volume"],
  ["total_adjusted_volume_m3", "Adj. volume"],
  ["total_tonnage_t", "Tonnage"],
  ["delta_volume_m3", "Δ volume"],
  ["delta_tonnage_t", "Δ tonnage"],
  ["active_pile_count", "Piles"],
  ["volume_m3", "Volume"],
  ["adjusted_volume_m3", "Adj. volume"],
  ["tonnage_t", "Tonnage"],
  ["area_m2", "Area"],
  ["perimeter_m", "Perimeter"],
  ["length_m", "Length"],
  ["grade_percent", "Grade"],
  ["cut_volume_m3", "Cut"],
  ["fill_volume_m3", "Fill"],
  ["net_change_m3", "Net change"],
  ["total_moved_m3", "Moved"],
  ["profile_length_m", "Profile length"],
  ["profile_point_count", "Samples"],
];

// Per-kind curated grids — the compute/estimate metric map carries the FULL
// worker-parity set (cut/fill/net/moved split, material-adjusted splits,
// sample_count) for every volume result, but a panel shows only the headline
// numbers for that kind. For a stockpile the cut/fill/net/moved keys just
// restate Volume, so they are deliberately omitted here.
const METRICS_BY_KIND: Record<string, [key: string, label: string][]> = {
  volume: [["volume_m3", "Volume"], ["fill_tonnage_t", "Tonnage"], ["area_m2", "Area"]],
  stockpile: [["volume_m3", "Volume"], ["fill_tonnage_t", "Tonnage"], ["area_m2", "Area"]],
  cut_fill: [
    ["cut_volume_m3", "Cut"],
    ["fill_volume_m3", "Fill"],
    ["net_change_m3", "Net change"],
    ["area_m2", "Area"],
  ],
};

// Internal / debug metrics never shown in the grid (they are provenance, not
// results — sample_count, and the material-adjusted splits which surface as
// Tonnage instead).
const HIDDEN_METRICS = new Set([
  "sample_count",
  "cut_adjusted_volume_m3",
  "fill_adjusted_volume_m3",
]);

function formatMetric(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 10 ? 1 : 0;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "haul_distance_m" → "Haul distance" for result keys we don't know (the unit
 * suffix is dropped — convertForDisplay re-attaches the display unit). */
function prettifyKey(key: string): string {
  const words = key
    .replace(/_(m3|m2|t|m|percent|count)$/, "")
    .replace(/_/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Metric map → display rows, converted into the measurement's unit system.
 * A `kind` with a curated grid shows ONLY that grid; other kinds fall back to
 * the generic label table plus any remaining (non-internal) keys. */
function resultMetrics(
  result: Record<string, number>,
  system: UnitSystem,
  kind?: string
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string, value: number) => {
    const c = convertForDisplay(key, value, system);
    rows.push({ label, value: `${formatMetric(c.value)}${c.unit ? ` ${c.unit}` : ""}` });
  };
  const curated = kind ? METRICS_BY_KIND[kind] : undefined;
  for (const [key, label] of curated ?? METRIC_LABELS) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      push(key, label, value);
      seen.add(key);
    }
  }
  if (curated) return rows; // curated kinds surface only their headline set
  for (const [key, value] of Object.entries(result)) {
    if (seen.has(key) || HIDDEN_METRICS.has(key) || typeof value !== "number" || !Number.isFinite(value))
      continue;
    push(key, prettifyKey(key), value);
  }
  return rows;
}

// Status chip — design language: completed reads as "Approved".
const STATUS_LABELS: Record<string, string> = {
  completed: "Approved",
  computing: "Computing",
  failed: "Failed",
  draft: "Not computed",
};

function StatusChip({ status, demo }: { status: string; demo?: boolean }) {
  const styles: Record<string, string> = {
    completed: "bg-green-500/10 text-green-400 ring-green-500/20",
    computing: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
    failed: "bg-red-500/10 text-red-400 ring-red-500/20",
    draft: "bg-gray-400/10 text-gray-400 ring-gray-400/20",
  };
  const key = demo ? "completed" : status;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
        styles[key] ?? styles.draft
      }`}
    >
      {key === "computing" && <Loader2 size={11} className="animate-spin" />}
      {demo ? "Approved" : STATUS_LABELS[status] ?? status}
    </span>
  );
}

function GreyChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-gray-400/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-400/20">
      {children}
    </span>
  );
}

function MetricsGrid({ metrics }: { metrics: { label: string; value: string }[] }) {
  return (
    <div className="bg-[#19191d] p-3 rounded-lg grid grid-cols-2 gap-x-3 gap-y-3">
      {metrics.map((m) => (
        <div key={m.label}>
          <div className="text-gray-500 text-xs">{m.label}</div>
          <div className="font-mono text-[15px] tracking-tight text-gray-100">{m.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Design action row: icon + label left, chevron right, bordered card. */
function ActionRow({
  icon,
  label,
  onClick,
  accent = false,
  disabled = false,
  chevron = <ChevronRight size={16} />,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
  disabled?: boolean;
  chevron?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border border-white/[0.08] bg-[#19191d] px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.04] disabled:opacity-50 ${
        accent ? "text-[#C97A4E]" : "text-gray-200"
      }`}
    >
      <span className="flex items-center gap-2.5">
        {icon}
        {label}
      </span>
      <span className={accent ? "text-[#C97A4E]/70" : "text-gray-500"}>{chevron}</span>
    </button>
  );
}

/** Dark native select styled to the design's dropdown pills. */
function PillSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 min-w-0 flex-1 appearance-none rounded-lg border border-white/[0.08] bg-[#19191d] bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239ca3af%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_0.6rem_center] bg-no-repeat px-3 pr-8 text-xs text-gray-200 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Swatch strip for the STYLE tab. */
function SwatchRow({
  value,
  onPick,
  label,
}: {
  value: string;
  onPick: (color: string) => void;
  label: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-gray-400">{label}</p>
      <div className="flex gap-2">
        {STYLE_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label}: ${c}`}
            onClick={() => onPick(c)}
            className={`size-7 rounded-md border transition-transform hover:scale-110 ${
              value.toLowerCase() === c.toLowerCase()
                ? "border-white ring-2 ring-white/40"
                : "border-white/20"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

/** Property inspector for a picked, non-measurement map feature. */
function PickedFeatureView({
  feature,
  onClose,
  onCollapse,
  collapsed = false,
}: {
  feature: Record<string, unknown>;
  onClose: () => void;
  onCollapse?: () => void;
  collapsed?: boolean;
}) {
  const entries = Object.entries(feature).filter(
    ([key, value]) => !key.startsWith("_") && (typeof value !== "object" || value === null)
  );

  return (
    <div className={`flex flex-col text-sm text-gray-200 p-3 ${collapsed ? "" : "h-full gap-3 min-h-0"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Selected feature</p>
          <h3 className="truncate font-semibold text-base text-gray-100">
            {String(feature.name ?? feature.id ?? "Unnamed feature")}
          </h3>
        </div>
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
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 text-gray-400">
            <X size={18} />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <span className="self-start rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {String(feature._source ?? "feature")}
          </span>

          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
            <div className="rounded-lg bg-[#19191d] p-3 space-y-1.5">
              {entries.length === 0 && <p className="text-xs text-gray-500">No feature properties.</p>}
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
        </>
      )}
    </div>
  );
}

export function FeatureInspector({
  measurement,
  feature,
  projectId = null,
  onClose,
  onCollapse,
  collapsed = false,
  onSave,
  onPatch,
  onDelete,
  onCompute,
  onEditGeometry,
  onCommitGeometry,
  editingGeometryId = null,
  estimate,
  onClearEstimate,
  saving,
  busy,
}: FeatureInspectorProps) {
  const [name, setName] = React.useState(measurement?.name || "");
  const [renaming, setRenaming] = React.useState(false);
  // Editable base-method config, seeded from the stored params (lazy initializer
  // — the render-time reset below only fires on measurement SWITCH, not first
  // mount); null unless the measurement is volume-kind.
  const seedCalcCfg = (m: typeof measurement) =>
    m && isVolumeKind(m.kind)
      ? coerceMethodForKind(methodFromParams(m.params) ?? DEFAULT_METHOD_STATE, m.kind)
      : null;
  const [calcCfg, setCalcCfg] = React.useState<CalcMethodState | null>(() => seedCalcCfg(measurement));
  const [editBase, setEditBase] = React.useState(false);
  const [showReceipt, setShowReceipt] = React.useState(false);
  // STYLE tab local state — seeded from params.style, PATCHed (debounced).
  const [style, setStyle] = React.useState<MeasurementStyle>(() => styleOf(measurement?.params));
  const styleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prevId, setPrevId] = React.useState(measurement?.id);

  // Reset the editable state when a different feature is selected. Adjusting
  // state during render (instead of in an effect) avoids the cascading
  // re-render the effect caused — https://react.dev/learn/you-might-not-need-an-effect
  if (measurement?.id !== prevId) {
    setPrevId(measurement?.id);
    setName(measurement?.name || "");
    setRenaming(false);
    setCalcCfg(seedCalcCfg(measurement));
    setEditBase(false);
    setShowReceipt(false);
    setStyle(styleOf(measurement?.params));
  }

  if (feature) {
    return (
      <PickedFeatureView feature={feature} onClose={onClose} onCollapse={onCollapse} collapsed={collapsed} />
    );
  }
  if (!measurement) return null;

  const demo = (measurement as PanelMeasurement).demo === true;
  const isDraft = !demo && measurement.draft === true;
  const isVolume = isVolumeKind(measurement.kind);
  // Compare Mode: a temporal compare (params.from/to name two different
  // surveys) gets the A→B comparison card headline in the Properties tab.
  const comparePair = demo ? null : temporalComparePair(measurement.params);
  const canPatch = !demo && !!onPatch;
  // Volume kinds may re-run on completed too (edit method → recompute); the
  // backend's in-flight gate (409) covers the computing state.
  // Only the volume family dispatches today (processorForKind on the backend);
  // other kinds get no Run row rather than a 422 toast. Completed volume rows
  // may re-run (edit method → recompute); the in-flight 409 gate covers computing.
  const canCompute = !demo && isVolume && measurement.status !== "computing";
  // Vertex-drag editing needs a real (non-demo) polygon/line and the handler.
  const geomType = measurement.geometry?.type;
  const canEditGeometry =
    !demo && !!onEditGeometry && (geomType === "Polygon" || geomType === "LineString");
  // v2: this measurement's geometry is being edited right now → the action row
  // becomes "Done editing" (commit) instead of "Edit shape" (start).
  const isEditingThis = !!editingGeometryId && editingGeometryId === measurement.id;

  const unitSystem = unitSystemOf(measurement.params);
  const material = (measurement.params?.material ?? null) as {
    name?: string;
    density_t_m3?: number;
  } | null;

  // The type dropdown is a VIEW switch: show the doc stored for the CURRENT
  // kind (results[kind]); other kinds keep theirs. No doc for this kind →
  // plan stats + "Run compute". The LATEST run's error (legacy result column)
  // is only surfaced when this kind has no successful doc to show.
  const doc = demo ? null : resultForKind(measurement);
  const resultMetricMap = metricsOf(doc);
  const computing = measurement.status === "computing";
  const showFailure = !demo && measurement.status === "failed" && !doc;
  // Instant estimate fills the panel before the authoritative worker doc lands.
  // It wins whenever there is no doc yet OR a (re-)compute is in flight — during
  // a re-run the estimate reflects the PENDING params, so it should supersede
  // the now-stale prior doc. A settled doc (not computing) wins; a failure wins.
  const estimateMetricMap =
    !demo && !showFailure && (!doc || computing) && estimate && Object.keys(estimate.metrics).length > 0
      ? estimate.metrics
      : null;
  const showingEstimate = !!estimateMetricMap;
  const localStats =
    !demo && !doc && !showingEstimate && measurement.geometry
      ? geometryLocalStats(measurement.geometry)
      : null;
  const metrics = demo
    ? [
        { label: "Volume", value: "12,840 m³" },
        { label: "Tonnage", value: "32,100 t" },
        { label: "Area", value: "1,420 m²" },
        { label: "Perimeter", value: "142 m" },
      ]
    : resultMetrics(localStats ?? estimateMetricMap ?? resultMetricMap, unitSystem, measurement.kind);

  const computeError = showFailure ? resultErrorOf(measurement.result) : null;
  const receipt = demo ? null : provenanceOf(doc);
  // Chip reflects the SELECTED kind: computing (row-level) → this kind's doc →
  // last-run failure → not computed yet.
  const chipStatus = computing ? "computing" : doc ? "completed" : showFailure ? "failed" : "draft";
  const calcStamp = measurement.updated_at
    ? measurement.updated_at.slice(0, 16).replace("T", " ")
    : "";

  // Type dropdown: the geometry's calc types; the stored kind rides along even
  // if it predates the catalog (legacy "volume") so the select never lies.
  const geomMode = measurement.geometry?.type === "LineString" ? "polyline" : "polygon";
  const typeOptions = calcTypesFor(geomMode).map((t) => ({ value: t.kind, label: t.label }));
  if (!typeOptions.some((o) => o.value === measurement.kind)) {
    typeOptions.unshift({ value: measurement.kind, label: prettifyKey(measurement.kind) });
  }

  const commitRename = () => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === measurement.name) {
      setName(measurement.name);
      return;
    }
    if (canPatch) void onPatch!(measurement.id, { name: next }).catch(() => setName(measurement.name));
  };

  const changeType = (kind: string) => {
    if (!canPatch || kind === measurement.kind) return;
    onClearEstimate?.(); // the old kind's instant number no longer applies
    const params: Record<string, unknown> = {};
    if (isVolumeKind(kind)) {
      // Re-templating snaps the base method onto the new kind's list (a
      // stockpile's smart base becomes cut/fill's previous survey, etc.).
      const cfg = coerceMethodForKind(calcCfg ?? DEFAULT_METHOD_STATE, kind);
      try {
        const refs = surfaceRefsForMethod(cfg);
        params.volume_method = cfg.method;
        params.from = refs.from;
        params.to = refs.to;
        params.render = LEAN_RENDER;
      } catch (err) {
        if (err instanceof CalcParamsError) {
          toast.warning(err.message);
          return;
        }
        throw err;
      }
      setCalcCfg(cfg);
    }
    // NO auto-compute: the dropdown is a view switch (the new kind shows its
    // stored doc, or "Run compute"). Computing is always the explicit row.
    void onPatch!(measurement.id, { kind, ...(Object.keys(params).length ? { params } : {}) }).catch(
      () => undefined
    );
  };

  const changeUnits = (v: string) => {
    if (canPatch && v !== unitSystem) {
      void onPatch!(measurement.id, { params: { units: v } }).catch(() => undefined);
    }
  };

  const patchStyle = (patch: Partial<MeasurementStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    if (!canPatch) return;
    if (styleTimer.current) clearTimeout(styleTimer.current);
    styleTimer.current = setTimeout(() => {
      void onPatch!(measurement.id, { params: { style: next } }).catch(() => undefined);
    }, 600);
  };

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
          // Lean run: skip the gdal2tiles pyramid — the panel needs the
          // number + receipt; heatmap tiles are the result-views phase.
          render: LEAN_RENDER,
        });
      } catch (err) {
        if (err instanceof CalcParamsError) toast.warning(err.message);
        else throw err;
      }
      return;
    }
    onCompute(measurement.id);
  };

  const runLabel = doc ? "Re-run compute" : "Run compute";

  return (
    <div className={`flex flex-col text-sm text-gray-200 p-3 ${collapsed ? "" : "h-full gap-3 min-h-0"}`}>
      {/* Header — name (pencil to rename, teardown §10) + collapse/close. */}
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setName(measurement.name);
                setRenaming(false);
              }
            }}
            className="h-8 bg-[#16181D] border-white/10 text-base font-semibold"
          />
        ) : (
          <button
            type="button"
            className="group flex min-w-0 items-center gap-2 text-left"
            onClick={() => canPatch && setRenaming(true)}
            title={canPatch ? "Rename" : undefined}
          >
            <h3 className="min-w-0 truncate font-semibold text-base text-gray-100">
              {measurement.name}
            </h3>
            {canPatch && (
              <Pencil size={13} className="shrink-0 text-gray-600 group-hover:text-gray-300" />
            )}
          </button>
        )}
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
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 text-gray-400">
            <X size={18} />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Type + Units dropdown row (design row 2). */}
          <div className="flex gap-2">
            <PillSelect
              ariaLabel="Measurement type"
              value={measurement.kind}
              onChange={changeType}
              options={typeOptions}
            />
            <PillSelect
              ariaLabel="Units"
              value={unitSystem}
              onChange={changeUnits}
              options={UNIT_SYSTEMS.map((u) => ({ value: u.id, label: u.label }))}
            />
          </div>

          <Tabs defaultValue="properties" className="flex flex-col flex-1 min-h-0">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="style">Style</TabsTrigger>
            </TabsList>

            <TabsContent
              value="properties"
              className="flex-1 flex flex-col gap-3 mt-2 min-h-0 overflow-y-auto"
            >
              <div className="flex flex-wrap gap-2">
                {isDraft && (
                  <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
                    Draft
                  </span>
                )}
                <StatusChip status={chipStatus} demo={demo} />
                {(demo || material?.name) && <GreyChip>{demo ? "Limestone" : material!.name}</GreyChip>}
                {measurement.folder && <GreyChip>{measurement.folder}</GreyChip>}
              </div>

              {/* Compare Mode headline — A→B epochs + cut/fill/net Δ. Only for a
                  temporal compare; ordinary measurements skip it (and its fetch). */}
              {comparePair && (
                <ComparisonCard measurement={measurement} projectId={projectId} pair={comparePair} />
              )}

              {/* Failure reason — the LATEST run's error, only while the
                  selected kind has no successful doc of its own. */}
              {showFailure && (
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
                !showFailure && (
                  <p className="rounded-lg bg-[#19191d] p-3 text-xs text-gray-500">
                    {computing
                      ? "Computing — results will appear here shortly."
                      : "No computed metrics yet. Run compute to populate volume and area."}
                  </p>
                )
              )}

              {showingEstimate && (
                <div className="-mt-1 flex items-center gap-1.5 text-[10px]">
                  <span className="inline-flex items-center rounded-full bg-sky-400/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-sky-300">
                    Instant
                  </span>
                  <span className="text-gray-500">
                    {computing
                      ? `PostGIS · ${estimate?.provenance.query_ms ?? 0} ms — refining with the full compute…`
                      : "PostGIS estimate · Run compute for the authoritative result."}
                  </span>
                </div>
              )}

              {localStats && metrics.length > 0 && (
                <p className="-mt-1 text-[10px] text-gray-600">
                  Plan values measured from the drawn geometry — run compute for surface-true results.
                </p>
              )}

              {/* Metadata block (design): Material / Density / Base method /
                  Calculated. Base method discloses the shared CalcConfig. */}
              <div className="space-y-1 text-xs text-gray-400">
                {(demo || material?.name) && (
                  <p>
                    Material: <span className="text-gray-300">{demo ? "Limestone" : material!.name}</span>
                  </p>
                )}
                {(demo || material?.density_t_m3) && (
                  <p>
                    Density:{" "}
                    <span className="text-gray-300">
                      {demo ? "2.5" : material!.density_t_m3} t/m³
                    </span>
                  </p>
                )}
                {isVolume && calcCfg && (
                  <button
                    type="button"
                    className="group flex items-center gap-1"
                    onClick={() => setEditBase((v) => !v)}
                    aria-expanded={editBase}
                  >
                    Base method:{" "}
                    <span className="text-gray-300 capitalize">{calcCfg.method.replace(/-/g, " ")}</span>
                    {editBase ? (
                      <ChevronDown size={12} className="text-gray-500" />
                    ) : (
                      <ChevronRight size={12} className="text-gray-600 group-hover:text-gray-400" />
                    )}
                  </button>
                )}
                {calcStamp && (
                  <p>
                    Calculated: <span className="text-gray-300">{calcStamp}</span>
                  </p>
                )}
              </div>

              {/* Disclosed base-method editor — same component as the drawing
                  panel; edits ride the next Run compute as the §6.1 override. */}
              {editBase && isVolume && calcCfg && !demo && (
                <div className="rounded-lg border border-white/[0.06] bg-[#151518] p-2.5">
                  <CalcConfig
                    idPrefix="inspect"
                    kind={measurement.kind}
                    projectId={projectId}
                    value={calcCfg}
                    onChange={(patch) => setCalcCfg((c) => ({ ...(c ?? DEFAULT_METHOD_STATE), ...patch }))}
                  />
                </div>
              )}

              {/* Action rows (design): Receipt · Run · Save (drafts) · Delete. */}
              <div className="mt-auto flex flex-col gap-2">
                {receipt && (
                  <ActionRow
                    accent
                    icon={<FileText size={15} />}
                    label="Receipt"
                    onClick={() => setShowReceipt((v) => !v)}
                    chevron={showReceipt ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  />
                )}
                {showReceipt && receipt && (
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
                {canEditGeometry && !isEditingThis && (
                  <ActionRow
                    icon={<Spline size={15} />}
                    label="Edit shape"
                    onClick={() => onEditGeometry!()}
                  />
                )}
                {isEditingThis && onCommitGeometry && (
                  <ActionRow
                    accent
                    icon={<Check size={15} />}
                    label="Done editing"
                    onClick={() => onCommitGeometry()}
                  />
                )}
                {canCompute && onCompute && (
                  <ActionRow
                    icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                    label={runLabel}
                    onClick={runCompute}
                    disabled={busy}
                  />
                )}
                {isDraft && (
                  <ActionRow
                    accent
                    icon={saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    label={saving ? "Saving…" : "Save measurement"}
                    onClick={() => onSave(measurement.id, name.trim() || measurement.name)}
                    disabled={saving}
                  />
                )}
                {!demo && onDelete && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onDelete(measurement.id);
                      onClose();
                    }}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/[0.08] disabled:opacity-50"
                  >
                    <X size={15} />
                    {isDraft ? "Discard draft" : "Delete"}
                  </button>
                )}
              </div>
            </TabsContent>

            {/* STYLE tab (design): fill/opacity, stroke color/width/style,
                label visibility/field/size → params.style via debounced PATCH. */}
            <TabsContent value="style" className="mt-2 flex-1 min-h-0 overflow-y-auto">
              <div className="flex flex-col gap-4 pb-2">
                <SwatchRow label="Fill color" value={style.fill} onPick={(fill) => patchStyle({ fill })} />
                <div>
                  <p className="mb-1.5 text-xs text-gray-400">Opacity</p>
                  <Slider
                    value={[style.fillOpacity]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => patchStyle({ fillOpacity: v })}
                  />
                </div>
                <SwatchRow
                  label="Stroke color"
                  value={style.stroke}
                  onPick={(stroke) => patchStyle({ stroke })}
                />
                <div>
                  <p className="mb-1.5 text-xs text-gray-400">Stroke width</p>
                  <Slider
                    value={[style.strokeWidth]}
                    min={1}
                    max={10}
                    step={1}
                    onValueChange={([v]) => patchStyle({ strokeWidth: v })}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-gray-400">Stroke style</p>
                  <PillSelect
                    ariaLabel="Stroke style"
                    value={style.strokeStyle}
                    onChange={(v) => patchStyle({ strokeStyle: v as MeasurementStyle["strokeStyle"] })}
                    options={[
                      { value: "solid", label: "Solid" },
                      { value: "dashed", label: "Dashed" },
                      { value: "dotted", label: "Dotted" },
                    ]}
                    className="w-full flex-none"
                  />
                </div>
                <label className="flex items-center justify-between text-xs text-gray-400">
                  Label visibility
                  <Checkbox
                    checked={style.labelVisible}
                    onCheckedChange={(v) => patchStyle({ labelVisible: v === true })}
                  />
                </label>
                <div>
                  <p className="mb-1.5 text-xs text-gray-400">Label field</p>
                  <PillSelect
                    ariaLabel="Label field"
                    value={style.labelField}
                    onChange={(v) => patchStyle({ labelField: v as MeasurementStyle["labelField"] })}
                    options={[
                      { value: "name", label: "Name" },
                      { value: "volume", label: "Volume" },
                      { value: "none", label: "None" },
                    ]}
                    className="w-full flex-none"
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-gray-400">Label size</p>
                  <Slider
                    value={[style.labelSize]}
                    min={9}
                    max={24}
                    step={1}
                    onValueChange={([v]) => patchStyle({ labelSize: v })}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
