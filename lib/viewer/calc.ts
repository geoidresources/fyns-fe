// Calculation-type catalog + SurfaceRef param wiring (RE-PIVOT 2026-07-16).
// The floating toolbar draws GEOMETRY with a neutral kind; the right panel picks
// WHAT to compute (a CalcType → the measurement's persisted `kind`) and HOW (a
// base-surface method → `params.from`/`params.to` SurfaceRefs). This module is
// the single source of truth for both mappings, shared by the drawing-time
// Calculation panel, the FeatureInspector's editable config, and the save path.
//
// The SurfaceRef shapes mirror docs/contracts/surface-ref.md §3.1 and
// asset-svc-refactor's volume_input.go exactly: from = the BASE surface,
// to = the current survey DSM (matching the backend's own stockpile default of
// from:smart_base / to:survey_terrain·dsm). cut_fill requires explicit from/to
// (§3.1 — no defaults on the correctness-critical path), which we always write.

import type { MeasurementResultDoc } from "@/lib/api/assetSvc";

// ---------------------------------------------------------------- calc types

export interface CalcType {
  id: string;
  label: string;
  hint: string;
  /** Persisted measurement kind (open enum, FE-driven — measurement.go:25). */
  kind: string;
  /** Volume-type calc: the base-surface method config applies + auto-compute. */
  needsBase?: boolean;
}

/** Geometry mode → offered calculations ("what to compute"). */
export const CALC_TYPES: Record<"probe" | "polyline" | "polygon", CalcType[]> = {
  probe: [
    {
      id: "point-elevation",
      label: "Point elevation",
      hint: "Sampled ground height at the picked point.",
      kind: "elevation",
    },
  ],
  polyline: [
    { id: "length", label: "Length", hint: "3D length along the line.", kind: "distance" },
    {
      id: "cross-section",
      label: "Cross-section profile",
      hint: "Elevation profile sampled across the line.",
      kind: "cross_section",
    },
    { id: "slope", label: "Slope / grade", hint: "Grade between the endpoints.", kind: "slope" },
  ],
  polygon: [
    {
      id: "stockpile",
      label: "Stockpile volume",
      hint: "Volume above a base surface.",
      kind: "stockpile",
      needsBase: true,
    },
    {
      id: "cut-fill",
      label: "Cut / fill",
      hint: "Cut and fill against a base surface.",
      kind: "cut_fill",
      needsBase: true,
    },
    { id: "area", label: "Surface area", hint: "Plan and draped surface area.", kind: "area" },
  ],
};

export function calcTypesFor(mode: "idle" | "probe" | "polyline" | "polygon"): CalcType[] {
  return mode === "idle" ? [] : CALC_TYPES[mode];
}

/** The calc type's kind, ONLY if the type is valid for the geometry mode — a
 * stale polygon pick must not leak onto a freshly drawn line. */
export function kindForCalcType(id: string | null, mode: "polyline" | "polygon"): string | null {
  if (!id) return null;
  return CALC_TYPES[mode].find((t) => t.id === id)?.kind ?? null;
}

/** The mode's first calc — what the panel DISPLAYS as selected when nothing was
 * explicitly picked. The save path uses the same default so the persisted kind
 * always equals what the panel showed. */
export function defaultKindFor(mode: "polyline" | "polygon"): string {
  return CALC_TYPES[mode][0].kind;
}

/** Kinds that dispatch to the unified volume-compute path (service.go:97). */
export function isVolumeKind(kind: string): boolean {
  return kind === "volume" || kind === "stockpile" || kind === "cut_fill";
}

/** Kinds the FE can dispatch a compute for today: the volume family (unified
 * volume-compute path) plus cross_section (profile-extract). Gates the panel's
 * Run/Re-run row — other kinds get no row rather than a 422 toast. Grows as more
 * processors are wired to the measurement-compute endpoint. */
export function isComputableKind(kind: string): boolean {
  return isVolumeKind(kind) || kind === "cross_section";
}

// ------------------------------------------------------------- base methods

export const VOLUME_METHODS = [
  { id: "smart-base", label: "Smart base" },
  { id: "reference-rl", label: "Reference RL" },
  { id: "previous-survey", label: "Previous survey" },
  { id: "design-surface", label: "Design surface" },
  { id: "custom-base", label: "Custom base" },
] as const;

// Base methods are CALC-TYPE-AWARE (product decision 2026-07-16): a stockpile
// is "volume above a base" (smart base default, reference RL), while cut/fill
// compares against a surface (previous survey default, design, reference RL).
// A stockpile "against previous survey" is just cut/fill — offering it would
// blur the two types. custom-base is engine-ready but stays OFF the list until
// the vertex editor exists (no stub options).
const METHODS_FOR_KIND: Record<string, string[]> = {
  stockpile: ["smart-base", "reference-rl"],
  volume: ["smart-base", "reference-rl"], // legacy kind, same semantics
  cut_fill: ["previous-survey", "design-surface", "reference-rl"],
};

export function methodsForKind(kind: string): { id: string; label: string }[] {
  const ids = METHODS_FOR_KIND[kind] ?? [];
  return ids
    .map((id) => VOLUME_METHODS.find((m) => m.id === id))
    .filter((m): m is (typeof VOLUME_METHODS)[number] => !!m)
    .map((m) => ({ id: m.id, label: m.label }));
}

/** The kind's default base method (first of its list); null for non-volume. */
export function defaultMethodForKind(kind: string): string | null {
  return METHODS_FOR_KIND[kind]?.[0] ?? null;
}

/** Coerce a method state onto a kind: if the current method isn't offered for
 * that kind (e.g. smart-base after re-templating to cut_fill), snap to the
 * kind's default so the UI and the persisted params never disagree. */
export function coerceMethodForKind(state: CalcMethodState, kind: string): CalcMethodState {
  const allowed = METHODS_FOR_KIND[kind];
  if (!allowed || allowed.includes(state.method)) return state;
  return { ...state, method: allowed[0] };
}

export type RefMode = "custom" | "lowest_vertex" | "highest_vertex";

/** The base-surface configuration as edited in the panel / inspector. */
export interface CalcMethodState {
  method: string;
  refMode: RefMode;
  refElevation: number | null;
  baseDesignId: string | null;
}

export const DEFAULT_METHOD_STATE: CalcMethodState = {
  method: "smart-base",
  refMode: "lowest_vertex",
  refElevation: null,
  baseDesignId: null,
};

/** Panel-driven computes request a LEAN render: metrics + receipt only. The
 * §5.2 default (render.heatmap=true) makes every run generate + upload a
 * gdal2tiles pyramid (zooms 14–18) — the dominant wall-clock cost, none of it
 * needed for the number the panel shows. The result-views phase will request
 * {heatmap:true} explicitly when the user opens the 2D cut/fill view. */
export const LEAN_RENDER = { heatmap: false } as const;

/** A user-fixable config problem (missing RL, no design picked) — the caller
 * toasts the message instead of sending an invalid payload. */
export class CalcParamsError extends Error {}

/** Method state → explicit `params.from`/`params.to` SurfaceRefs (§3.1).
 * from = base, to = current survey DSM. Throws CalcParamsError when the
 * method's required input is missing. */
export function surfaceRefsForMethod(s: CalcMethodState): {
  from: Record<string, unknown>;
  to: Record<string, unknown>;
} {
  const to = { type: "survey_terrain", surface: "dsm" };
  switch (s.method) {
    case "smart-base":
      return { from: { type: "smart_base" }, to };
    case "reference-rl":
      if (s.refMode === "custom") {
        if (s.refElevation === null || !Number.isFinite(s.refElevation)) {
          throw new CalcParamsError("Enter a reference elevation in meters (or derive it from the boundary).");
        }
        return { from: { type: "reference_level", elevation_m: s.refElevation }, to };
      }
      return { from: { type: "reference_level", derive: s.refMode }, to };
    case "previous-survey":
      return { from: { type: "previous_survey", surface: "dsm" }, to };
    case "design-surface":
      if (!s.baseDesignId) {
        throw new CalcParamsError("Pick the design surface to compare against.");
      }
      return { from: { type: "design", design_id: s.baseDesignId }, to };
    case "custom-base":
      throw new CalcParamsError("Custom base editing lands in a later phase.");
    default:
      throw new CalcParamsError(`Unknown base method "${s.method}".`);
  }
}

/** Cross-survey SurfaceRef pair for Compare Mode (draw-to-compare). Mirrors
 * surfaceRefsForMethod's from/to contract but names two EXPLICIT surveys via
 * `survey_terrain` refs (surface-ref.md §3.1): from = epoch A ("before"),
 * to = epoch B ("after"). Setting both runs a VolumeDiff (cut/fill/net between
 * the co-registered DSMs within the polygon) on the deployed volumecompute
 * worker — no volume_method, the base IS the other epoch's DSM. */
export function crossSurveyRefs(aId: string, bId: string): {
  from: Record<string, unknown>;
  to: Record<string, unknown>;
} {
  return {
    from: { type: "survey_terrain", survey_id: aId, surface: "dsm" },
    to: { type: "survey_terrain", survey_id: bId, surface: "dsm" },
  };
}

/** Inverse of surfaceRefsForMethod for the inspector: recover the editable
 * method state from a measurement's stored params. Falls back to the legacy
 * display-only `volume_method` string, then to null (no volume config). */
export function methodFromParams(
  params: Record<string, unknown> | null | undefined
): CalcMethodState | null {
  if (!params) return null;
  const from = params.from as Record<string, unknown> | undefined;
  if (from && typeof from === "object" && typeof from.type === "string") {
    switch (from.type) {
      case "smart_base":
        return { ...DEFAULT_METHOD_STATE, method: "smart-base" };
      case "reference_level": {
        const elevation = typeof from.elevation_m === "number" ? from.elevation_m : null;
        const derive = from.derive === "highest_vertex" ? "highest_vertex" : "lowest_vertex";
        return {
          method: "reference-rl",
          refMode: elevation !== null ? "custom" : derive,
          refElevation: elevation,
          baseDesignId: null,
        };
      }
      case "previous_survey":
        return { ...DEFAULT_METHOD_STATE, method: "previous-survey" };
      case "design":
        return {
          ...DEFAULT_METHOD_STATE,
          method: "design-surface",
          baseDesignId: typeof from.design_id === "string" ? from.design_id : null,
        };
      case "custom_base":
        return { ...DEFAULT_METHOD_STATE, method: "custom-base" };
    }
  }
  if (typeof params.volume_method === "string") {
    return { ...DEFAULT_METHOD_STATE, method: params.volume_method };
  }
  return null;
}

// ------------------------------------------------------------- result doc

/** The result doc belonging to the measurement's CURRENT kind. Per-kind docs
 * live in `results[kind]` (each calc type remembers its last successful run —
 * the type dropdown is a view switch, never a compute trigger). Legacy rows
 * that predate the map fall back to the single `result` doc, which is safe to
 * attribute because re-templating did not exist when they were written. */
export function resultForKind(m: {
  kind: string;
  result?: MeasurementResultDoc;
  results?: Record<string, MeasurementResultDoc>;
}): MeasurementResultDoc | null {
  const doc = m.results?.[m.kind];
  if (doc) return doc;
  if (m.results && Object.keys(m.results).length > 0) return null; // other kinds computed, not this one
  return m.result ?? null; // legacy single-result row
}

/** Numeric metrics of a measurement result — handles BOTH shapes: the §7.1 v1
 * doc ({version, metrics:{...}, provenance, error}) and legacy flat maps. The
 * doc envelope's `version` must never render as a metric. */
export function metricsOf(result: MeasurementResultDoc | null | undefined): Record<string, number> {
  if (!result || typeof result !== "object") return {};
  const metrics = result.metrics;
  if (metrics && typeof metrics === "object") {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(metrics)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(result)) {
    if (k === "version") continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** The failure block of a v1 result doc, when present. */
export function resultErrorOf(
  result: MeasurementResultDoc | null | undefined
): { class: string; message: string } | null {
  const err = result?.error;
  if (err && typeof err.class === "string" && typeof err.message === "string") {
    return { class: err.class, message: err.message };
  }
  return null;
}

/** The provenance block ("receipt") of a v1 result doc, when present. */
export function provenanceOf(result: MeasurementResultDoc | null | undefined) {
  const prov = result?.provenance;
  if (!prov || typeof prov !== "object") return null;
  return prov;
}
