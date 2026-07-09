"use client";

import { useEffect, useState } from "react";
import { loadCesium } from "@/lib/viewer/loadCesium";

/**
 * Kick off the on-demand Cesium load and report readiness. Gate RENDERING of
 * any component that imports "cesium" (SurveyViewer, DashboardGlobe) on this —
 * those modules resolve the `cesium` external at chunk-eval time, so mounting
 * them before window.Cesium exists throws.
 */
export function useCesiumReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCesium()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        console.error("Cesium failed to load:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
