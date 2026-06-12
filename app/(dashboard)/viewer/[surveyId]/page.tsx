"use client";

import React, { use } from "react";
import dynamic from "next/dynamic";

const SurveyViewer = dynamic(
  () => import("@/components/viewer/SurveyViewer").then((mod) => mod.SurveyViewer),
  { ssr: false, loading: () => <div className="w-full h-full bg-[#0A0D14]" /> }
);

export default function ViewerPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = use(params);

  return (
    <div className="w-full h-full bg-[#0A0D14] overflow-hidden">
      <SurveyViewer surveyId={surveyId} />
    </div>
  );
}
