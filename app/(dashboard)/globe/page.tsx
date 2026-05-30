"use client";

import React, { useState, useEffect } from "react";
import { ActiveSitesPanel } from "@/components/dashboard/ActiveSitesPanel";
import { SiteDetailPanel } from "@/components/dashboard/SiteDetailPanel";
import { DashboardGlobe } from "@/components/dashboard/DashboardGlobe";
import Cookies from "js-cookie";

export default function GlobeViewPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    async function fetchProjects() {
      const token = Cookies.get("token");
      if (!token) return;

      const baseUrl = process.env.NEXT_PUBLIC_USER_SVC_BASE_URL || "https://api.development.geoidresources.com/user-svc";
      
      try {
        const response = await fetch(`${baseUrl}/api/v1/project?lifecycle_status=active`, {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setProjects(data);
          
          // Select the first site automatically if none selected
          if (data.length > 0) {
            setSelectedSiteId(data[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to fetch projects:", err);
      }
    }

    fetchProjects();
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
