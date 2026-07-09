"use client";

import React, { useState, useEffect } from "react";
import { ActiveSitesPanel } from "@/components/dashboard/ActiveSitesPanel";
import { SiteDetailPanel } from "@/components/dashboard/SiteDetailPanel";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCesiumReady } from "@/hooks/useCesiumReady";
import { listProjects, type Project } from "@/lib/api/userSvc";

const DashboardGlobe = dynamic(
  () => import("@/components/dashboard/DashboardGlobe").then((mod) => mod.DashboardGlobe),
  { ssr: false, loading: () => <div className="w-full h-full bg-[#0A0D14]" /> }
);

export default function GlobeViewPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  // DashboardGlobe's chunk resolves the `cesium` external at eval time, so
  // the dynamic import must not start until window.Cesium exists.
  const cesiumReady = useCesiumReady();

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => console.error("Failed to fetch projects:", err));
  }, []);

  return (
    <div className="w-full h-full flex bg-[#0A0D14] overflow-hidden">
      {/* Left Panel: Active Sites */}
      <div className="w-72 shrink-0 z-10 border-r border-[#1E2028]">
        <ActiveSitesPanel
          projects={projects}
          selectedSiteId={selectedSiteId}
          onSiteSelect={setSelectedSiteId}
        />
      </div>

      {/* Right Canvas */}
      <div className="flex-1 relative">
        {cesiumReady ? (
          <DashboardGlobe projects={projects} selectedSiteId={selectedSiteId} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0A0D14] text-xs text-gray-500">
            <Loader2 size={14} className="mr-2 animate-spin" />
            Loading globe…
          </div>
        )}

        {/* Right Panel: Site Details */}
        {selectedSiteId && (
          <SiteDetailPanel
            key={selectedSiteId}
            projectId={selectedSiteId}
            onClose={() => setSelectedSiteId("")}
          />
        )}
      </div>
    </div>
  );
}
