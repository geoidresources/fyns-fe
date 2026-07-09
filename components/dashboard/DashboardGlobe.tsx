"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Viewer, Entity, PointGraphics } from "resium";
import type { CesiumComponentRef } from "resium";
import { Cartesian3, Color, Viewer as CesiumViewer } from "cesium";
import { Loader2 } from "lucide-react";
import { useCesiumReady } from "@/hooks/useCesiumReady";
import type { Project } from "@/lib/api/userSvc";
import {
  projectWgs84Center,
  resolveProjectCenter,
  type Wgs84Center,
} from "@/lib/dashboard/resolveProjectCenter";

export function DashboardGlobe({
  projects,
  selectedSiteId,
}: {
  projects: Project[];
  selectedSiteId?: string;
}) {
  const viewerRef = useRef<CesiumComponentRef<CesiumViewer> | null>(null);
  const centersRef = useRef<Map<string, Wgs84Center>>(new Map());
  const [viewerReady, setViewerReady] = useState(false);
  const [markerCenters, setMarkerCenters] = useState<Record<string, Wgs84Center>>({});
  const cesiumReady = useCesiumReady();

  const handleViewerRef = useCallback((ref: CesiumComponentRef<CesiumViewer> | null) => {
    viewerRef.current = ref;
    if (ref?.cesiumElement && !ref.cesiumElement.isDestroyed()) {
      setViewerReady(true);
    }
  }, []);

  // Resolve map markers — listProjects may omit center_lat/center_lng for some sites.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next: Record<string, Wgs84Center> = {};
      for (const project of projects) {
        const cached = centersRef.current.get(project.id);
        if (cached) {
          next[project.id] = cached;
          continue;
        }

        const immediate = projectWgs84Center(project);
        if (immediate) {
          next[project.id] = immediate;
          centersRef.current.set(project.id, immediate);
          continue;
        }

        const resolved = await resolveProjectCenter(project);
        if (resolved) {
          next[project.id] = resolved;
          centersRef.current.set(project.id, resolved);
        }
      }

      if (!cancelled) setMarkerCenters(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    if (!viewerReady || !selectedSiteId) return;

    let cancelled = false;

    const fly = async () => {
      let center = centersRef.current.get(selectedSiteId);
      if (!center) {
        const project = projects.find((p) => p.id === selectedSiteId);
        if (!project) return;
        center = (await resolveProjectCenter(project)) ?? undefined;
        if (!center || cancelled) return;
        centersRef.current.set(selectedSiteId, center);
        setMarkerCenters((prev) => ({ ...prev, [selectedSiteId]: center! }));
      }

      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || viewer.isDestroyed() || cancelled) return;

      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(center.lng, center.lat, 15000),
        duration: 2.0,
      });
    };

    void fly();

    return () => {
      cancelled = true;
    };
  }, [viewerReady, selectedSiteId, projects]);

  if (!cesiumReady) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0A0D14] text-xs text-gray-500">
        <Loader2 size={14} className="mr-2 animate-spin" />
        Loading globe…
      </div>
    );
  }

  return (
    <div className="w-full h-full absolute inset-0">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#C97A4E]/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <div className="w-full h-full absolute inset-0 z-10 cesium-container">
        <Viewer
          ref={handleViewerRef}
          full
          timeline={false}
          animation={false}
          geocoder={false}
          baseLayerPicker={false}
          navigationHelpButton={false}
          homeButton={false}
          sceneModePicker={false}
          fullscreenButton={false}
          infoBox={false}
          selectionIndicator={false}
          style={{ width: "100%", height: "100%" }}
        >
          {Object.entries(markerCenters).map(([id, center]) => {
            const project = projects.find((p) => p.id === id);
            if (!project) return null;
            return (
              <Entity
                key={id}
                position={Cartesian3.fromDegrees(center.lng, center.lat)}
                name={project.name}
              >
                <PointGraphics
                  pixelSize={14}
                  color={Color.fromCssColorString("#FF8A4C")}
                  outlineColor={Color.fromCssColorString("#FFFFFF")}
                  outlineWidth={2}
                />
              </Entity>
            );
          })}
        </Viewer>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cesium-container .cesium-viewer-bottom {
          display: none !important;
        }
      `,
        }}
      />
    </div>
  );
}
