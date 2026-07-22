import { test } from "node:test";
import assert from "node:assert/strict";

import { rankEntries, scoreMatch } from "../palette.ts";

test("empty query keeps authored order and matches everything", () => {
  const items = [{ label: "Line" }, { label: "Polygon" }, { label: "Point" }];
  assert.deepEqual(rankEntries(items, "").map((i) => i.label), ["Line", "Polygon", "Point"]);
});

test("substring beats subsequence; earlier substring beats later", () => {
  assert.ok(scoreMatch("line", "Line")! > scoreMatch("line", "polyline lens")!);
  assert.ok(scoreMatch("con", "Contours")! > scoreMatch("con", "Section contours")!);
});

test("no match returns null and drops the entry", () => {
  assert.equal(scoreMatch("xyz", "Line"), null);
  const ranked = rankEntries([{ label: "Line" }, { label: "Xylophone zebra" }], "xyz");
  assert.deepEqual(ranked.map((i) => i.label), ["Xylophone zebra"]);
});

test("subsequence must be in order", () => {
  assert.equal(scoreMatch("ba", "abc"), null); // 'b' then 'a' — out of order
  assert.ok(scoreMatch("ab", "abc")! > 0);
});

test("word-start subsequence outranks buried one", () => {
  // "hs" hits the two word starts of "Hill Shade"-style text.
  const a = scoreMatch("hs", "hill shade")!;
  const b = scoreMatch("hs", "wash shreds")!;
  assert.ok(a > b);
});

test("label hit outranks keyword-only hit", () => {
  const items = [
    { label: "Sun lighting", keywords: "shadow lens" },
    { label: "Hillshade", keywords: "sun relief" },
  ];
  assert.equal(rankEntries(items, "sun")[0].label, "Sun lighting");
});

test("measurement names rank sensibly for partial typing", () => {
  const items = [
    { label: "Untitled stockpile", keywords: "measurement" },
    { label: "North pit haul road", keywords: "measurement" },
    { label: "Stock check bench", keywords: "measurement" },
  ];
  // A prefix hit outranks a mid-string hit (standard palette behavior), and
  // both stock matches beat the non-match, which is dropped entirely.
  assert.deepEqual(
    rankEntries(items, "stock").map((i) => i.label),
    ["Stock check bench", "Untitled stockpile"]
  );
  assert.equal(rankEntries(items, "haul")[0].label, "North pit haul road");
});
