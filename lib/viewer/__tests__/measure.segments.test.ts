import { test } from "node:test";
import assert from "node:assert/strict";

import { adjacentSegmentIndex, distancePointToSegment2D } from "../measure.ts";

// Segment-ERASE semantics moved to lib/viewer/eraser.ts (see eraser.test.ts) —
// the old removeSegmentKeepLongerChain polygon behavior (drop a vertex) was
// replaced by ring rotation that keeps every vertex.

test("distancePointToSegment2D is zero on the segment and grows off it", () => {
  assert.equal(distancePointToSegment2D(5, 0, 0, 0, 10, 0), 0);
  assert.equal(distancePointToSegment2D(5, 3, 0, 0, 10, 0), 3);
  assert.ok(distancePointToSegment2D(-2, 0, 0, 0, 10, 0) > 1.9);
});

// adjacentSegmentIndex — the vertex-to-vertex eraser maps two picked vertices to
// the single edge between them (or null when they aren't neighbors).
test("adjacentSegmentIndex maps consecutive vertices to the lower segment index", () => {
  assert.equal(adjacentSegmentIndex(1, 2, 5, true), 1);
  assert.equal(adjacentSegmentIndex(2, 1, 5, true), 1); // order-independent
  assert.equal(adjacentSegmentIndex(3, 4, 5, false), 3);
});

test("adjacentSegmentIndex: closing edge of a ring is segment n-1", () => {
  assert.equal(adjacentSegmentIndex(0, 4, 5, true), 4);
  assert.equal(adjacentSegmentIndex(4, 0, 5, true), 4);
});

test("adjacentSegmentIndex rejects non-adjacent, self, and open-chain wrap", () => {
  assert.equal(adjacentSegmentIndex(0, 2, 5, true), null); // not neighbors
  assert.equal(adjacentSegmentIndex(2, 2, 5, true), null); // same vertex
  assert.equal(adjacentSegmentIndex(0, 4, 5, false), null); // open chain: no wrap edge
});
