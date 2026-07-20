// Pure geometry validity checks for the interaction machine (plan §3, P2b-2).
// CESIUM-FREE: operates on opaque Vec3 {x,y,z} so it runs under `node --test`
// and can gate the COMMIT transition (machine guard) AND drive the adapter's
// pre-commit toast — one shared source of truth, mirroring hasMinPoints.

import type { Vec3 } from "./types.ts";

/** Project ECEF Vec3s to a local 2D plane by dropping the axis of LEAST spread.
 * Self-intersection is a topological property preserved under any non-degenerate
 * linear projection of a (near-)planar polygon — and the editor only produces
 * near-planar ground rings, whose two widest ECEF axes span them faithfully.
 * Best-effort: a wildly non-planar chain could skew, but that never reaches a
 * commit. Pure — no Cesium, no trig. */
function project2D(pts: Vec3[]): Array<readonly [number, number]> {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const rx = maxX - minX, ry = maxY - minY, rz = maxZ - minZ;
  // Keep the two axes with the greatest spread; drop the flattest.
  const drop = rz <= rx && rz <= ry ? "z" : ry <= rx ? "y" : "x";
  return pts.map((p) =>
    drop === "z" ? [p.x, p.y] as const : drop === "y" ? [p.x, p.z] as const : [p.y, p.z] as const
  );
}

type P2 = readonly [number, number];

/** Orientation sign of (p→q→r): +1 ccw, -1 cw, 0 collinear. */
const orient = (p: P2, q: P2, r: P2): number =>
  Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));

/** Do open segments (a,b) and (c,d) properly cross (interior point)? Collinear /
 * shared-endpoint touches return false — we only flag unambiguous crossings so
 * the guard never blocks a legitimate ring on a numerical edge case. */
function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** True if any two NON-ADJACENT edges of the draft cross. `closed` adds the
 * ring's closing edge (last→first). Fewer than 4 vertices can't self-cross. */
export function hasSelfIntersection(draft: Vec3[], closed: boolean): boolean {
  const n = draft.length;
  if (n < 4) return false;
  const pts = project2D(draft);
  const edges: Array<readonly [number, number]> = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1] as const);
  if (closed) edges.push([n - 1, 0] as const);
  const E = edges.length;
  for (let i = 0; i < E; i++) {
    for (let j = i + 1; j < E; j++) {
      const [a1, a2] = edges[i];
      const [b1, b2] = edges[j];
      // Adjacent edges share a vertex — a shared endpoint is not a crossing.
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      if (segmentsCross(pts[a1], pts[a2], pts[b1], pts[b2])) return true;
    }
  }
  return false;
}
