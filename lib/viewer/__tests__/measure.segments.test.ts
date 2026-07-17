import { test } from "node:test";
import assert from "node:assert/strict";

import { distancePointToSegment2D } from "../measure.ts";

// Segment-ERASE semantics moved to lib/viewer/eraser.ts (see eraser.test.ts) —
// the old removeSegmentKeepLongerChain polygon behavior (drop a vertex) was
// replaced by ring rotation that keeps every vertex.

test("distancePointToSegment2D is zero on the segment and grows off it", () => {
  assert.equal(distancePointToSegment2D(5, 0, 0, 0, 10, 0), 0);
  assert.equal(distancePointToSegment2D(5, 3, 0, 0, 10, 0), 3);
  assert.ok(distancePointToSegment2D(-2, 0, 0, 0, 10, 0) > 1.9);
});
