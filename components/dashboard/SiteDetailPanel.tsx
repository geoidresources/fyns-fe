import React, { useState, useEffect } from "react";
import { X, ChevronRight } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload01Icon, SatelliteIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { getProject, type Project } from "@/lib/api/userSvc";
import { listSurveys, type Survey } from "@/lib/api/assetSvc";
import { formatSurveyDate } from "@/lib/utils";

export function SiteDetailPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [projectData, setProjectData] = useState<Project | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!projectId) return;
    // Guard against out-of-order resolution: a fast project switch could let an
    // earlier request's response overwrite the current project's data.
    let cancelled = false;
    getProject(projectId)
      .then((p) => {
        if (!cancelled) setProjectData(p);
      })
      .catch((err) => console.error("Failed to fetch project details:", err));
    listSurveys(projectId)
      .then((res) => {
        if (!cancelled) setSurveys(res.surveys || []);
      })
      .catch((err) => console.error("Failed to fetch surveys:", err));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectData) return null;

  const openViewer = (surveyId: string) => router.push(`/viewer/${surveyId}`);
  const latestSurveyId = surveys[0]?.id;

  return (
    <div className="w-[360px] h-[calc(100%-2rem)] bg-[#12141A]/95 backdrop-blur-xl border border-[#1E2028] rounded-2xl absolute right-6 top-4 z-10 flex flex-col pointer-events-auto overflow-hidden shadow-2xl">
      <div className="p-6 flex-1 overflow-y-auto">
        <div className="flex justify-between items-start mb-3">
          <h2 className="text-xl font-semibold text-gray-100">{projectData.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
            projectData.lifecycle_status === 'active'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
          }`}>
            {projectData.lifecycle_status === 'active' ? 'Active' : projectData.lifecycle_status}
          </span>
          {projectData.primary_material && (
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#1E2028] text-gray-400 border border-[#2A2D35]">
              {projectData.primary_material}
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 mb-6">
          {projectData.location_name || 'Location Not Set'} {projectData.crs_label ? `- ${projectData.crs_label}` : ''}
        </p>

        <div className="grid grid-cols-3 gap-2 mb-8">
          <StatBox value={String(surveys.length)} label="surveys" />
          <StatBox value="-" label="stockpiles" />
          <StatBox value="-" label="open issues" />
        </div>

        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-gray-300">Surveys</h3>
          <button className="flex items-center gap-1 bg-[#C97A4E] hover:bg-[#b06941] text-[#0A0D14] font-medium text-xs px-3 py-1.5 rounded-full transition-colors">
            <HugeiconsIcon icon={Upload01Icon} size={14} color="#0A0D14" strokeWidth={2} />
            Upload
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {surveys.length === 0 && (
            <p className="text-xs text-gray-500">No surveys yet.</p>
          )}
          {surveys.map((survey) => (
            <div
              key={survey.id}
              onClick={() => openViewer(survey.id)}
              className="flex items-center p-3 rounded-xl bg-[#1E2028]/50 border border-[#2A2D35] hover:border-[#3A3D45] transition-colors cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-lg bg-[#2A2D35] shrink-0 mr-4 flex items-center justify-center">
                <HugeiconsIcon icon={SatelliteIcon} size={20} color="#6B7280" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-gray-200 mb-1 group-hover:text-white transition-colors">
                  {formatSurveyDate(survey.survey_date)} - {survey.survey_type}
                </h4>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">{survey.working_crs}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                    survey.status === 'completed' || survey.status === 'approved'
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                  }`}>
                    {survey.status}
                  </span>
                </div>
                {typeof survey.metadata?.sensor === "string" && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    {survey.metadata.sensor}
                  </div>
                )}
              </div>
              <ChevronRight size={16} className="text-gray-500 group-hover:text-gray-300 ml-2" />
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 border-t border-[#1E2028] bg-[#12141A] flex items-center gap-4">
        <button
          onClick={() => latestSurveyId && openViewer(latestSurveyId)}
          disabled={!latestSurveyId}
          className="flex-1 bg-[#C97A4E] hover:bg-[#b06941] text-[#0A0D14] font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Open viewer
        </button>
        <button className="text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors">
          Report
        </button>
      </div>
    </div>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-[#1E2028]/50 border border-[#2A2D35] rounded-lg p-2 flex flex-col items-center justify-center text-center">
      <div className="font-semibold text-gray-200 text-sm mb-0.5">{value}</div>
      <div className="text-[10px] text-gray-500 leading-tight">{label}</div>
    </div>
  );
}
