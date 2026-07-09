/** Shared Cesium Ion config — applied once window.Cesium is available. */

export const CESIUM_ION_TOKEN = (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "").trim();
export const USE_WORLD_TERRAIN = CESIUM_ION_TOKEN.length > 0;

declare global {
  interface Window {
    Cesium?: typeof import("cesium");
    /** Read by Cesium.js at eval time to locate workers/assets — set by loadCesium(). */
    CESIUM_BASE_URL?: string;
  }
}

export function isCesiumLoaded(): boolean {
  return typeof window !== "undefined" && !!window.Cesium;
}

/** Idempotent — safe to call from layout scripts and React effects alike. */
export function configureCesiumIon(): void {
  if (!isCesiumLoaded() || !CESIUM_ION_TOKEN) return;
  window.Cesium!.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
}
