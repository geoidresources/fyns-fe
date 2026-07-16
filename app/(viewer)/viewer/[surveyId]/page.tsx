"use client";

// Viewer route — MOVED from app/(dashboard)/viewer/[surveyId] into the dedicated
// `(viewer)` route group (viewer-shell §1.2, D1). The URL stays /viewer/:surveyId
// (the group parens are elided). The gating logic is unchanged: `use(params)` +
// `useCesiumReady()` still hold the `next/dynamic {ssr:false}` import until
// window.Cesium exists, since the shell's chunk resolves the `cesium` external at
// eval time. Only the dynamic target flips SurveyViewer → ViewerShell (§7 1.3c).

import React, { use } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCesiumReady } from "@/hooks/useCesiumReady";

const ViewerShell = dynamic(
  () => import("@/components/viewer/shell/ViewerShell").then((mod) => mod.ViewerShell),
  { ssr: false, loading: () => <div className="w-full h-full bg-[#0A0D14]" /> }
);

export default function ViewerPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = use(params);
  const cesiumReady = useCesiumReady();

  return (
    <div className="w-full h-full bg-[#0A0D14] overflow-hidden">
      {cesiumReady ? (
        <ViewerShell surveyId={surveyId} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
          <Loader2 size={14} className="mr-2 animate-spin" />
          Loading viewer…
        </div>
      )}
    </div>
  );
}
