import { test } from "node:test";
import assert from "node:assert/strict";

import { convertForDisplay, quantityOf, unitSystemOf } from "../units.ts";
import { DEFAULT_STYLE, styleOf } from "../style.ts";

test("quantityOf classifies metric keys by suffix", () => {
  assert.equal(quantityOf("net_change_m3"), "volume");
  assert.equal(quantityOf("tonnage_t"), "mass");
  assert.equal(quantityOf("area_m2"), "area");
  assert.equal(quantityOf("perimeter_m"), "length");
  assert.equal(quantityOf("grade_percent"), "percent");
  assert.equal(quantityOf("samples"), "count");
});

test("convertForDisplay: metric passthrough, imperial converts", () => {
  assert.deepEqual(convertForDisplay("volume_m3", 100, "metric"), { value: 100, unit: "m³" });
  const yd = convertForDisplay("volume_m3", 100, "imperial");
  assert.equal(yd.unit, "yd³");
  assert.ok(Math.abs(yd.value - 130.795) < 0.01);
  const tons = convertForDisplay("tonnage_t", 100, "imperial");
  assert.equal(tons.unit, "tons");
  assert.ok(Math.abs(tons.value - 110.231) < 0.01);
  // Percent/count never convert.
  assert.deepEqual(convertForDisplay("grade_percent", 12, "imperial"), { value: 12, unit: "%" });
});

test("unitSystemOf defaults metric, reads params.units", () => {
  assert.equal(unitSystemOf(null), "metric");
  assert.equal(unitSystemOf({ units: "imperial" }), "imperial");
  assert.equal(unitSystemOf({ units: "bogus" }), "metric");
});

test("styleOf: defaults, partial merge, junk tolerance, clamping", () => {
  assert.deepEqual(styleOf(null), DEFAULT_STYLE);
  const st = styleOf({ style: { fill: "#3B82F6", fillOpacity: 0.5, strokeStyle: "dashed" } });
  assert.equal(st.fill, "#3B82F6");
  assert.equal(st.fillOpacity, 0.5);
  assert.equal(st.strokeStyle, "dashed");
  assert.equal(st.strokeWidth, DEFAULT_STYLE.strokeWidth); // untouched → default
  const junk = styleOf({ style: { fill: "javascript:alert(1)", fillOpacity: 99, labelSize: 1 } });
  assert.equal(junk.fill, DEFAULT_STYLE.fill); // non-color rejected
  assert.equal(junk.fillOpacity, 1); // clamped
  assert.equal(junk.labelSize, 9); // clamped to min
});
