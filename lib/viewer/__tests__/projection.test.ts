import { test } from "node:test";
import assert from "node:assert/strict";

import { getWorkingTransform } from "../projection.ts";

test("EPSG:32756 resolves via computed UTM and forwards lon/lat→E/N", async () => {
  const t = await getWorkingTransform("EPSG:32756");
  assert.ok(t, "transform resolved");
  assert.equal(t.source, "utm");
  assert.equal(t.code, 32756);
  assert.match(t.def, /\+proj=utm \+zone=56 \+south/);

  // Sydney (151.2093, -33.8688) in WGS84 / UTM 56S — reference easting/northing
  // are authoritative EPSG:32756 values; a >1 m miss means a wrong zone or
  // hemisphere derivation.
  const [E, N] = t.forward([151.2093, -33.8688]);
  assert.ok(Math.abs(E - 334368.63) < 1.0, `E=${E}`);
  assert.ok(Math.abs(N - 6250948.35) < 1.0, `N=${N}`);
});

test("bare numeric code and northern-hemisphere UTM (32633) omit +south", async () => {
  const t = await getWorkingTransform("32633"); // WGS84 / UTM 33N
  assert.ok(t);
  assert.equal(t.source, "utm");
  assert.equal(t.code, 32633);
  assert.match(t.def, /\+zone=33 /);
  assert.doesNotMatch(t.def, /\+south/);
});

test("curated table resolves MGA2020 zone 56 (EPSG:7856)", async () => {
  const t = await getWorkingTransform("EPSG:7856");
  assert.ok(t);
  assert.equal(t.source, "curated");
  assert.match(t.def, /\+proj=utm \+zone=56 \+south \+ellps=GRS80/);
});

test("an explicit +proj def is used directly (manifest working_crs_def)", async () => {
  const def = "+proj=utm +zone=56 +south +datum=WGS84 +units=m +no_defs";
  const t = await getWorkingTransform("EPSG:32756", def);
  assert.ok(t);
  assert.equal(t.source, "manifest");
  assert.equal(t.def, def);
});

test("blank / null / unparseable CRS resolves to null (graceful degradation)", async () => {
  // These return before any proj4 load or network — fully hermetic.
  assert.equal(await getWorkingTransform(null), null);
  assert.equal(await getWorkingTransform(undefined), null);
  assert.equal(await getWorkingTransform(""), null);
  // Parseable-looking but no numeric EPSG code → null before the epsg.io step.
  assert.equal(await getWorkingTransform("LOCAL-GRID"), null);
});

test("unknown numeric code with a failing epsg.io lookup resolves to null", async () => {
  // Node 25 ships a global fetch, so stub it to keep the epsg.io step hermetic
  // and exercise the network-failure → null branch (§4.6 step 4→5).
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 404,
    text: async () => "",
  })) as unknown as typeof fetch;
  try {
    assert.equal(await getWorkingTransform("EPSG:99999"), null);
  } finally {
    globalThis.fetch = original;
  }
});
