"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { listSurveys, type Survey } from "@/lib/api/assetSvc";

/** Sibling surveys for the same project, linking to each viewer. */
export function SurveyList({
  projectId,
  currentSurveyId,
}: {
  projectId: string;
  currentSurveyId: string;
}) {
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSurveys(projectId)
      .then((res) => {
        if (cancelled) return;
        const list = (res.surveys || []).slice().sort((a, b) => b.survey_date.localeCompare(a.survey_date));
        setSurveys(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load surveys");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2">
      {surveys.map((s) => {
        const active = s.id === currentSurveyId;
        return (
          <Link
            key={s.id}
            href={`/viewer/${s.id}`}
            className={`flex flex-col rounded-[4px] px-2 py-1.5 transition-colors ${
              active ? "bg-[#1E2028] text-[#F3F4F6]" : "text-gray-300 hover:bg-white/[0.03]"
            }`}
          >
            <span className="truncate text-xs">{s.survey_date}</span>
            <span className="truncate text-[11px] text-[#71717a]">
              {s.survey_type} · {s.status}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
