"use client";

// The mutable Cesium viewer object and its readiness flag live OUTSIDE the
// Zustand store (§3.2 containment) — they are non-serializable handles. This
// provider owns them and exposes the single mount point, `handleViewerRef`,
// which is MOVED VERBATIM from SurveyViewer.tsx:1947-1962 (§2.3 rule 1 — it MUST
// NOT be rewritten). ViewerCanvas passes it straight to resium's <Viewer ref>
// in 1.3c; other zones read `viewerRef`/`viewerReady` through `useCesiumViewer`.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CesiumComponentRef } from "resium";
import {
  ScreenSpaceEventType,
  type ImageryLayer,
  type Viewer as CesiumViewer,
} from "cesium";

import {
  configureCesiumScene,
  makeBaseImageryProvider,
} from "@/lib/viewer/cesiumScene";

export interface CesiumViewerContextValue {
  viewerRef: React.RefObject<CesiumViewer | null>;
  viewerReady: boolean;
  handleViewerRef: (e: CesiumComponentRef<CesiumViewer> | null) => void;
  baseImageryRef: React.RefObject<ImageryLayer | null>;
}

const CesiumViewerContext = createContext<CesiumViewerContextValue | null>(null);

export function CesiumViewerProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<CesiumViewer | null>(null);
  const baseImageryRef = useRef<ImageryLayer | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  // ------------------------------------------------------------- viewer ref
  // MOVED VERBATIM from SurveyViewer.tsx:1947-1962 (§2.3 rule 1).
  const handleViewerRef = useCallback((e: CesiumComponentRef<CesiumViewer> | null) => {
    if (e?.cesiumElement && !e.cesiumElement.isDestroyed()) {
      const viewer = e.cesiumElement;
      // Default double-click (track entity) conflicts with finish-drawing.
      viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      configureCesiumScene(viewer);
      if (viewer.imageryLayers.length === 0) {
        baseImageryRef.current = viewer.imageryLayers.addImageryProvider(
          makeBaseImageryProvider("satellite"),
          0
        );
      }
      viewerRef.current = viewer;
      setViewerReady(true);
    }
  }, []);

  return (
    <CesiumViewerContext.Provider
      value={{ viewerRef, viewerReady, handleViewerRef, baseImageryRef }}
    >
      {children}
    </CesiumViewerContext.Provider>
  );
}

/** Access the viewer handle + readiness (§2.3). Cesium objects returned here
 * are refs — never route them into the Zustand store (§3.2). */
export function useCesiumViewer(): CesiumViewerContextValue {
  const ctx = useContext(CesiumViewerContext);
  if (ctx === null) {
    throw new Error("useCesiumViewer must be used within a CesiumViewerProvider");
  }
  return ctx;
}
