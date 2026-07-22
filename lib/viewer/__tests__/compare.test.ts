import { test } from "node:test";
import assert from "node:assert/strict";

import type { Survey } from "../../api/assetSvc.ts";
import {
  defaultBeforeId,
  nextCompareSeed,
  sortSurveysChronological,
  temporalComparePair,
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
