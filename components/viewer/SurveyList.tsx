"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listSurveys, type Survey } from "@/lib/api/assetSvc";

function formatSurveyDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Human-readable status label from asset-svc survey lifecycle enum. */
function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

/** Status → badge palette aligned with asset-svc survey.Status values. */
function statusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === "approved" || s === "published") {
    return "bg-green-500/10 text-green-400 border border-green-500/20";
  }
  if (s === "processing" || s === "under_qa" || s === "ready_to_approve") {
    return "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20";
  }
  if (s === "failed") {
    return "bg-red-500/10 text-red-400 border border-red-500/20";
  }
  if (s === "locked") {
    return "bg-[#1E2028] text-gray-300 border border-[#2A2D35]";
  }
  return "bg-[#1E2028] text-gray-400 border border-[#2A2D35]";
}

/** Sibling surveys for the same project: a current-survey selector plus a
 * chronological list with version chips and status badges. */
export function SurveyList({
  projectId,
  currentSurveyId,
}: {
  projectId: string;
  currentSurveyId: string;
}) {
  const router = useRouter();
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSurveys(projectId)
      .then((res) => {
        if (cancelled) return;
        const list = (res.surveys || [])
          .slice()
          .sort((a, b) => b.survey_date.localeCompare(a.survey_date));
        setSurveys(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load surveys");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const versionOf = useMemo(() => {
    const map = new Map<string, number>();
    if (surveys) {
      for (const s of surveys) {
        map.set(s.id, s.version_number && s.version_number > 0 ? s.version_number : 1);
      }
    }
    return map;
  }, [surveys]);

  if (error) {
    return <p className="px-3 py-2 text-[11px] text-red-400">{error}</p>;
  }
  if (!surveys) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-500">
        <Loader2 size={12} className="animate-spin" /> Loading surveys…
      </div>
    );
  }
  if (surveys.length === 0) {
    return <p className="px-3 py-2 text-[11px] italic text-gray-600">No surveys in this project.</p>;
  }

  const current = surveys.find((s) => s.id === currentSurveyId);
  const currentLabel = current
    ? `Survey V${versionOf.get(current.id)} · ${formatSurveyDate(current.survey_date)}`
    : "Select survey";

  return (
    <div className="flex flex-col px-3 pt-3">
      <Select
        value={currentSurveyId}
        onValueChange={(id) => {
          if (id !== currentSurveyId) router.push(`/viewer/${id}`);
        }}
      >
        <SelectTrigger className="h-10 w-full">
          <SelectValue placeholder="Select survey">
            <span className="truncate text-[13px] text-gray-100">{currentLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {surveys.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              Survey V{versionOf.get(s.id)} · {formatSurveyDate(s.survey_date)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="px-1 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">
        All Surveys
      </div>

      <div className="flex flex-col gap-1">
        {surveys.map((s) => {
          const active = s.id === currentSurveyId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                if (!active) router.push(`/viewer/${s.id}`);
              }}
              className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                active
                  ? "border-[#C97A4E]/40 bg-[#C97A4E]/[0.08]"
                  : "border-transparent hover:border-white/[0.06] hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-[13px] font-medium ${
                    active ? "text-[#F3F4F6]" : "text-gray-200"
                  }`}
                >
                  {formatSurveyDate(s.survey_date)}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded bg-[#1E2028] px-1.5 py-0.5 text-[10px] font-medium text-gray-400 border border-[#2A2D35]">
                    V{versionOf.get(s.id)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${statusBadge(
                      s.status
                    )}`}
                  >
                    {formatStatus(s.status)}
                  </span>
                </div>
              </div>
              <span className="text-[11px] text-gray-500">{s.survey_type}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
