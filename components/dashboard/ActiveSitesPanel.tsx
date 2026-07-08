import React from "react";
import { ChevronRight, Plus } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";

interface ActiveSitesPanelProps {
  projects: any[];
  onSiteSelect: (id: string) => void;
  selectedSiteId: string;
}

export function ActiveSitesPanel({ projects, onSiteSelect, selectedSiteId }: ActiveSitesPanelProps) {
  return (
    <div className="w-full h-full bg-[#0A0D14]/80 backdrop-blur-md flex flex-col pt-4 pb-6 pointer-events-auto">
      <div className="px-6 mb-6">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={14}
            color="#6B7280"
            strokeWidth={1.5}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            placeholder="Filter sites..."
            className="w-full bg-[#12141A] border border-[#1E2028] rounded-md py-2 pl-9 pr-3 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-[#C97A4E] transition-colors"
          />
        </div>
      </div>

      <div className="px-6 mb-4">
        <h3 className="text-xs font-semibold text-gray-500 tracking-wider uppercase">ACTIVE SITES</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1 px-4">
          {projects.map((site) => {
            const isActive = site.lifecycle_status === 'active';
            // Placeholder values for stats not yet available
            const surveys = 0;
            const date = "-";
            
            return (
              <button
                key={site.id}
                onClick={() => onSiteSelect(site.id)}
                className={`flex items-start text-left w-full py-3 px-2 rounded-lg transition-colors group ${
                  selectedSiteId === site.id ? "bg-[#1E2028]" : "hover:bg-[#12141A]"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full mt-2 mr-3 shrink-0 ${isActive ? "bg-green-500" : "bg-yellow-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className={`font-medium truncate ${selectedSiteId === site.id ? "text-gray-100" : "text-gray-300 group-hover:text-gray-200"}`}>
                      {site.name}
                    </span>
                    <ChevronRight size={14} className="text-gray-500" />
                  </div>
                  <div className="text-xs text-gray-500">
                    {surveys} surveys - {date}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-6 mt-4">
        <button className="w-full py-2 flex items-center justify-center gap-2 text-sm text-[#C97A4E] hover:text-[#e08959] transition-colors">
          <Plus size={16} />
          New site
        </button>
      </div>
    </div>
  );
}
