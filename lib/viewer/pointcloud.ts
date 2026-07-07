import {
  Cartesian3,
  Cesium3DTileStyle,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  type Cesium3DTileset,
} from "cesium";

const POINT_BUDGET_MIN = 100_000;
const POINT_BUDGET_MAX = 10_000_000;

export const DEFAULT_POINT_BUDGET = 5_000_000;

function budgetT(budget: number): number {
  return Math.min(1, Math.max(0, (budget - POINT_BUDGET_MIN) / (POINT_BUDGET_MAX - POINT_BUDGET_MIN)));
}

/** Higher budget → lower screen-space error → denser points. */
export function pointBudgetToMaximumScreenSpaceError(budget: number): number {
  return 32 - budgetT(budget) * (32 - 2);
}

/** Higher budget → larger retained-tile cache (128MB → 512MB). */
export function pointBudgetToCacheBytes(budget: number): number {
  const minBytes = 128 * 1024 * 1024;
  const maxBytes = 512 * 1024 * 1024;
  return Math.round(minBytes + budgetT(budget) * (maxBytes - minBytes));
}

/** Translucent point style; undefined at (near) full opacity so eye-dome
 * lighting + attenuation keep driving the point rendering. */
export function buildPointCloudStyle(opacity: number): Cesium3DTileStyle | undefined {
  const a = Math.min(1, Math.max(0, opacity));
  if (a >= 0.99) return undefined;
  return new Cesium3DTileStyle({
    pointSize: 3,
    color: `color() * vec4(1.0, 1.0, 1.0, ${a})`,
  });
}

/** PDAL's cesium writer emits lat/lon/height in the root transform instead of
 * ECEF; such a translation has a tiny magnitude (a real ECEF center sits at
 * ~6.4e6 m). Detect that and rebuild the model matrix as a local ENU frame at
 * the encoded anchor. Returns true when a correction was applied. */
export function correctGeographicRootTransform(tileset: Cesium3DTileset): boolean {
  const rootTransform = tileset.root.transform;
  const translation = Matrix4.getTranslation(rootTransform, new Cartesian3());
  const magnitude = Cartesian3.magnitude(translation);
  if (!(magnitude > 0 && magnitude < 100000)) return false;

  const lat = translation.x;
  const lon = translation.y;
  const height = translation.z;
  const ecefCenter = Cartesian3.fromDegrees(lon, lat, height);
  const enuToEcef = Transforms.eastNorthUpToFixedFrame(ecefCenter);
  const mPerDegLat = 111132.0;
  const mPerDegLon = 111132.0 * Math.cos(CesiumMath.toRadians(lat));
  // local x (lat offset) → North, local y (lon offset) → East, local z → Up
  const localToEnu = new Matrix4(
    0, mPerDegLon, 0, 0,
    mPerDegLat, 0, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  tileset.root.transform = Matrix4.IDENTITY;
  tileset.modelMatrix = Matrix4.multiply(enuToEcef, localToEnu, new Matrix4());
  console.info(
    `[viewer] Corrected geographic root transform → ECEF (lat=${lat.toFixed(4)}, lon=${lon.toFixed(4)})`
  );
  return true;
}

/** Strengthens eye-dome outlines as the camera closes in on the points. */
export function applyDynamicEyeDomeLighting(
  tileset: Cesium3DTileset,
  cameraHeightMeters: number
): void {
  if (!tileset.pointCloudShading) return;
  let strength = 0.5;
  let radius = 1.0;
  if (cameraHeightMeters < 500) {
    strength = 1.5;
    radius = 2.0;
  } else if (cameraHeightMeters < 2000) {
    strength = 1.0;
    radius = 1.5;
  }
  tileset.pointCloudShading.eyeDomeLightingStrength = strength;
  tileset.pointCloudShading.eyeDomeLightingRadius = radius;
}
