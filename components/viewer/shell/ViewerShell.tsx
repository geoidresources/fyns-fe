"use client";

// ViewerShell — the composition root of the relocated viewer (viewer-shell §2.2).
// It wires the two providers (the per-mount Zustand store §3, and the Cesium
// viewer handle §2.3) and the URL codec seam (§5, a no-op stub until 1.4), then
// renders the runtime (`ViewerCanvas`) that owns the grid, refs, callbacks and
// effect hooks. Kept thin on purpose: providers + codec here, everything scene-
// bound in ViewerCanvas so the store/cesium contexts wrap the whole shell.
//
// Mounted through the page's `next/dynamic {ssr:false}` gate (behind
// `useCesiumReady`), so nothing here evaluates the `cesium` external server-side.

import { ViewerStoreProvider } from "@/lib/viewer/state/store";
import { CesiumViewerProvider } from "@/lib/viewer/state/cesiumContext";
import { useUrlCodec } from "@/lib/viewer/urlState";
import { ViewerCanvas } from "@/components/viewer/shell/ViewerCanvas";

/** Inside both providers so the 1.4 codec can subscribe to the store/URL. */
function ViewerShellInner() {
  useUrlCodec(); // §5 URL state codec — no-op in 1.3c-i; 1.4 fills the body.
  return <ViewerCanvas />;
}

export function ViewerShell({ surveyId }: { surveyId: string }) {
  return (
    <ViewerStoreProvider surveyId={surveyId}>
      <CesiumViewerProvider>
        <ViewerShellInner />
      </CesiumViewerProvider>
    </ViewerStoreProvider>
  );
}
