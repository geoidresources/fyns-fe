import { test } from "node:test";
import assert from "node:assert/strict";

import { hasSelfIntersection } from "../validity.ts";
import type { Vec3 } from "../types.ts";

// 2D helper: lay points on the z=0 plane (project2D drops the flat z axis).
const v = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });

test("simple closed quad does not self-intersect", () => {
  const quad = [v(0, 0), v(2, 0), v(2, 2), v(0, 2)];
  assert.equal(hasSelfIntersection(quad, true), false);
});

test("bowtie closed quad self-intersects (crossed diagonals)", () => {
  // (0,0)->(2,2)->(2,0)->(0,2)->close: the two middle edges cross.
  const bowtie = [v(0, 0), v(2, 2), v(2, 0), v(0, 2)];
  assert.equal(hasSelfIntersection(bowtie, true), true);
});

test("open polyline that visually crosses is flagged", () => {
  // edge (0,0)-(2,2) crosses edge (2,0)-(0,2); they are non-adjacent.
  const chain = [v(0, 0), v(2, 2), v(2, 0), v(0, 2)];
  assert.equal(hasSelfIntersection(chain, false), true);
});

test("open L-shaped polyline does not self-intersect", () => {
  const chain = [v(0, 0), v(2, 0), v(2, 2)];
  assert.equal(hasSelfIntersection(chain, false), false);
});

test("closing edge is only considered when closed=true", () => {
  // A "Z" chain: as an open path the three edges never cross, but closing
  // last->first turns it into a crossed loop (closing edge x middle edge).
  const pts = [v(0, 0), v(3, 0), v(0, 2), v(3, 2)];
  assert.equal(hasSelfIntersection(pts, false), false);
  assert.equal(hasSelfIntersection(pts, true), true);
});

test("triangle can never self-intersect (n<4 short-circuits)", () => {
  const tri = [v(0, 0), v(2, 0), v(1, 2)];
  assert.equal(hasSelfIntersection(tri, true), false);
});

test("convex pentagon does not self-intersect", () => {
  const pent = [v(0, 0), v(2, 0), v(3, 2), v(1, 3), v(-1, 2)];
  assert.equal(hasSelfIntersection(pent, true), false);
});

test("detection survives a tilted (non-axis-aligned) supporting plane", () => {
  // Same bowtie, embedded on the plane z = 0.1x + 0.1y (z has least spread, so
  // project2D drops it and recovers the (x,y) bowtie).
  const lift = (x: number, y: number): Vec3 => ({ x, y, z: 0.1 * x + 0.1 * y });
  const bowtie = [lift(0, 0), lift(2, 2), lift(2, 0), lift(0, 2)];
  assert.equal(hasSelfIntersection(bowtie, true), true);
});

test("adjacent edges sharing a vertex are never a crossing", () => {
  // A spiky but simple (non-self-intersecting) closed quad.
  const spiky = [v(0, 0), v(4, 0), v(2, 1), v(4, 4)];
  assert.equal(hasSelfIntersection(spiky, true), false);
});
