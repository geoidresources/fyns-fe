import { test } from "node:test";
import assert from "node:assert/strict";

import {
  measurementsToCsv,
  metricColumns,
  metricLabel,
  reportTotals,
  type ReportRow,
} from "../exportReport.ts";

const row = (over: Partial<ReportRow>): ReportRow => ({
  name: "m",
  kind: "stockpile",
  folder: null,
  status: "completed",
  metrics: {},
  ...over,
});

test("empty set → header only", () => {
  const csv = measurementsToCsv([]);
  assert.equal(csv, "Name,Kind,Folder,Status");
});

test("known metric columns are curated-ordered, extras alphabetical", () => {
  const rows = [
    row({ metrics: { area_m2: 5, zeta_custom: 1, volume_m3: 10 } }),
    row({ metrics: { alpha_custom: 2 } }),
  ];
  // volume before area (curated), then extras alpha: alpha_custom, zeta_custom
  assert.deepEqual(metricColumns(rows), ["volume_m3", "area_m2", "alpha_custom", "zeta_custom"]);
});

test("labels map known keys and title-case unknowns", () => {
  assert.equal(metricLabel("net_change_m3"), "Net change (m³)");
  assert.equal(metricLabel("some_new_metric"), "Some New Metric");
});

test("RFC-4180 quoting: commas, quotes, newlines", () => {
  const csv = measurementsToCsv([
    row({ name: 'Pile "A", north', folder: "Line\nbreak", metrics: { volume_m3: 1234.567 } }),
  ]);
  const [, dataLine] = csv.split("\r\n");
  // quotes doubled, comma-bearing field quoted, newline field quoted, number 2dp
  assert.ok(dataLine.startsWith('"Pile ""A"", north",stockpile,"Line\nbreak",completed,1234.57'));
});

test("missing metric → blank cell, not zero", () => {
  const csv = measurementsToCsv([
    row({ metrics: { volume_m3: 10 } }),
    row({ name: "line", kind: "distance", metrics: { length_m: 4 } }),
  ]);
  const lines = csv.split("\r\n");
  // header: Name,Kind,Folder,Status,Volume (m³),Length (m)
  assert.equal(lines[0], "Name,Kind,Folder,Status,Volume (m³),Length (m)");
  assert.equal(lines[1], "m,stockpile,,completed,10,");     // no length → trailing blank
  assert.equal(lines[2], "line,distance,,completed,,4");    // no volume → middle blank
});

test("totals: sums volume + net, tallies kinds, nulls when absent", () => {
  const t = reportTotals([
    row({ kind: "stockpile", metrics: { volume_m3: 100 } }),
    row({ kind: "stockpile", metrics: { volume_m3: 50 } }),
    row({ kind: "cut_fill", metrics: { net_change_m3: -20 } }),
    row({ kind: "distance", metrics: { length_m: 9 } }),
  ]);
  assert.equal(t.count, 4);
  assert.equal(t.stockpileVolumeM3, 150);
  assert.equal(t.netChangeM3, -20);
  assert.deepEqual(t.byKind[0], { kind: "stockpile", count: 2 });
});

test("totals null when no measurement carries the metric", () => {
  const t = reportTotals([row({ kind: "distance", metrics: { length_m: 3 } })]);
  assert.equal(t.stockpileVolumeM3, null);
  assert.equal(t.netChangeM3, null);
});
