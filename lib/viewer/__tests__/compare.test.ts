import { test } from "node:test";
import assert from "node:assert/strict";

import type { Survey } from "../../api/assetSvc.ts";
import {
  cumulativeEpochSeries,
  defaultBeforeId,
  netChangeFromMetrics,
  nextCompareSeed,
  sortSurveysChronological,
  sparklineGeometry,
  temporalComparePair,
  validEpochPrefix,
} from "../compare.ts";

// Minimal fixture — the compare helpers only read id + survey_date.
const sv = (id: string, survey_date: string): Survey =>
  ({ id, survey_date }) as unknown as Survey;

// -------------------------------------------------------------- sort + seed

test("sortSurveysChronological orders oldest→newest and drops undated", () => {
  const out = sortSurveysChronological([
    sv("c", "2024-03-01"),
    sv("a", "2024-01-01"),
    sv("x", ""), // undated — cannot be placed on the timeline
    sv("b", "2024-02-01"),
  ]);
  assert.deepEqual(
    out.map((s) => s.id),
    ["a", "b", "c"]
  );
});

test("defaultBeforeId returns the immediately-earlier epoch", () => {
  const list = [sv("a", "2024-01-01"), sv("b", "2024-02-01"), sv("c", "2024-03-01")];
  assert.equal(defaultBeforeId(list, "c"), "b");
  assert.equal(defaultBeforeId(list, "b"), "a");
});

test("defaultBeforeId on the earliest falls back to next-newer (never self)", () => {
  const list = [sv("a", "2024-01-01"), sv("b", "2024-02-01")];
  assert.equal(defaultBeforeId(list, "a"), "b");
});

test("defaultBeforeId: unknown current → newest; empty list → null", () => {
  const list = [sv("a", "2024-01-01"), sv("b", "2024-02-01")];
  assert.equal(defaultBeforeId(list, "zzz"), "b");
  assert.equal(defaultBeforeId([], "a"), null);
});

test("nextCompareSeed seeds B=current, A=prev epoch when unset", () => {
  const surveys = [sv("a", "2024-01-01"), sv("b", "2024-02-01"), sv("c", "2024-03-01")];
  assert.deepEqual(
    nextCompareSeed({ surveyId: "c", surveys, compareA: null, compareB: null }),
    { a: "b", b: "c" }
  );
});

test("nextCompareSeed preserves an already-picked A/B (idempotent toggle)", () => {
  const surveys = [sv("a", "2024-01-01"), sv("b", "2024-02-01"), sv("c", "2024-03-01")];
  assert.deepEqual(
    nextCompareSeed({ surveyId: "c", surveys, compareA: "a", compareB: "b" }),
    { a: "a", b: "b" }
  );
});

// ------------------------------------------------------- temporal pair detect

test("temporalComparePair detects a two-survey diff and orders A→B", () => {
  const params = {
    from: { type: "survey_terrain", survey_id: "a-1", surface: "dsm" },
    to: { type: "survey_terrain", survey_id: "b-2", surface: "dsm" },
  };
  assert.deepEqual(temporalComparePair(params), { aId: "a-1", bId: "b-2" });
});

test("temporalComparePair rejects single-survey and same-survey params", () => {
  // Normal stockpile: from=smart_base, to=survey_terrain WITHOUT survey_id.
  assert.equal(
    temporalComparePair({
      from: { type: "smart_base" },
      to: { type: "survey_terrain", surface: "dsm" },
    }),
    null
  );
  // previous-survey cut/fill: from is previous_survey, not an explicit survey.
  assert.equal(
    temporalComparePair({
      from: { type: "previous_survey", surface: "dsm" },
      to: { type: "survey_terrain", surface: "dsm" },
    }),
    null
  );
  // Same survey both sides → nothing to diff.
  assert.equal(
    temporalComparePair({
      from: { type: "survey_terrain", survey_id: "x", surface: "dsm" },
      to: { type: "survey_terrain", survey_id: "x", surface: "dsm" },
    }),
    null
  );
  assert.equal(temporalComparePair(null), null);
  assert.equal(temporalComparePair({}), null);
});

// ---------------------------------------------------- trajectory sparkline math

test("netChangeFromMetrics prefers net_change_m3 when finite", () => {
  assert.equal(netChangeFromMetrics({ net_change_m3: 4200 }), 4200);
  assert.equal(netChangeFromMetrics({ net_change_m3: -800, fill_volume_m3: 10, cut_volume_m3: 3 }), -800);
});

test("netChangeFromMetrics falls back to fill − cut when net is absent", () => {
  assert.equal(netChangeFromMetrics({ fill_volume_m3: 5000, cut_volume_m3: 1200 }), 3800);
  // fill − cut can be negative (a net loss).
  assert.equal(netChangeFromMetrics({ fill_volume_m3: 200, cut_volume_m3: 900 }), -700);
});

test("netChangeFromMetrics returns null when nothing is derivable", () => {
  assert.equal(netChangeFromMetrics(null), null);
  assert.equal(netChangeFromMetrics(undefined), null);
  assert.equal(netChangeFromMetrics({}), null);
  // Only one half of the split present → not derivable.
  assert.equal(netChangeFromMetrics({ fill_volume_m3: 500 }), null);
  // Non-finite values are ignored at every step.
  assert.equal(netChangeFromMetrics({ net_change_m3: Number.NaN }), null);
  assert.equal(
    netChangeFromMetrics({ net_change_m3: Number.POSITIVE_INFINITY, fill_volume_m3: 9, cut_volume_m3: 4 }),
    5
  );
});

test("cumulativeEpochSeries running-sums per-pair deltas from a zero origin", () => {
  const surveys = [sv("a", "2024-01-01"), sv("b", "2024-02-01"), sv("c", "2024-03-01")];
  // 0 → +4000 → +10900 (the task's worked example).
  const pts = cumulativeEpochSeries(surveys, [4000, 6900]);
  assert.deepEqual(
    pts.map((p) => p.cumulative),
    [0, 4000, 10900]
  );
  assert.deepEqual(
    pts.map((p) => p.surveyId),
    ["a", "b", "c"]
  );
  assert.equal(pts[0].date, "2024-01-01");
});

test("cumulativeEpochSeries: a gap nulls that epoch AND every later one", () => {
  const surveys = [sv("a", "1"), sv("b", "2"), sv("c", "3"), sv("d", "4")];
  // The b→c pair failed (null) — the running total can't cross it.
  const pts = cumulativeEpochSeries(surveys, [4000, null, 3000]);
  assert.deepEqual(
    pts.map((p) => p.cumulative),
    [0, 4000, null, null]
  );
});

test("cumulativeEpochSeries: a first-pair gap leaves only the origin", () => {
  const surveys = [sv("a", "1"), sv("b", "2"), sv("c", "3")];
  const pts = cumulativeEpochSeries(surveys, [null, 3000]);
  assert.deepEqual(
    pts.map((p) => p.cumulative),
    [0, null, null]
  );
});

test("cumulativeEpochSeries handles negative excursions and edge lengths", () => {
  const surveys = [sv("a", "1"), sv("b", "2"), sv("c", "3")];
  assert.deepEqual(
    cumulativeEpochSeries(surveys, [-2000, 500]).map((p) => p.cumulative),
    [0, -2000, -1500]
  );
  assert.deepEqual(cumulativeEpochSeries([], []), []);
  assert.deepEqual(
    cumulativeEpochSeries([sv("a", "1")], []).map((p) => p.cumulative),
    [0]
  );
});

test("validEpochPrefix keeps the contiguous resolved run and narrows the type", () => {
  const surveys = [sv("a", "1"), sv("b", "2"), sv("c", "3"), sv("d", "4")];
  const prefix = validEpochPrefix(cumulativeEpochSeries(surveys, [4000, null, 3000]));
  assert.equal(prefix.length, 2);
  assert.deepEqual(
    prefix.map((p) => p.cumulative),
    [0, 4000]
  );
  // A first-pair gap collapses to just the origin (caller then renders nothing).
  assert.equal(validEpochPrefix(cumulativeEpochSeries(surveys, [null, 1, 2])).length, 1);
  assert.deepEqual(validEpochPrefix([]), []);
});

test("sparklineGeometry maps a climb 0→bottom, max→top, baseline at 0", () => {
  const g = sparklineGeometry([0, 4000, 10900], { width: 200, height: 32, padX: 8, padY: 6 });
  // Evenly spaced across the inner width [8 … 192].
  assert.deepEqual(
    g.points.map((p) => p.x),
    [8, 100, 192]
  );
  // 0 sits on the baseline at the bottom; the max pins to the top pad.
  assert.equal(g.points[0].y, 26);
  assert.equal(g.points[2].y, 6);
  assert.equal(g.baselineY, 26);
  // y strictly decreases as the cumulative climbs.
  assert.ok(g.points[0].y > g.points[1].y && g.points[1].y > g.points[2].y);
});

test("sparklineGeometry lifts the baseline when values go negative", () => {
  const g = sparklineGeometry([0, -3000], { width: 200, height: 32, padX: 8, padY: 6 });
  assert.equal(g.baselineY, 6); // 0 is now the top of the domain
  assert.equal(g.points[1].y, 26); // the trough pins to the bottom pad
});

test("sparklineGeometry collapses a flat/degenerate domain to the middle", () => {
  const g = sparklineGeometry([0, 0, 0], { width: 200, height: 32, padX: 8, padY: 6 });
  assert.deepEqual(
    g.points.map((p) => p.y),
    [16, 16, 16]
  );
  assert.equal(g.baselineY, 16);
  // A single point centers horizontally.
  const one = sparklineGeometry([0], { width: 200, height: 32, padX: 8, padY: 6 });
  assert.equal(one.points[0].x, 100);
});
