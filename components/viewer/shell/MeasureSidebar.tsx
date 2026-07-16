"use client";

// MeasureSidebar (RE-PIVOT 2026-07-16) — the measure module's RIGHT dock, now
// purely the CALC/DETAIL surface. The measurements LIST moved back to the LEFT
// TreePanel ("keep this in the left panel how it was"); this dock hosts only
// DetailContent — the Calculation panel while drawing/probing, the
// FeatureInspector once a measurement is selected — and ViewerCanvas mounts it
// on demand (`detailPanel` non-null), so it needs no header chrome of its own:
// Export/collapse live in the TreePanel header, and the X inside the palette /
// inspector cancels + closes the dock (cancelDraw → closeDetail).
//
// `draftMeasurement` is threaded from ViewerCanvas for the just-drawn-shape
// inspector case (§3.3).

import React from "react";

import { useViewerStore } from "@/lib/viewer/state/store";
import { DetailContent } from "@/components/viewer/shell/DetailPanel";
import type { PanelMeasurement } from "@/lib/viewer/sampleData";

export function MeasureSidebar({
  draftMeasurement,
}: {
  draftMeasurement: PanelMeasurement | null;
}) {
  const detailPanel = useViewerStore((s) => s.detailPanel);
  if (!detailPanel) return null; // host gates on this too; belt-and-braces

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-white/[0.08] bg-[#111114]/95 backdrop-blur-xl">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailContent mode={detailPanel} draftMeasurement={draftMeasurement} />
      </div>
    </aside>
  );
}
