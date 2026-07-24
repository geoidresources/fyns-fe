"use client";

// Zone 2 — TreePanel (viewer-shell §2.1/§4.2). Module-keyed frame: `measure` →
// WorkspaceTree (§6.3, over the TreeSource seam), `survey` → the existing
// SurveyList above LayerPanel, other modules → a phase empty-state. The old
// `Tabs(Surveys|Layers)` is retired — the module rail is the tab now (§4.2).
//
// DATA is read from the store with per-field selectors (§3.6); the Cesium-bound
// callbacks come from `useViewerActions()` (they close over ViewerCanvas's refs).
// The reused panels keep their prop interfaces verbatim — the derivations below
// (color maps, contour intervals, image/gcp vectors, digital-twin availability)
// are the same `useMemo`s that lived in SurveyViewer, now computed here from
// store state.

import React, { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, Download, FileJson, FileText, Loader2, Sheet } from "lucide-react";

import { useViewerStore } from "@/lib/viewer/state/store";
import { useViewerActions } from "@/components/viewer/shell/viewerActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ELEVATION_RAMPS,
  contourVectorRole,
  manifestLayersEmpty,
} from "@/components/viewer/shell/sceneHelpers";
import { isMineSiteProject } from "@/lib/dashboard/resolveProjectCenter";
import { USE_WORLD_TERRAIN } from "@/lib/viewer/cesiumIon";
import { LayerPanel } from "@/components/viewer/LayerPanel";
import { SurveyList } from "@/components/viewer/SurveyList";
import { WorkspaceTree } from "@/components/viewer/shell/WorkspaceTree";
import type { ModuleKey } from "@/lib/viewer/state/store";

const MODULE_TITLES: Record<Exclude<ModuleKey, "measure" | "survey">, string> = {
  designs: "Designs",
  media: "Media",
  hydro: "Hydro",
  crew: "Crew",
  machines: "Machines",
};

export function TreePanel() {
  const activeModule = useViewerStore((s) => s.activeModule);
  const manifest = useViewerStore((s) => s.manifest);
  const manifestError = useViewerStore((s) => s.manifestError);
  const surveyId = useViewerStore((s) => s.surveyId);
  const setTreePanelOpen = useViewerStore((s) => s.setTreePanelOpen);
  const actions = useViewerActions();

  const surveyTitle = manifest ? `Survey ${manifest.survey.survey_date}` : "Survey viewer";

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-white/[0.08] bg-[#111114]/95 backdrop-blur-xl">
      {/* Header: survey title + working CRS · vertical datum (moved from
          SurveyViewer :2063-2076, minus the back arrow — the rail logo is the
          exit now), collapse chevron, and Export (relocated, D8). */}
      <div className="flex items-start gap-2 px-3 pt-4 pb-2 shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-gray-100">{surveyTitle}</h2>
          {manifest?.survey.working_crs && (
            <p className="truncate text-[10px] text-gray-500">
              {manifest.survey.working_crs}
              {manifest.survey.vertical_datum ? ` · ${manifest.survey.vertical_datum}` : ""}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Export & reports"
            className="shrink-0 rounded-[4px] p-1 text-gray-500 outline-none transition-colors hover:bg-white/[0.03] hover:text-gray-200 data-[state=open]:bg-white/[0.05] data-[state=open]:text-gray-200"
          >
            <Download size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Export & reports</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => actions.openSiteReport()}>
              <FileText size={14} className="text-[#C97A4E]" />
              Site report…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.exportMeasurementsCsv()}>
              <Sheet size={14} />
              Measurements (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.exportMeasurements()}>
              <FileJson size={14} />
              Measurements (GeoJSON)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="Collapse panel"
          onClick={() => setTreePanelOpen(false)}
          className="shrink-0 rounded-[4px] p-1 text-gray-500 transition-colors hover:bg-white/[0.03] hover:text-gray-200"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {manifestError ? (
          <div className="m-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-xs text-red-400">{manifestError}</p>
          </div>
        ) : activeModule === "measure" ? (
          // Renders without a manifest — an empty tree is the valid no-data
          // state (the survey title in the header degrades to a fallback).
          <WorkspaceTree />
        ) : activeModule === "survey" ? (
          manifest ? (
            <SurveyTree projectId={manifest.survey.project_id} surveyId={surveyId} />
          ) : (
            <div className="flex items-center gap-2 p-4 text-xs text-gray-500">
              <Loader2 size={14} className="animate-spin" />
              Loading manifest…
            </div>
          )
        ) : (
          <div className="p-4">
            <p className="text-xs font-medium text-gray-300">
              {MODULE_TITLES[activeModule as keyof typeof MODULE_TITLES]}
            </p>
            <p className="mt-1 text-[11px] text-gray-500">This module arrives in a later phase.</p>
            <Link
              href="/globe"
              className="mt-3 inline-block text-[11px] text-[#C97A4E] hover:underline"
            >
              Back to globe
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}

/** `survey` module — the existing SurveyList above LayerPanel, store-wired. The
 * layer derivations mirror SurveyViewer's `useMemo`s. */
function SurveyTree({ projectId, surveyId }: { projectId: string; surveyId: string }) {
  const manifest = useViewerStore((s) => s.manifest);
  const layerControls = useViewerStore((s) => s.layerControls);
  const designControls = useViewerStore((s) => s.designControls);
  const cutfillSettings = useViewerStore((s) => s.cutfillSettings);
  const project = useViewerStore((s) => s.project);
  const view = useViewerStore((s) => s.view);
  const actions = useViewerActions();

  const availableColorMaps = useMemo(() => {
    const ramps = new Set<string>();
    for (const l of layerControls) {
      if (l.lensRamp && (ELEVATION_RAMPS as readonly string[]).includes(l.lensRamp)) {
        ramps.add(l.lensRamp.charAt(0).toUpperCase() + l.lensRamp.slice(1));
      }
    }
    return Array.from(ramps);
  }, [layerControls]);

  const hasHillshade = useMemo(
    () => layerControls.some((l) => l.lensRamp === "hillshade"),
    [layerControls]
  );

  const availableContourIntervals = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const l of layerControls) {
      if (l.vectorRole && contourVectorRole(l.vectorRole) && l.intervalM && l.intervalM > 0) {
        if (!seen.has(l.intervalM)) {
          seen.add(l.intervalM);
          out.push(l.intervalM);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }, [layerControls]);

  const imageVector = useMemo(
    () => layerControls.find((l) => l.vectorRole === "image_positions"),
    [layerControls]
  );
  const gcpVector = useMemo(
    () => layerControls.find((l) => l.vectorRole === "gcps"),
    [layerControls]
  );

  const contourIntervalM = view.contourIntervalM ?? availableContourIntervals[0] ?? null;
  const imageCount = manifest?.layers.vectors?.find((v) => v.role === "image_positions")?.feature_count;
  const gcpCount = manifest?.layers.vectors?.find((v) => v.role === "gcps")?.feature_count;
  const showDigitalTwin =
    project !== null &&
    manifest?.survey.project_id === project.id &&
    !isMineSiteProject(project);

  return (
    <>
      <SurveyList projectId={projectId} currentSurveyId={surveyId} />
      <LayerPanel
        layers={layerControls}
        designs={designControls}
        processing={manifestLayersEmpty(manifest)}
        surveyStatus={manifest?.survey.status}
        terrainExaggeration={view.terrainExaggeration}
        baseMap={view.baseMap}
        imageCount={imageCount}
        gcpCount={gcpCount}
        hasImageLayer={!!imageVector}
        hasGcpLayer={!!gcpVector}
        imagesVisible={imageVector?.visible ?? false}
        gcpsVisible={gcpVector?.visible ?? false}
        colorMap={view.colorMap}
        shading={view.shading}
        availableColorMaps={availableColorMaps}
        hasHillshade={hasHillshade}
        contourIntervalM={contourIntervalM}
        availableContourIntervals={availableContourIntervals}
        digitalTwinEnabled={view.digitalTwinEnabled}
        digitalTwinAvailable={USE_WORLD_TERRAIN}
        showDigitalTwin={showDigitalTwin}
        sunLightingEnabled={view.sunLightingEnabled}
        sunHour={view.sunHour}
        cutfillSettings={cutfillSettings}
        onToggle={actions.handleToggle}
        onOpacity={actions.handleOpacity}
        onCutfillSettings={actions.handleCutfillSettings}
        onToggleDesign={actions.handleToggleDesign}
        onTerrainExaggeration={actions.setTerrainExaggeration}
        onSetBaseMap={actions.setBaseMap}
        onColorMapChange={actions.handleColorMapChange}
        onShadingChange={actions.handleShadingChange}
        onContourIntervalChange={actions.handleContourIntervalChange}
        onToggleImages={actions.handleToggleImages}
        onToggleGcps={actions.handleToggleGcps}
        onToggleDigitalTwin={actions.handleToggleDigitalTwin}
        onSunLightingChange={actions.handleSunLightingChange}
      />
    </>
  );
}
