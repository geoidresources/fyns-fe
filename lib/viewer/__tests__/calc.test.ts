import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CalcParamsError,
  DEFAULT_METHOD_STATE,
  calcTypesFor,
  crossSurveyRefs,
  defaultKindFor,
  isComputableKind,
  isVolumeKind,
  kindForCalcType,
  methodFromParams,
  metricsOf,
  provenanceOf,
  resultErrorOf,
  surfaceRefsForMethod,
} from "../calc.ts";

// ---------------------------------------------------------------- calc types

test("kindForCalcType maps ids to backend kinds within the geometry mode", () => {
  assert.equal(kindForCalcType("stockpile", "polygon"), "stockpile");
  assert.equal(kindForCalcType("cut-fill", "polygon"), "cut_fill");
  assert.equal(kindForCalcType("area", "polygon"), "area");
  assert.equal(kindForCalcType("cross-section", "polyline"), "cross_section");
  assert.equal(kindForCalcType("length", "polyline"), "distance");
});

test("kindForCalcType rejects a stale pick from another geometry", () => {
  // A polygon pick must not leak onto a freshly drawn line (and vice versa).
  assert.equal(kindForCalcType("stockpile", "polyline"), null);
  assert.equal(kindForCalcType("cross-section", "polygon"), null);
  assert.equal(kindForCalcType(null, "polygon"), null);
});

test("calcTypesFor idle offers nothing; volume types flag needsBase", () => {
  assert.deepEqual(calcTypesFor("idle"), []);
  const polygon = calcTypesFor("polygon");
  assert.ok(polygon.find((t) => t.id === "stockpile")?.needsBase);
  assert.ok(polygon.find((t) => t.id === "cut-fill")?.needsBase);
  assert.equal(polygon.find((t) => t.id === "area")?.needsBase, undefined);
});

test("defaultKindFor is the panel's displayed default — saved kind == shown pick", () => {
  assert.equal(defaultKindFor("polygon"), "stockpile");
  assert.equal(defaultKindFor("polyline"), "distance");
});

test("isVolumeKind matches the backend's unified volume-compute set", () => {
  for (const k of ["volume", "stockpile", "cut_fill"]) assert.ok(isVolumeKind(k));
  for (const k of ["cross_section", "area", "distance", "elevation"]) assert.ok(!isVolumeKind(k));
});

test("isComputableKind adds cross_section to the volume family (Run row gate)", () => {
  // The volume family plus cross_section dispatch a compute today.
  for (const k of ["volume", "stockpile", "cut_fill", "cross_section"]) assert.ok(isComputableKind(k));
  // Geometry-only kinds have no compute path yet — no Run row.
  for (const k of ["area", "distance", "elevation", "contour"]) assert.ok(!isComputableKind(k));
});

// ------------------------------------------------------------- surface refs

test("smart-base emits the contract's stockpile pair (from=base, to=survey dsm)", () => {
  const { from, to } = surfaceRefsForMethod(DEFAULT_METHOD_STATE);
  assert.deepEqual(from, { type: "smart_base" });
  assert.deepEqual(to, { type: "survey_terrain", surface: "dsm" });
});

test("reference-rl custom requires an elevation and emits elevation_m", () => {
  assert.throws(
    () => surfaceRefsForMethod({ ...DEFAULT_METHOD_STATE, method: "reference-rl", refMode: "custom" }),
    CalcParamsError
  );
  const { from } = surfaceRefsForMethod({
    method: "reference-rl",
    refMode: "custom",
    refElevation: 72.5,
    baseDesignId: null,
  });
  assert.deepEqual(from, { type: "reference_level", elevation_m: 72.5 });
});

test("reference-rl derive modes emit derive, never elevation_m (§3.1 XOR)", () => {
  for (const refMode of ["lowest_vertex", "highest_vertex"] as const) {
    const { from } = surfaceRefsForMethod({
      method: "reference-rl",
      refMode,
      refElevation: 99, // stale custom value must not leak into a derive ref
      baseDesignId: null,
    });
    assert.deepEqual(from, { type: "reference_level", derive: refMode });
  }
});

test("previous-survey and design emit their refs; design requires an id", () => {
  const prev = surfaceRefsForMethod({ ...DEFAULT_METHOD_STATE, method: "previous-survey" });
  assert.deepEqual(prev.from, { type: "previous_survey", surface: "dsm" });

  assert.throws(
    () => surfaceRefsForMethod({ ...DEFAULT_METHOD_STATE, method: "design-surface" }),
    CalcParamsError
  );
  const design = surfaceRefsForMethod({
    ...DEFAULT_METHOD_STATE,
    method: "design-surface",
    baseDesignId: "d-1",
  });
  assert.deepEqual(design.from, { type: "design", design_id: "d-1" });
});

test("custom-base is a guided error until its editor exists", () => {
  assert.throws(
    () => surfaceRefsForMethod({ ...DEFAULT_METHOD_STATE, method: "custom-base" }),
    CalcParamsError
  );
});

test("crossSurveyRefs names two explicit surveys as survey_terrain from/to (Compare Mode)", () => {
  // from = epoch A ("before"), to = epoch B ("after") — the VolumeDiff pair.
  assert.deepEqual(crossSurveyRefs("a-1", "b-2"), {
    from: { type: "survey_terrain", survey_id: "a-1", surface: "dsm" },
    to: { type: "survey_terrain", survey_id: "b-2", surface: "dsm" },
  });
});

// --------------------------------------------------- params → method state

test("methodFromParams round-trips every emitted ref shape", () => {
  const cases = [
    { ...DEFAULT_METHOD_STATE, method: "smart-base" },
    { method: "reference-rl", refMode: "custom" as const, refElevation: 71.2, baseDesignId: null },
    { method: "reference-rl", refMode: "highest_vertex" as const, refElevation: null, baseDesignId: null },
    { ...DEFAULT_METHOD_STATE, method: "previous-survey" },
    { ...DEFAULT_METHOD_STATE, method: "design-surface", baseDesignId: "d-9" },
  ];
  for (const state of cases) {
    const refs = surfaceRefsForMethod(state);
    const back = methodFromParams({ from: refs.from, to: refs.to });
    assert.ok(back, `round-trip lost ${state.method}`);
    assert.equal(back.method, state.method);
    if (state.method === "reference-rl") {
      assert.equal(back.refMode, state.refMode);
      assert.equal(back.refElevation, state.refElevation);
    }
    if (state.method === "design-surface") assert.equal(back.baseDesignId, state.baseDesignId);
  }
});

test("methodFromParams falls back to legacy volume_method, else null", () => {
  assert.equal(methodFromParams({ volume_method: "reference-rl" })?.method, "reference-rl");
  assert.equal(methodFromParams({}), null);
  assert.equal(methodFromParams(null), null);
});

// ------------------------------------------------------------- result docs

test("metricsOf reads the v1 doc's nested metrics and drops the envelope", () => {
  const doc = {
    version: 1,
    semantics: "cut_fill_v1",
    metrics: { cut_volume_m3: 0.54, fill_volume_m3: 581.89, net_change_m3: 581.35, samples: 28052 },
    provenance: { processor: "volume-compute" },
  };
  const m = metricsOf(doc);
  assert.equal(m.net_change_m3, 581.35);
  assert.equal(m.version, undefined); // the "Version 1" leak, fixed
  assert.equal(Object.keys(m).length, 4);
});

test("metricsOf keeps legacy flat maps working (minus version)", () => {
  const m = metricsOf({ area_m2: 421.3, perimeter_m: 80, version: 1 });
  assert.deepEqual(m, { area_m2: 421.3, perimeter_m: 80 });
  assert.deepEqual(metricsOf(null), {});
});

test("resultErrorOf and provenanceOf expose failure reason and receipt", () => {
  const failed = { version: 1, error: { class: "params_invalid", message: "boundary outside grid" } };
  assert.deepEqual(resultErrorOf(failed), { class: "params_invalid", message: "boundary outside grid" });
  assert.equal(resultErrorOf({ version: 1 }), null);

  const prov = provenanceOf({ version: 1, provenance: { processor: "volume-compute", tools: { gdal: "3.8" } } });
  assert.equal(prov?.processor, "volume-compute");
  assert.equal(provenanceOf({ version: 1 }), null);
});

// --------------------------------------------- kind-aware base methods

test("methodsForKind: stockpile and cut_fill get distinct, stub-free lists", async () => {
  const { methodsForKind, defaultMethodForKind } = await import("../calc.ts");
  assert.deepEqual(
    methodsForKind("stockpile").map((m) => m.id),
    ["smart-base", "reference-rl"]
  );
  assert.deepEqual(
    methodsForKind("cut_fill").map((m) => m.id),
    ["previous-survey", "design-surface", "reference-rl"]
  );
  // custom-base is engine-ready but has no editor — never offered.
  assert.ok(!methodsForKind("stockpile").some((m) => m.id === "custom-base"));
  assert.deepEqual(methodsForKind("area"), []); // non-volume: no base methods
  assert.equal(defaultMethodForKind("stockpile"), "smart-base");
  assert.equal(defaultMethodForKind("cut_fill"), "previous-survey");
  assert.equal(defaultMethodForKind("distance"), null);
});

test("coerceMethodForKind snaps foreign methods to the kind's default", async () => {
  const { coerceMethodForKind } = await import("../calc.ts");
  const smart = { ...DEFAULT_METHOD_STATE, method: "smart-base" };
  // stockpile keeps smart-base; cut_fill snaps it to previous-survey.
  assert.equal(coerceMethodForKind(smart, "stockpile").method, "smart-base");
  assert.equal(coerceMethodForKind(smart, "cut_fill").method, "previous-survey");
  // valid picks pass through untouched; non-volume kinds never coerce.
  const design = { ...DEFAULT_METHOD_STATE, method: "design-surface", baseDesignId: "d1" };
  assert.equal(coerceMethodForKind(design, "cut_fill").method, "design-surface");
  assert.equal(coerceMethodForKind(design, "cut_fill").baseDesignId, "d1");
  assert.equal(coerceMethodForKind(smart, "area").method, "smart-base");
});

// ------------------------------------------------ per-kind result selection

test("resultForKind: map hit, map miss, legacy fallback", async () => {
  const { resultForKind } = await import("../calc.ts");
  const spDoc = { version: 1, metrics: { volume_m3: 581 } };
  const cfDoc = { version: 1, metrics: { net_change_m3: -42 } };
  // Map hit: each kind sees ITS doc.
  const m = { kind: "stockpile", results: { stockpile: spDoc, cut_fill: cfDoc } };
  assert.equal(resultForKind(m), spDoc);
  assert.equal(resultForKind({ ...m, kind: "cut_fill" }), cfDoc);
  // Map miss with OTHER kinds computed → null (this type not computed yet).
  assert.equal(resultForKind({ kind: "area", results: { stockpile: spDoc } }), null);
  // Legacy row (no map): the single result attributes to the current kind.
  assert.equal(resultForKind({ kind: "stockpile", result: spDoc }), spDoc);
  // Nothing anywhere → null.
  assert.equal(resultForKind({ kind: "stockpile" }), null);
});
