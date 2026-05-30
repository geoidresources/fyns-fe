"use client";

import React, { useState } from "react";
import { ActiveSitesPanel } from "@/components/dashboard/ActiveSitesPanel";
import { SiteDetailPanel } from "@/components/dashboard/SiteDetailPanel";
import { DashboardGlobe } from "@/components/dashboard/DashboardGlobe";

export default function GlobeViewPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("1");

  return (
    <div className="w-full h-full flex bg-[#0A0D14] overflow-hidden">
      {/* Left Panel: Active Sites */}
      <div className="w-72 shrink-0 z-10 border-r border-[#1E2028]">
        <ActiveSitesPanel 
          selectedSiteId={selectedSiteId} 
          onSiteSelect={setSelectedSiteId} 
        />
      </div>

      {/* Right Canvas */}
      <div className="flex-1 relative">
        <DashboardGlobe />

        {/* Right Panel: Site Details */}
        {selectedSiteId && (
          <SiteDetailPanel onClose={() => setSelectedSiteId("")} />
        )}
      </div>
    </div>
  );
}
