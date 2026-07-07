// Measurement + picking math ported from rendering-engine-fe (mapview/Viewer.tsx).
// Pure Cesium geometry helpers — no React, no network. Distances are 3D
// (geodesic surface run + vertical delta); areas are shoelace over an
// east-north-up projection around the polygon centroid.

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  EllipsoidGeodesic,
  Math as CesiumMath,
  Matrix4,
  Rectangle,
  Transforms,
  defined,
  type Viewer as CesiumViewer,
} from "cesium";

export interface LngLatHeight {
  longitude: number;
  latitude: number;
  height: number;
}

/** GeoJSON geometry as served by asset-svc measurements. */
interface GeoJsonGeometryLike {
  type: string;
  coordinates: unknown;
}

// ------------------------------------------------------------------ picking

/** Depth-buffer pick with a globe-ray fallback, so probing works on the
 * reality mesh / point cloud as well as bare terrain. */
export function pickScenePosition(
  viewer: CesiumViewer,
  windowPosition: Cartesian2
): Cartesian3 | null {
  const scene = viewer.scene;

  if (scene.pickPositionSupported) {
    const picked = scene.pickPosition(windowPosition);
    if (defined(picked)) return picked;
  }

  const ray = viewer.camera.getPickRay(windowPosition);
  if (!ray) return null;
  const globePick = scene.globe.pick(ray, scene);
  if (defined(globePick)) return globePick;
  const onEllipsoid = viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
  return defined(onEllipsoid) ? onEllipsoid! : null;
}

export function toLngLatHeight(position: Cartesian3): LngLatHeight {
  const cartographic = Cartographic.fromCartesian(position);
  return {
    longitude: CesiumMath.toDegrees(cartographic.longitude),
    latitude: CesiumMath.toDegrees(cartographic.latitude),
    height: cartographic.height,
  };
}

// -------------------------------------------------------------- measurement

/** 3D polyline length: geodesic surface distance per segment plus the
 * vertical delta (a haul-road segment up a bench is longer than its plan). */
export function computeDistanceMeters(points: Cartesian3[]): number {
  if (points.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const start = Cartographic.fromCartesian(points[i - 1]);
    const end = Cartographic.fromCartesian(points[i]);
    const geodesic = new EllipsoidGeodesic(start, end);
    const surfaceDistance = geodesic.surfaceDistance ?? 0;
    const verticalDelta = (end.height ?? 0) - (start.height ?? 0);
    total += Math.sqrt(surfaceDistance * surfaceDistance + verticalDelta * verticalDelta);
  }

  return total;
}

/** Ring length of a polygon (closing segment included). */
export function computePerimeterMeters(points: Cartesian3[]): number {
  if (points.length < 3) return 0;
  return computeDistanceMeters([...points, points[0]]);
}

/** Shoelace area over an ENU plane anchored at the vertex centroid. */
export function computeAreaSquareMeters(points: Cartesian3[]): number {
  if (points.length < 3) return 0;

  const center = points.reduce(
    (acc, point) => Cartesian3.add(acc, point, acc),
    new Cartesian3(0, 0, 0)
  );
  const centroid = Cartesian3.multiplyByScalar(center, 1 / points.length, new Cartesian3());
  const inverseTransform = Matrix4.inverseTransformation(
    Transforms.eastNorthUpToFixedFrame(centroid),
    new Matrix4()
  );
  const projected = points.map((point) =>
    Matrix4.multiplyByPoint(inverseTransform, point, new Cartesian3())
  );

  let sum = 0;
  for (let i = 0; i < projected.length; i++) {
    const current = projected[i];
    const next = projected[(i + 1) % projected.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return Math.abs(sum) * 0.5;
}

export interface GradeResult {
  /** Rise over horizontal run, in percent (signed: uphill from first vertex is +). */
  percent: number;
  horizontalMeters: number;
  riseMeters: number;
}

/** Overall grade of a polyline: total elevation change over the horizontal
 * run along the path. Null until there are two distinct vertices. */
export function computeGrade(points: Cartesian3[]): GradeResult | null {
  if (points.length < 2) return null;

  let horizontal = 0;
  for (let i = 1; i < points.length; i++) {
    const start = Cartographic.fromCartesian(points[i - 1]);
    const end = Cartographic.fromCartesian(points[i]);
    horizontal += new EllipsoidGeodesic(start, end).surfaceDistance ?? 0;
  }
  if (horizontal < 0.01) return null;

  const first = Cartographic.fromCartesian(points[0]);
  const last = Cartographic.fromCartesian(points[points.length - 1]);
  const rise = (last.height ?? 0) - (first.height ?? 0);
  return { percent: (rise / horizontal) * 100, horizontalMeters: horizontal, riseMeters: rise };
}

// -------------------------------------------------------------- formatting

export function formatDistance(distanceMeters?: number): string {
  if (distanceMeters === undefined || !(distanceMeters > 0)) return "— m";
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(2)} km`
    : `${distanceMeters.toFixed(1)} m`;
}

export function formatArea(areaSquareMeters?: number): string {
  if (areaSquareMeters === undefined || !(areaSquareMeters > 0)) return "— m²";
  return areaSquareMeters >= 10000
    ? `${(areaSquareMeters / 10000).toFixed(2)} ha`
    : `${areaSquareMeters.toFixed(0)} m²`;
}

export function formatHeight(heightMeters?: number): string {
  if (heightMeters === undefined || !Number.isFinite(heightMeters)) return "—";
  return `${heightMeters.toFixed(1)} m`;
}

// --------------------------------------------------------- picked features

/** Ensures a picked property bag always has an id + display name. */
export function normalizeSelectedFeature(
  props: Record<string, unknown>,
  defaults: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...defaults,
    ...props,
    id: props.id ?? defaults.id ?? defaults._entityId ?? "unknown",
    name: props.name ?? defaults.name ?? "Unnamed feature",
  };
}

// ------------------------------------------------- saved-geometry helpers

/** Vertex ring/path of a stored GeoJSON geometry as Cartesian3 (height 0 —
 * plan coordinates; the closing duplicate of a polygon ring is dropped). */
export function geometryPositions(geometry: GeoJsonGeometryLike): Cartesian3[] {
  const toCartesian = (c: unknown): Cartesian3 | null => {
    if (!Array.isArray(c) || c.length < 2) return null;
    const [lng, lat, alt] = c as number[];
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    return Cartesian3.fromDegrees(lng, lat, typeof alt === "number" ? alt : 0);
  };

  let ring: unknown[] = [];
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    ring = [...((geometry.coordinates as unknown[])[0] as unknown[] ?? [])];
    // Drop the GeoJSON closing vertex — the ring math closes itself.
    if (ring.length > 1) {
      const first = ring[0] as number[];
      const last = ring[ring.length - 1] as number[];
      if (Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1]) {
        ring.pop();
      }
    }
  } else if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    ring = geometry.coordinates as unknown[];
  } else if (geometry.type === "Point") {
    ring = [geometry.coordinates];
  }

  return ring.map(toCartesian).filter((p): p is Cartesian3 => !!p);
}

/** Client-side plan stats for a stored geometry — the fallback shown while a
 * measurement has no computed result yet (heights are not included). */
export function geometryLocalStats(geometry: GeoJsonGeometryLike): Record<string, number> {
  const points = geometryPositions(geometry);
  if (geometry.type === "Polygon" && points.length >= 3) {
    return {
      area_m2: computeAreaSquareMeters(points),
      perimeter_m: computePerimeterMeters(points),
    };
  }
  if (geometry.type === "LineString" && points.length >= 2) {
    return { length_m: computeDistanceMeters(points) };
  }
  return {};
}

/** Camera rectangle for a stored geometry, padded so small features do not
 * fill the whole frame. */
export function geometryToRectangle(geometry: GeoJsonGeometryLike): Rectangle | undefined {
  const points = geometryPositions(geometry);
  if (points.length === 0) return undefined;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    const c = Cartographic.fromCartesian(p);
    const lng = CesiumMath.toDegrees(c.longitude);
    const lat = CesiumMath.toDegrees(c.latitude);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  const pad = Math.max((east - west) * 0.35, (north - south) * 0.35, 0.0006);
  try {
    return Rectangle.fromDegrees(west - pad, south - pad, east + pad, north + pad);
  } catch {
    return undefined;
  }
}
