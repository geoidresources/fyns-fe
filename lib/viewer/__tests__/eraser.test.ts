import { test } from "node:test";
import assert from "node:assert/strict";

import { eraseSegment } from "../eraser.ts";

// Points are plain strings — eraseSegment is generic and geometry-free.

test("lone line: erasing its only segment erases everything", () => {
  assert.deepEqual(eraseSegment(["A", "B"], 0, false), []);
});

test("2-point 'polygon' draft degenerates to a lone line and fully erases", () => {
  assert.deepEqual(eraseSegment(["A", "B"], 0, true), []);
});

test("polyline: end segments drop only their end vertex", () => {
  assert.deepEqual(eraseSegment(["A", "B", "C", "D"], 0, false), ["B", "C", "D"]);
  assert.deepEqual(eraseSegment(["A", "B", "C", "D"], 2, false), ["A", "B", "C"]);
});

test("polyline: middle segment keeps the longer chain (no invented chord)", () => {
  // A-B-C-D-E, erase C→D: left {A,B,C} beats right {D,E}
  assert.deepEqual(eraseSegment(["A", "B", "C", "D", "E"], 2, false), ["A", "B", "C"]);
  // tie keeps the left chain
  assert.deepEqual(eraseSegment(["A", "B", "C", "D"], 1, false), ["A", "B"]);
});

test("polygon: erasing an edge keeps EVERY vertex and reopens the ring there", () => {
  // Ring A-B-C-D(-A), erase B→C (idx 1) → open chain starting at C: C,D,A,B
  assert.deepEqual(eraseSegment(["A", "B", "C", "D"], 1, true), ["C", "D", "A", "B"]);
  // Erase A→B (idx 0) → B,C,D,A
  assert.deepEqual(eraseSegment(["A", "B", "C", "D"], 0, true), ["B", "C", "D", "A"]);
});

test("polygon: erasing the closing edge is the identity rotation (opens where it already ends)", () => {
  assert.deepEqual(eraseSegment(["A", "B", "C", "D"], 3, true), ["A", "B", "C", "D"]);
});

test("polygon: triangle keeps all three vertices whichever edge is erased", () => {
  assert.deepEqual(eraseSegment(["A", "B", "C"], 0, true), ["B", "C", "A"]);
  assert.deepEqual(eraseSegment(["A", "B", "C"], 1, true), ["C", "A", "B"]);
  assert.deepEqual(eraseSegment(["A", "B", "C"], 2, true), ["A", "B", "C"]);
});

test("out-of-range or degenerate input returns null (click ignored)", () => {
  assert.equal(eraseSegment(["A", "B", "C"], 3, true), null); // ring has 3 edges: 0..2
  assert.equal(eraseSegment(["A", "B", "C"], 2, false), null); // open chain has 2 edges: 0..1
  assert.equal(eraseSegment(["A"], 0, false), null);
  assert.equal(eraseSegment(["A", "B"], -1, false), null);
});
