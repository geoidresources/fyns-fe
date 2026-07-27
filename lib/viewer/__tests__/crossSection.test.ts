import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCrossSectionPolyline,
  lineStringCoords,
  parseProfileDoc,
  profileChartGeometry,
  type ProfileDoc,
} from "../crossSection.ts";

// ------------------------------------------------------------- polyline input

test("lineStringCoords takes a ≥2-vertex line and drops any 3rd ordinate", () => {
  assert.deepEqual(
    lineStringCoords({ type: "LineString", coordinates: [[1, 2, 99], [3, 4]] }),
    [[1, 2], [3, 4]]
  );
});

test("lineStringCoords rejects non-lines and under-two-vertex lines", () => {
  assert.equal(lineStringCoords({ type: "Point", coordinates: [1, 2] }), null);
  assert.equal(lineStringCoords({ type: "LineString", coordinates: [[1, 2]] }), null);
  assert.equal(lineStringCoords({ type: "LineString", coordinates: "nope" as unknown as number[][] }), null);
  assert.equal(lineStringCoords(undefined), null);
  assert.equal(lineStringCoords(null), null);
});

test("buildCrossSectionPolyline is identity over a GEOGRAPHIC DSM (EPSG:4326)", async () => {
  // Mine Site case: lon/lat already IS the raster unit — coords pass through, no
  // proj4 load, no network.
  const line = { type: "LineString", coordinates: [[85.75, 20.25], [85.76, 20.26]] };
  assert.deepEqual(await buildCrossSectionPolyline(line, "EPSG:4326"), [
    [85.75, 20.25],
    [85.76, 20.26],
  ]);
});

test("buildCrossSectionPolyline reprojects lon/lat → E/N over a PROJECTED DSM", async () => {
  // Sydney in WGS84 / UTM 56S (EPSG:32756) — authoritative easting/northing; a
  // >1 m miss means the reprojection wired the wrong transform.
  const line = { type: "LineString", coordinates: [[151.2093, -33.8688], [151.21, -33.87]] };
  const out = await buildCrossSectionPolyline(line, "EPSG:32756");
  assert.ok(out, "polyline built");
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0][0] - 334368.63) < 1.0, `E=${out[0][0]}`);
  assert.ok(Math.abs(out[0][1] - 6250948.35) < 1.0, `N=${out[0][1]}`);
});

test("buildCrossSectionPolyline bails (null) on a bad line or unresolvable projected CRS", async () => {
  // Too few vertices → null regardless of CRS.
  assert.equal(await buildCrossSectionPolyline({ type: "LineString", coordinates: [[1, 2]] }, "EPSG:4326"), null);
  // Projected-but-unresolvable CRS → null (no numeric EPSG, so no network hit):
  // caller toasts instead of sending lon/lat to a projected raster.
  assert.equal(
    await buildCrossSectionPolyline({ type: "LineString", coordinates: [[1, 2], [3, 4]] }, "LOCAL-GRID"),
    null
  );
});

// --------------------------------------------------------------- profile doc

test("parseProfileDoc narrows samples, keeps z===null, and derives length_m", () => {
  const doc = parseProfileDoc({
    samples: [
      { distance_m: 0, x: 10, y: 20, z: 5.5 },
      { distance_m: 1, x: 11, y: 21, z: null },
      { distance_m: 2, x: 12, y: 22, z: 7 },
      { bad: true },
      { distance_m: "x", z: 9 },
    ],
    length_m: 2,
  });
  assert.ok(doc);
  assert.equal(doc.samples.length, 3); // the two malformed rows are dropped
  assert.equal(doc.samples[1].z, null); // nodata preserved as null, not 0
  assert.equal(doc.length_m, 2);
});

test("parseProfileDoc falls back to the last distance when length_m is missing", () => {
  const doc = parseProfileDoc({ samples: [{ distance_m: 0, z: 1 }, { distance_m: 12.5, z: 2 }] });
  assert.equal(doc?.length_m, 12.5);
});

test("parseProfileDoc rejects a shape mismatch (→ null, so the chart errors)", () => {
  assert.equal(parseProfileDoc(null), null);
  assert.equal(parseProfileDoc("nope"), null);
  assert.equal(parseProfileDoc({ length_m: 5 }), null); // no samples array
});

// ------------------------------------------------------------- chart geometry

const DIMS = { width: 320, height: 140, padX: 6, padY: 10 };

test("profileChartGeometry breaks the line at nodata gaps into separate runs", () => {
  const doc: ProfileDoc = {
    samples: [
      { distance_m: 0, x: 0, y: 0, z: 10 },
      { distance_m: 1, x: 0, y: 0, z: 12 },
      { distance_m: 2, x: 0, y: 0, z: null }, // gap
      { distance_m: 3, x: 0, y: 0, z: 14 },
      { distance_m: 4, x: 0, y: 0, z: 15 },
    ],
    length_m: 4,
  };
  const g = profileChartGeometry(doc, DIMS);
  assert.ok(g.hasData);
  assert.equal(g.lineSegments.length, 2, "one run before the gap, one after");
  assert.equal(g.areaSegments.length, 2);
  assert.equal(g.minZ, 10);
  assert.equal(g.maxZ, 15);
  assert.equal(g.lengthM, 4);
  // X maps 0 → padX (6) and length → width-padX (314); each point is "x,y".
  assert.ok(g.lineSegments[0].startsWith("6.0,"), g.lineSegments[0]);
  assert.ok(g.lineSegments[1].split(" ").pop()!.startsWith("314.0,"), g.lineSegments[1]);
});

test("profileChartGeometry reports hasData=false when every sample is nodata", () => {
  const doc: ProfileDoc = {
    samples: [
      { distance_m: 0, x: 0, y: 0, z: null },
      { distance_m: 1, x: 0, y: 0, z: null },
    ],
    length_m: 1,
  };
  const g = profileChartGeometry(doc, DIMS);
  assert.equal(g.hasData, false);
  assert.equal(g.lineSegments.length, 0);
});

test("profileChartGeometry pads a dead-flat profile so it never divides by zero", () => {
  const doc: ProfileDoc = {
    samples: [
      { distance_m: 0, x: 0, y: 0, z: 50 },
      { distance_m: 10, x: 0, y: 0, z: 50 },
    ],
    length_m: 10,
  };
  const g = profileChartGeometry(doc, DIMS);
  assert.ok(g.hasData);
  assert.equal(g.minZ, 49.5);
  assert.equal(g.maxZ, 50.5);
  assert.equal(g.lineSegments.length, 1);
  // Every finite y must be a real number (no NaN from a zero span).
  for (const seg of g.lineSegments) assert.ok(!seg.includes("NaN"), seg);
});
