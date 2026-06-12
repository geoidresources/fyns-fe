"use client";

import React, { useState, useEffect } from "react";
import { ActiveSitesPanel } from "@/components/dashboard/ActiveSitesPanel";
import { SiteDetailPanel } from "@/components/dashboard/SiteDetailPanel";
import dynamic from "next/dynamic";
import { listProjects, type Project } from "@/lib/api/userSvc";

const DashboardGlobe = dynamic(
  () => import("@/components/dashboard/DashboardGlobe").then((mod) => mod.DashboardGlobe),
  { ssr: false, loading: () => <div className="w-full h-full bg-[#0A0D14]" /> }
);

export default function GlobeViewPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);

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
        <DashboardGlobe projects={projects} selectedSiteId={selectedSiteId} />

        {/* Right Panel: Site Details */}
        {selectedSiteId && (
          <SiteDetailPanel projectId={selectedSiteId} onClose={() => setSelectedSiteId("")} />
        )}
      </div>
    </div>
  );
}
