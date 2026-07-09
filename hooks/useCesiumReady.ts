"use client";

import { useEffect, useState } from "react";
import { configureCesiumIon, isCesiumLoaded } from "@/lib/viewer/cesiumIon";

/**
 * Hard refresh clears cache and can let React hydrate before /cesium/Cesium.js
 * finishes — gate any resium <Viewer> on this so we never mount into a broken
 * global.
 */
export function useCesiumReady(): boolean {
  const [ready, setReady] = useState(() => {
    if (!isCesiumLoaded()) return false;
    configureCesiumIon();
    return true;
  });

  useEffect(() => {
    if (ready) return;

    let cancelled = false;
    const poll = window.setInterval(() => {
      if (!isCesiumLoaded()) return;
      window.clearInterval(poll);
      if (cancelled) return;
      configureCesiumIon();
      setReady(true);
    }, 50);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [ready]);

  return ready;
}
