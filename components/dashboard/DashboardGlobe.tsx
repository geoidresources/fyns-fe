"use client";

import React, { useEffect, useRef, useState } from "react";
import { Viewer, Entity, PointGraphics } from "resium";
import { Cartesian3, Color, Viewer as CesiumViewer } from "cesium";

export function DashboardGlobe({ projects, selectedSiteId }: { projects: any[]; selectedSiteId?: string }) {
  const viewerRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (selectedSiteId && viewerRef.current?.cesiumElement && projects) {
      const selected = projects.find(p => p.id === selectedSiteId);
      if (selected && selected.center_lat !== null && selected.center_lng !== null) {
        const viewer = viewerRef.current.cesiumElement as CesiumViewer;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(selected.center_lng, selected.center_lat, 15000), // 15km altitude
          duration: 2.0,
        });
      }
    }
  }, [selectedSiteId, projects]);

  if (!mounted) return null;

  return (
    <div className="w-full h-full absolute inset-0">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#C97A4E]/10 rounded-full blur-[120px] pointer-events-none z-0" />
      
      <div className="w-full h-full absolute inset-0 z-10 cesium-container">
        <Viewer
          ref={viewerRef}
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
          {projects
            .filter(p => p.center_lat !== null && p.center_lng !== null)
            .map((p) => (
              <Entity
                key={p.id}
                position={Cartesian3.fromDegrees(p.center_lng, p.center_lat)}
                name={p.name}
              >
                <PointGraphics 
                  pixelSize={14} 
                  color={Color.fromCssColorString("#FF8A4C")} 
                  outlineColor={Color.fromCssColorString("#FFFFFF")} 
                  outlineWidth={2} 
                />
              </Entity>
            ))}
        </Viewer>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .cesium-container .cesium-viewer {
          background-color: #0A0D14;
        }
        .cesium-container .cesium-widget, .cesium-container .cesium-widget canvas {
          background-color: transparent !important;
        }
        .cesium-container .cesium-viewer-bottom {
          display: none !important;
        }
      `}} />
    </div>
  );
}
