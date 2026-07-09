"use client";

import { configureCesiumIon, isCesiumLoaded } from "@/lib/viewer/cesiumIon";

let cesiumPromise: Promise<void> | null = null;

/**
 * Load /cesium/Cesium.js (and widgets.css) on demand, once, from the client.
 * Replaces the blocking <script> in the root layout head so marketing/auth
 * pages don't pay the ~5MB Cesium download; only routes that render a viewer
 * call this (via useCesiumReady).
 *
 * CESIUM_BASE_URL must be set before the script is inserted — Cesium reads it
 * at evaluation time to locate workers/assets.
 */
export function loadCesium(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadCesium is client-only"));
  }
  if (isCesiumLoaded()) {
    configureCesiumIon();
    return Promise.resolve();
  }
  if (cesiumPromise) return cesiumPromise;

  cesiumPromise = new Promise<void>((resolve, reject) => {
    window.CESIUM_BASE_URL = "/cesium/";

    if (!document.querySelector("link[data-cesium-widgets]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/cesium/Widgets/widgets.css";
      css.setAttribute("data-cesium-widgets", "");
      document.head.appendChild(css);
    }

    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.onload = () => {
      if (!isCesiumLoaded()) {
        cesiumPromise = null;
        reject(new Error("Cesium.js loaded but window.Cesium is missing"));
        return;
      }
      configureCesiumIon();
      resolve();
    };
    script.onerror = () => {
      // Reset so a remount (e.g. after the network recovers) retries the load.
      cesiumPromise = null;
      script.remove();
      reject(new Error("Failed to load /cesium/Cesium.js"));
    };
    document.head.appendChild(script);
  });

  return cesiumPromise;
}
