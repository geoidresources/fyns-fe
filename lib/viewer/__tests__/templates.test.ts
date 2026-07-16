import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MEASUREMENT_TEMPLATES,
  primitiveToDrawMode,
  defaultTemplateForPrimitive,
  templatesForPrimitive,
  getTemplate,
} from "../templates.ts";

const PRIMITIVES = ["point", "polyline", "polygon"] as const;

// Verified asset-svc measurement kind enum.
const KIND_ENUM = new Set([
  "stockpile",
  "volume",
  "cut_fill",
  "cross_section",
  "contour",
  "tin",
]);

test("template ids are unique", () => {
  const ids = MEASUREMENT_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("exactly one default per primitive", () => {
  for (const p of PRIMITIVES) {
    const defaults = templatesForPrimitive(p).filter((t) => t.default);
    assert.equal(defaults.length, 1, `${p} should have exactly one default`);
  }
});

test("every kind is null or a member of the asset-svc enum", () => {
  for (const t of MEASUREMENT_TEMPLATES) {
    assert.ok(
      t.kind === null || KIND_ENUM.has(t.kind),
      `${t.id} has invalid kind ${t.kind}`
    );
  }
});

test("cut_fill template carries explicit from/to params (§4.3)", () => {
  const t = getTemplate("poly.cutfill-previous");
  assert.ok(t);
  assert.equal(t.kind, "cut_fill");
  assert.deepEqual(t.params, {
    from: { type: "previous_survey", surface: "dsm" },
    to: { type: "survey_terrain", surface: "dsm" },
  });
});

test("smart-base volume omits params (server §3.1 default applies)", () => {
  const t = getTemplate("poly.volume-smart");
  assert.ok(t);
  assert.equal(t.kind, "volume");
  assert.equal(t.params, undefined);
});

test("primitiveToDrawMode maps polygon/polyline and nulls point (probe)", () => {
  assert.equal(primitiveToDrawMode("polygon"), "polygon");
  assert.equal(primitiveToDrawMode("polyline"), "polyline");
  assert.equal(primitiveToDrawMode("point"), null);
});

test("the per-primitive default templates are the expected ids", () => {
  assert.equal(defaultTemplateForPrimitive("point")?.id, "point.elevation");
  assert.equal(defaultTemplateForPrimitive("polyline")?.id, "line.distance");
  assert.equal(defaultTemplateForPrimitive("polygon")?.id, "poly.volume-smart");
});

test("folder hints are set on the folder-scoped templates", () => {
  assert.equal(getTemplate("line.haul-route")?.folder, "Haul road analysis");
  assert.equal(getTemplate("poly.stockpile")?.folder, "Stockpiles");
  assert.equal(getTemplate("poly.exclusion")?.folder, "Blasting");
  assert.equal(getTemplate("poly.blast")?.folder, "Blasting");
  assert.equal(getTemplate("poly.hydro")?.folder, "Hydro");
});

test("the grade template flags slope for a running-grade readout", () => {
  assert.equal(getTemplate("line.grade")?.slope, true);
});
