// Survey data footprint from a 3D Tiles tileset — the lon/lat outline of where
// tile content actually exists, derived from the tile tree's leaf occupancy.
// Used to clip the global terrain under the survey (the survey surface owns
// the ground there), so the footprint must stay INSIDE the data: a hole that
// reaches past the mesh shows the void behind the globe. Everything here
// biases small — leaf bounds over loose parent cells, tight spec
// content.boundingVolume over the tile volume when present, cell centers over
// cell extents, and a final inward inset — and returns null over guessing.
//
// Pure module: no Cesium imports (runs under plain node for tests); callers
// convert the returned [lon, lat] ring to Cartesian3 themselves.

interface TileContent {
  uri?: string;
  url?: string; // pre-1.0 alias still emitted by some converters
  boundingVolume?: TileBoundingVolume;
}

interface TileBoundingVolume {
  box?: number[]; // [cx cy cz, xAxis*3, yAxis*3, zAxis*3] (half-axes)
  region?: number[]; // [west south east north minH maxH] radians
  sphere?: number[]; // [cx cy cz r]
}

interface TileNode {
  boundingVolume?: TileBoundingVolume;
  content?: TileContent;
  transform?: number[] | null;
  children?: TileNode[];
}

interface TilesetJson {
  root?: TileNode;
}

export interface FootprintOptions {
  /** Occupancy grid resolution across the data extent. */
  gridSize?: number;
  /** External tileset.json fetch budget; exceeding it aborts (returns null). */
  maxFetches?: number;
  /** Tree depth cap across external tileset boundaries. */
  maxDepth?: number;
  /** Inward offset of the outline, in grid cells. */
  insetCells?: number;
}

type Mat4 = number[]; // column-major, Cesium/glTF layout
type LonLat = [number, number]; // degrees

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function isMat4(t: unknown): t is Mat4 {
  return Array.isArray(t) && t.length === 16 && t.every((n) => typeof n === "number");
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// WGS84 ECEF → geodetic lon/lat (degrees). Iterative latitude refinement —
// converges in a handful of rounds at any terrestrial height.
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;
function ecefToLonLat(x: number, y: number, z: number): LonLat {
  const lon = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  for (let i = 0; i < 5; i++) {
    const sin = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
    lat = Math.atan2(z + WGS84_E2 * n * sin, p);
  }
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

// Monotone-chain convex hull — leaf boxes project to ≤8 points each.
function convexHull(points: LonLat[]): LonLat[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 3) return pts;
  const cross = (o: LonLat, a: LonLat, b: LonLat) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: LonLat[]) => {
    const h: LonLat[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half(pts.reverse())];
}

/** Lon/lat polygon of one bounding volume under the composed transform.
 * Null when the volume is missing or malformed. */
function volumeToPolygon(bv: TileBoundingVolume | undefined, m: Mat4): LonLat[] | null {
  if (!bv) return null;
  if (bv.region && bv.region.length >= 4) {
    const [w, s, e, n] = bv.region; // regions are EPSG:4979 — transforms do not apply
    const d = 180 / Math.PI;
    return [
      [w * d, s * d],
      [e * d, s * d],
      [e * d, n * d],
      [w * d, n * d],
    ];
  }
  if (bv.box && bv.box.length === 12) {
    const b = bv.box;
    const corners: LonLat[] = [];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = b[0] + sx * b[3] + sy * b[6] + sz * b[9];
          const y = b[1] + sx * b[4] + sy * b[7] + sz * b[10];
          const z = b[2] + sx * b[5] + sy * b[8] + sz * b[11];
          corners.push(ecefToLonLat(...transformPoint(m, x, y, z)));
        }
    return convexHull(corners);
  }
  if (bv.sphere && bv.sphere.length === 4) {
    const [cx, cy, cz, r] = bv.sphere;
    // Uniform-scale estimate from the transform's first column.
    const scale = Math.hypot(m[0], m[1], m[2]) || 1;
    const [lon, lat] = ecefToLonLat(...transformPoint(m, cx, cy, cz));
    const rDegLat = ((r * scale) / 111320) * 1;
    const rDegLon = rDegLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const ring: LonLat[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      ring.push([lon + Math.cos(a) * rDegLon, lat + Math.sin(a) * rDegLat]);
    }
    return ring;
  }
  return null;
}

class FetchBudgetExceeded extends Error {}

/** Collects one lon/lat polygon per content-bearing LEAF tile, composing tile
 * transforms down the tree and following external tileset references. */
async function collectLeafPolygons(
  node: TileNode,
  baseUrl: string,
  parentMatrix: Mat4,
  depth: number,
  budget: { fetches: number; maxFetches: number; maxDepth: number },
  fetchJson: (url: string) => Promise<unknown>,
  out: LonLat[][]
): Promise<void> {
  if (depth > budget.maxDepth) return;
  const m = isMat4(node.transform) ? mat4Multiply(parentMatrix, node.transform) : parentMatrix;

  const contentUri = node.content?.uri ?? node.content?.url;
  const children = node.children ?? [];

  if (contentUri && /\.json(\?|$)/i.test(contentUri)) {
    // External tileset: its tree continues this node. A blown fetch budget
    // means whole subtrees would silently vanish from the outline — abort.
    if (budget.fetches >= budget.maxFetches) throw new FetchBudgetExceeded();
    budget.fetches++;
    const url = new URL(contentUri, baseUrl).toString();
    const child = (await fetchJson(url)) as TilesetJson;
    if (child?.root) {
      await collectLeafPolygons(child.root, url, m, depth + 1, budget, fetchJson, out);
    }
    return;
  }

  if (children.length === 0) {
    // The optional content bounding volume is the tight fit around actual
    // geometry; the tile volume itself may be a loose octree cell.
    const poly =
      volumeToPolygon(node.content?.boundingVolume, m) ?? volumeToPolygon(node.boundingVolume, m);
    if (poly && poly.length >= 3) out.push(poly);
    return;
  }

  for (const child of children) {
    await collectLeafPolygons(child, baseUrl, m, depth, budget, fetchJson, out);
  }
}

function pointInPolygon(x: number, y: number, poly: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas–Peucker. Closed rings arrive with first == last: the chord is then
 * degenerate, so fall back to point-to-endpoint distance (this finds the
 * farthest vertex and splits the ring instead of collapsing it). */
function simplify(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  let maxD = -1;
  let idx = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d =
      len < 1e-9
        ? Math.hypot(px - x1, py - y1)
        : Math.abs(dx * (y1 - py) - (x1 - px) * dy) / len;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, idx + 1), epsilon);
  const right = simplify(points.slice(idx), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Occupancy grid → outer boundary of the largest filled region, in grid
 * coordinates. Returns null when the grid is effectively empty. */
function traceLargestRegion(grid: Uint8Array, n: number): [number, number][] | null {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : grid[y * n + x]);

  // Morphological close (dilate then erode, 8-neighborhood) seals the hairline
  // gaps between adjacent leaf cells so they trace as one region.
  const pass = (src: Uint8Array, want: number, set: number, unset: number) => {
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++)
          for (let dx = -1; dx <= 1 && !hit; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            const v = xx < 0 || yy < 0 || xx >= n || yy >= n ? 0 : src[yy * n + xx];
            if (v === want) hit = true;
          }
        dst[y * n + x] = hit ? set : unset;
      }
    return dst;
  };
  grid = pass(grid, 1, 1, 0); // dilate
  grid = pass(grid, 0, 0, 1); // erode

  // Largest 4-connected component.
  const comp = new Int32Array(grid.length).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  let nextId = 0;
  const stack: number[] = [];
  for (let s = 0; s < grid.length; s++) {
    if (!grid[s] || comp[s] !== -1) continue;
    const id = nextId++;
    let size = 0;
    stack.push(s);
    comp[s] = id;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const cx = c % n;
      const cy = (c / n) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = y * n + x;
        if (grid[i] && comp[i] === -1) {
          comp[i] = id;
          stack.push(i);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }
  if (bestId === -1 || bestSize < 9) return null;
  for (let i = 0; i < grid.length; i++) grid[i] = comp[i] === bestId ? 1 : 0;

  // Moore-neighbor boundary trace, clockwise, with Jacob's stopping criterion.
  let sx = -1;
  let sy = -1;
  outer: for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (at(x, y)) {
        sx = x;
        sy = y;
        break outer;
      }
  if (sx < 0) return null;

  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const ring: [number, number][] = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let dir = 6; // came from below (scan found the topmost row first)
  const maxSteps = grid.length * 4;
  for (let step = 0; step < maxSteps; step++) {
    let found = -1;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8; // start from the backtrack neighbor
      if (at(cx + dirs[d][0], cy + dirs[d][1])) {
        found = d;
        break;
      }
    }
    if (found === -1) break; // isolated cell
    cx += dirs[found][0];
    cy += dirs[found][1];
    dir = found;
    if (cx === sx && cy === sy) break;
    ring.push([cx, cy]);
  }
  return ring.length >= 3 ? ring : null;
}

/** Ring winding via the shoelace sum: positive = counter-clockwise. */
function signedArea(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Offsets every vertex inward along its normal (grid units). */
function insetRing(ring: [number, number][], amount: number): [number, number][] {
  const ccw = signedArea(ring) > 0;
  const out: [number, number][] = [];
  const len = ring.length;
  for (let i = 0; i < len; i++) {
    const [px, py] = ring[(i - 1 + len) % len];
    const [cx, cy] = ring[i];
    const [nx, ny] = ring[(i + 1) % len];
    // Inward edge normals: left of travel for CCW rings, right for CW.
    const norm = (dx: number, dy: number): [number, number] => {
      const l = Math.hypot(dx, dy) || 1e-12;
      return ccw ? [-dy / l, dx / l] : [dy / l, -dx / l];
    };
    const [ax, ay] = norm(cx - px, cy - py);
    const [bx, by] = norm(nx - cx, ny - cy);
    let vx = ax + bx;
    let vy = ay + by;
    const vl = Math.hypot(vx, vy);
    if (vl < 1e-9) {
      vx = ax;
      vy = ay;
    } else {
      vx /= vl;
      vy /= vl;
    }
    out.push([cx + vx * amount, cy + vy * amount]);
  }
  return out;
}

/**
 * Computes the lon/lat outline (degrees) of a tileset's actual data coverage.
 * Resolves external tileset references relative to `tilesetUrl`. Returns null
 * whenever a trustworthy outline cannot be built — callers must treat null as
 * "do not clip", never substitute a bounding rectangle (over-clipping cuts a
 * visible hole in the globe beside the data).
 */
export async function computeTilesetFootprint(
  tilesetUrl: string,
  fetchJson?: (url: string) => Promise<unknown>,
  options?: FootprintOptions
): Promise<LonLat[] | null> {
  const gridSize = options?.gridSize ?? 88;
  const insetCells = options?.insetCells ?? 1.5;
  const budget = {
    fetches: 0,
    maxFetches: options?.maxFetches ?? 16,
    maxDepth: options?.maxDepth ?? 8,
  };
  // The footprint decides whether terrain gets clipped for the whole session,
  // so its handful of JSON fetches must survive transient starvation (they
  // compete with hundreds of concurrent tile requests at viewer load).
  const doFetch =
    fetchJson ??
    (async (url: string) => {
      let lastErr: unknown;
      // Patient backoff: the outline can arrive tens of seconds after the
      // mesh with no user-visible cost, but a give-up means no terrain
      // isolation for the whole session.
      for (const delayMs of [0, 2000, 8000, 20000]) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`tileset fetch failed (${res.status}): ${url}`);
          return await res.json();
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    });

  try {
    const root = ((await doFetch(tilesetUrl)) as TilesetJson)?.root;
    if (!root) return null;

    const polys: LonLat[][] = [];
    await collectLeafPolygons(root, tilesetUrl, IDENTITY, 0, budget, doFetch, polys);
    if (polys.length === 0) return null;

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const poly of polys)
      for (const [lon, lat] of poly) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    // Antimeridian-straddling or degenerate extents: bail out.
    if (maxLon - minLon > 180 || maxLon <= minLon || maxLat <= minLat) return null;

    // Rasterize with a 2-cell margin so the boundary trace never touches the
    // grid edge. A cell fills when its center is inside a leaf polygon, or a
    // polygon vertex lands in it (keeps leaves smaller than a cell visible).
    const pad = 2;
    const cellLon = (maxLon - minLon) / (gridSize - 2 * pad);
    const cellLat = (maxLat - minLat) / (gridSize - 2 * pad);
    if (!(cellLon > 0) || !(cellLat > 0)) return null;
    const originLon = minLon - pad * cellLon;
    const originLat = minLat - pad * cellLat;
    const grid = new Uint8Array(gridSize * gridSize);

    for (const poly of polys) {
      let pMinLon = Infinity;
      let pMinLat = Infinity;
      let pMaxLon = -Infinity;
      let pMaxLat = -Infinity;
      for (const [lon, lat] of poly) {
        pMinLon = Math.min(pMinLon, lon);
        pMaxLon = Math.max(pMaxLon, lon);
        pMinLat = Math.min(pMinLat, lat);
        pMaxLat = Math.max(pMaxLat, lat);
        const vx = Math.floor((lon - originLon) / cellLon);
        const vy = Math.floor((lat - originLat) / cellLat);
        if (vx >= 0 && vy >= 0 && vx < gridSize && vy < gridSize) grid[vy * gridSize + vx] = 1;
      }
      const x0 = Math.max(0, Math.floor((pMinLon - originLon) / cellLon));
      const x1 = Math.min(gridSize - 1, Math.ceil((pMaxLon - originLon) / cellLon));
      const y0 = Math.max(0, Math.floor((pMinLat - originLat) / cellLat));
      const y1 = Math.min(gridSize - 1, Math.ceil((pMaxLat - originLat) / cellLat));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (grid[y * gridSize + x]) continue;
          const lon = originLon + (x + 0.5) * cellLon;
          const lat = originLat + (y + 0.5) * cellLat;
          if (pointInPolygon(lon, lat, poly)) grid[y * gridSize + x] = 1;
        }
    }

    let ring = traceLargestRegion(grid, gridSize);
    if (!ring) return null;
    ring = simplify([...ring, ring[0]], 1.4).slice(0, -1);
    if (ring.length < 3) return null;
    ring = insetRing(ring, insetCells);

    return ring.map(([gx, gy]) => [
      originLon + (gx + 0.5) * cellLon,
      originLat + (gy + 0.5) * cellLat,
    ]);
  } catch (err) {
    if (!(err instanceof FetchBudgetExceeded)) {
      console.warn("[viewer] tileset footprint failed:", err);
    }
    return null;
  }
}
