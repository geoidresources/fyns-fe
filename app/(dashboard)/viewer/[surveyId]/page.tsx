"use client";

import React, { use } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCesiumReady } from "@/hooks/useCesiumReady";

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
  // SurveyViewer's chunk resolves the `cesium` external at eval time, so the
  // dynamic import must not start until window.Cesium exists.
  const cesiumReady = useCesiumReady();

  return (
    <div className="w-full h-full bg-[#0A0D14] overflow-hidden">
      {cesiumReady ? (
        <SurveyViewer surveyId={surveyId} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
          <Loader2 size={14} className="mr-2 animate-spin" />
          Loading viewer…
        </div>
      )}
    </div>
  );
}
