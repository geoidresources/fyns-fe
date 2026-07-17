// Eraser semantics (pure, geometry-library-free — generic over the point type
// so node tests need no Cesium import). The eraser removes ONE segment: the
// edge between two adjacent vertices, resolved by hit-test in the canvas
// layer (findNearestSegmentIndex).

/**
 * Erase the segment `points[i] → points[i+1]` (wrap for closed rings).
 *
 * Closed ring (polygon, n ≥ 3): every vertex is KEPT — the ring is rotated so
 * it now OPENS at the erased edge (`[i+1 … end, start … i]`). The caller
 * renders the draft un-closed, so exactly the picked edge disappears; adding
 * vertices then appends into that gap, and finishing re-closes the ring
 * (straight chord if nothing was added). Erasing the preview closing edge
 * (i === n-1) is the identity rotation — the ring simply opens where it
 * already ends.
 *
 * Open chain (polyline): the lone segment of a 2-point line erases the whole
 * line (`[]` — the caller deletes the draft/measurement); an end segment
 * drops its end vertex; a middle segment keeps the longer remaining chain
 * (no chord is invented across the gap).
 *
 * Returns the new vertex array, `[]` when the erase consumed everything, or
 * `null` for an out-of-range segment index (caller ignores the click).
 */
export function eraseSegment<T>(
  points: T[],
  segmentIndex: number,
  closed: boolean
): T[] | null {
  const n = points.length;
  if (n < 2 || segmentIndex < 0) return null;

  if (closed && n >= 3) {
    if (segmentIndex >= n) return null;
    const cut = (segmentIndex + 1) % n;
    return [...points.slice(cut), ...points.slice(0, cut)];
  }

  // Open chain (a 2-point "polygon" draft degenerates to a lone line).
  if (segmentIndex >= n - (closed ? 0 : 1)) return null;
  if (n === 2) return [];
  if (segmentIndex === 0) return points.slice(1);
  if (segmentIndex === n - 2) return points.slice(0, -1);
  const left = points.slice(0, segmentIndex + 1);
  const right = points.slice(segmentIndex + 1);
  return left.length >= right.length ? left : right;
}
