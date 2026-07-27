"use client";

import React, { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  AnalyticsUpIcon,
  ArrowRight01Icon,
  Building03Icon,
  Camera01Icon,
  CubeIcon,
  DistributionIcon,
  Image01Icon,
  Loading03Icon,
  MapsIcon,
  MountainIcon,
  PenTool02Icon,
  RippleIcon,
  Settings01Icon,
  SparklesIcon,
  Sun03Icon,
  Target01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import type { TerrainStats } from "@/lib/api/assetSvc";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CUTFILL_PALETTES,
  formatDelta,
  niceCeil,
  paletteCssGradient,
  roundDelta,
  type CutFillPaletteId,
  type CutFillSettings,
} from "@/lib/viewer/cutfillColormap";

export type LayerCategory = "terrain" | "ortho" | "pointcloud" | "lens" | "vector";

export interface LayerControl {
  key: string;
  label: string;
  category: LayerCategory;
  visible: boolean;
  opacity: number; // 0..1
  supportsOpacity: boolean;
  loading?: boolean; // async tileset/vector fetch in flight
  error?: string | null; // last load failure for this layer
  /** Real elevation stats from the manifest (terrain layers only). */
  stats?: TerrainStats;
  /** Baked lens ramp key (elevation colormaps, hillshade, slope, …). */
  lensRamp?: string;
  /** Contour spacing in meters (vector layers only). */
  intervalM?: number;
  /** Manifest vector role (image_positions, gcps, contours, …). */
  vectorRole?: string;
  /** Cut/fill row backed by a live client-colorized diff-raster (gets the gear)
   * rather than the server's baked PNG tiles (plain toggle). */
  cutfillLive?: boolean;
}

/** A CAD/vector design overlay (DXF, LandXML, …) from the manifest. */
export interface DesignControl {
  key: string;
  label: string;
  visible: boolean;
  renderable: boolean; // false → no geometry to draw yet (e.g. raw DXF not tiled)
}

export const BASE_MAPS = [
  { id: "dark", label: "Dark" },
  { id: "satellite", label: "Satellite" },
  { id: "streets", label: "Streets" },
] as const;

interface LayerPanelProps {
  layers: LayerControl[];
  designs: DesignControl[];
  processing: boolean;
  surveyStatus?: string;
  terrainExaggeration: number;
  baseMap: string;
  imageCount?: number;
  gcpCount?: number;
  hasImageLayer?: boolean;
  hasGcpLayer?: boolean;
  imagesVisible?: boolean;
  gcpsVisible?: boolean;
  colorMap: string;
  shading: string;
  availableColorMaps: string[];
  hasHillshade: boolean;
  contourIntervalM: number | null;
  availableContourIntervals: number[];
  digitalTwinEnabled?: boolean;
  digitalTwinAvailable?: boolean;
  showDigitalTwin?: boolean;
  sunLightingEnabled?: boolean;
  sunHour?: number;
  /** Live cut/fill render settings keyed by layer key (empty until a raster loads). */
  cutfillSettings?: Record<string, CutFillSettings>;
  onToggle: (key: string) => void;
  onOpacity: (key: string, opacity: number) => void;
  onCutfillSettings?: (key: string, patch: Partial<CutFillSettings>) => void;
  onToggleDesign: (key: string) => void;
  onTerrainExaggeration: (value: number) => void;
  onSetBaseMap: (value: string) => void;
  onColorMapChange: (value: string) => void;
  onShadingChange: (value: string) => void;
  onContourIntervalChange: (intervalM: number) => void;
  /** Open the contour-generation dialog (the trigger that populates
   * `availableContourIntervals`). Omitted → the "Generate…" affordance hides. */
  onGenerateContours?: () => void;
  onToggleImages?: () => void;
  onToggleGcps?: () => void;
  onToggleDigitalTwin?: () => void;
  onSunLightingChange?: (enabled: boolean, hour: number) => void;
}

// -------------------------------------------------------------- primitives

/** Collapsible section with an orange, uppercase, caret-prefixed header. */
function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-2 pt-4 pb-1.5">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          className={`shrink-0 text-[#C97A4E] transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#C97A4E]">
          {title}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Icon + label (+ optional count) + a right-side control (Switch by default). */
function ControlRow({
  icon,
  label,
  count,
  active,
  disabled,
  loading,
  error,
  right,
  onToggle,
  onDisabledClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: string;
  active: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  right?: React.ReactNode;
  onToggle?: () => void;
  // Fired when the row is clicked while disabled — a disabled Switch swallows
  // its own onCheckedChange, so without this the "why is this off?" hint (e.g.
  // "not available for this survey") could never reach the user.
  onDisabledClick?: () => void;
}) {
  const rowDisabledClick = disabled && onDisabledClick ? onDisabledClick : undefined;
  return (
    <div
      className={`flex h-9 items-center gap-2.5 px-2 ${rowDisabledClick ? "cursor-pointer" : ""}`}
      onClick={rowDisabledClick}
      role={rowDisabledClick ? "button" : undefined}
    >
      <span className={`shrink-0 ${active ? "text-[#C97A4E]" : "text-gray-500"}`}>{icon}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          active ? "font-medium text-[#F3F4F6]" : "text-gray-300"
        }`}
      >
        {label}
        {count && <span className="ml-1.5 text-[11px] text-gray-500">{count}</span>}
      </span>
      {loading && (
        <HugeiconsIcon icon={Loading03Icon} size={13} className="shrink-0 animate-spin text-[#C97A4E]" />
      )}
      {!loading && error && (
        <span title={error}>
          <HugeiconsIcon icon={AlertCircleIcon} size={13} className="shrink-0 text-red-400" />
        </span>
      )}
      {right ?? (
        <Switch checked={active} disabled={disabled} onCheckedChange={onToggle} />
      )}
    </div>
  );
}
/** Sun-position popover: azimuth/time-of-day slider toggling Cesium globe lighting. */
function SunPositionRow({
  enabled,
  hour,
  onChange,
}: {
  enabled: boolean;
  hour: number;
  onChange: (enabled: boolean, hour: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex h-9 items-center gap-2.5 px-2">
        <HugeiconsIcon
          icon={Sun03Icon}
          size={16}
          className={`shrink-0 ${enabled ? "text-[#C97A4E]" : "text-gray-500"}`}
        />
        <span className="min-w-0 flex-1 text-[13px] text-gray-300">Sun Position</span>
        <button
          type="button"
          aria-label="Sun position settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <HugeiconsIcon icon={Settings01Icon} size={14} />
        </button>
      </div>
      {open && (
        <div className="mx-2 mb-2 space-y-3 rounded-lg border border-white/[0.06] bg-[#16161a] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">Lighting</span>
            <Switch checked={enabled} onCheckedChange={(v) => onChange(v, hour)} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-gray-400">Time of day</span>
              <span className="tabular-nums text-gray-300">{Math.round(hour)}:00</span>
            </div>
            <Slider
              value={[hour]}
              min={0}
              max={23}
              step={1}
              disabled={!enabled}
              onValueChange={([v]) => onChange(enabled, v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Elevation-distribution histogram. Renders the surface's real per-bucket
 * counts when the manifest carries stats; otherwise falls back to a
 * deterministic presentational stand-in. */
function Histogram({ buckets }: { buckets?: number[] }) {
  const bars = React.useMemo(() => {
    if (buckets && buckets.length > 0) {
      // Compress to ~26 display bars and normalize against the tallest.
      const display = 26;
      const grouped =
        buckets.length <= display
          ? buckets
          : Array.from({ length: display }, (_, i) => {
              const lo = Math.floor((i * buckets.length) / display);
              const hi = Math.floor(((i + 1) * buckets.length) / display);
              let sum = 0;
              for (let j = lo; j < hi; j++) sum += buckets[j];
              return sum;
            });
      const max = Math.max(...grouped, 1);
      return grouped.map((v) => (v > 0 ? Math.max(0.04, v / max) : 0.02));
    }
    return Array.from({ length: 26 }, (_, i) => {
      const v = Math.sin(i * 0.7) * 0.5 + Math.cos(i * 1.9) * 0.25 + 0.6;
      return Math.max(0.25, Math.min(1, v));
    });
  }, [buckets]);
  return (
    <div className="flex h-14 items-end gap-[3px]">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${h * 100}%`,
            background: "linear-gradient(to top, #4d7c1f, #84cc16)",
          }}
        />
      ))}
    </div>
  );
}

const SHADING = ["None", "Hillshade"];

function formatIntervalLabel(m: number): string {
  return Number.isInteger(m) ? `${m}m` : `${m}m`;
}

function contourRole(role?: string): boolean {
  if (!role) return false;
  return role === "contours" || role.startsWith("contours_");
}

function formatElevationM(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value)} m`;
}

/** Inline expandable settings for a DSM/DTM terrain layer. Opacity is wired to
 * the real tileset; colormap/shading switch baked lens overlays when present. */
function TerrainSettings({
  opacity,
  onOpacity,
  stats,
  colorMap,
  shading,
  availableColorMaps,
  hasHillshade,
  onColorMapChange,
  onShadingChange,
}: {
  opacity: number;
  onOpacity: (opacity: number) => void;
  stats?: TerrainStats;
  colorMap: string;
  shading: string;
  availableColorMaps: string[];
  hasHillshade: boolean;
  onColorMapChange: (value: string) => void;
  onShadingChange: (value: string) => void;
}) {
  const [range, setRange] = useState(() => ({
    min: stats ? String(Math.round(stats.min_elevation)) : "0",
    max: stats ? String(Math.round(stats.max_elevation)) : "100",
  }));

  // Re-sync the range inputs when a new stats object arrives (survey switch).
  // Done as a render-phase adjustment rather than an effect: no extra commit,
  // no set-state-in-effect, and the fresh range renders on the first paint.
  // (React's documented "adjust state on prop change" pattern — the previous
  // value is tracked in state, not a ref, so it stays render-safe.)
  const [prevStats, setPrevStats] = useState(stats);
  if (stats && stats !== prevStats) {
    setPrevStats(stats);
    setRange({
      min: String(Math.round(stats.min_elevation)),
      max: String(Math.round(stats.max_elevation)),
    });
  }

  return (
    <div className="mx-2 mb-2 space-y-4 rounded-lg border border-white/[0.06] bg-[#16161a] p-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-gray-400">Opacity</span>
          <span className="tabular-nums text-gray-300">{Math.round(opacity * 100)}%</span>
        </div>
        <Slider
          value={[Math.round(opacity * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={([v]) => onOpacity(v / 100)}
        />
      </div>

      <div>
        <div className="mb-1.5 text-[11px] text-gray-400">Histogram</div>
        <Histogram buckets={stats?.histogram} />
        {stats && (
          <div className="mt-1 flex justify-between text-[10px] text-gray-500">
            <span>{formatElevationM(stats.histogram_min ?? stats.min_elevation)}</span>
            <span>{formatElevationM(stats.histogram_max ?? stats.max_elevation)}</span>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-[11px] text-gray-400">Range</div>
        <div className="flex items-center gap-2">
          <input
            value={range.min}
            onChange={(e) => setRange((r) => ({ ...r, min: e.target.value }))}
            inputMode="numeric"
            readOnly={!!stats}
            className="h-8 w-full rounded-md border border-white/[0.08] bg-[#19191d] px-2.5 text-xs text-gray-200 focus:border-[#C97A4E] focus:outline-none"
          />
          <span className="h-px w-2 shrink-0 bg-[#C97A4E]" />
          <input
            value={range.max}
            onChange={(e) => setRange((r) => ({ ...r, max: e.target.value }))}
            inputMode="numeric"
            readOnly={!!stats}
            className="h-8 w-full rounded-md border border-white/[0.08] bg-[#19191d] px-2.5 text-xs text-gray-200 focus:border-[#C97A4E] focus:outline-none"
          />
        </div>
        {stats && (
          <p className="mt-1 text-[10px] text-gray-500">
            Mean {formatElevationM(stats.mean)} · σ {stats.std_dev.toFixed(1)} m
          </p>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-[11px] text-gray-400">Color Map</div>
        <Select
          value={colorMap}
          onValueChange={onColorMapChange}
          disabled={availableColorMaps.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={availableColorMaps.length ? undefined : "None available"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="None">None</SelectItem>
            {availableColorMaps.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] text-gray-400">Shading</div>
        <Select value={shading} onValueChange={onShadingChange} disabled={!hasHillshade}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHADING.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** A DSM/DTM row: switch + expandable settings card. */
function TerrainLayerRow({
  control,
  onToggle,
  onOpacity,
  colorMap,
  shading,
  availableColorMaps,
  hasHillshade,
  onColorMapChange,
  onShadingChange,
}: {
  control: LayerControl;
  onToggle: () => void;
  onOpacity: (opacity: number) => void;
  colorMap: string;
  shading: string;
  availableColorMaps: string[];
  hasHillshade: boolean;
  onColorMapChange: (value: string) => void;
  onShadingChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex h-9 items-center gap-2.5 px-2">
        <span className={`shrink-0 ${control.visible ? "text-[#C97A4E]" : "text-gray-500"}`}>
          <HugeiconsIcon icon={MountainIcon} size={16} />
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            control.visible ? "font-medium text-[#F3F4F6]" : "text-gray-300"
          }`}
        >
          {control.label}
        </span>
        {control.loading && (
          <HugeiconsIcon icon={Loading03Icon} size={13} className="shrink-0 animate-spin text-[#C97A4E]" />
        )}
        <button
          type="button"
          aria-label="Toggle settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={14}
            className={`transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
          />
        </button>
        <button
          type="button"
          aria-label="Layer settings"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <HugeiconsIcon icon={Settings01Icon} size={14} />
        </button>
        <Switch checked={control.visible} onCheckedChange={onToggle} />
      </div>
      {open && (
        <TerrainSettings
          opacity={control.opacity}
          onOpacity={onOpacity}
          stats={control.stats}
          colorMap={colorMap}
          shading={shading}
          availableColorMaps={availableColorMaps}
          hasHillshade={hasHillshade}
          onColorMapChange={onColorMapChange}
          onShadingChange={onShadingChange}
        />
      )}
    </div>
  );
}

/** Live-colormap settings card for a cut/fill layer: palette, legend, symmetric
 * range (auto ±p98 or manual), opacity, and a deadband. Every change flows out
 * through `onChange` → recolorizes the diff-raster in place (instant CPU pass).
 * All derived (span/slider bounds) is computed in render — no stored copies. */
function CutFillSettingsCard({
  settings,
  onChange,
}: {
  settings: CutFillSettings;
  onChange: (patch: Partial<CutFillSettings>) => void;
}) {
  const isAuto = settings.rangeMode === "auto";
  // Symmetric half-width the ramp currently spans (the diverging map is centered
  // on 0, so |min| and |max| match; guard asymmetry defensively).
  const span = Math.max(Math.abs(settings.min), Math.abs(settings.max));
  const sliderMax = Math.max(niceCeil(settings.absMax || span || 1), roundDelta(span) || 1);
  const step = sliderMax >= 50 ? 1 : sliderMax >= 10 ? 0.5 : sliderMax >= 2 ? 0.1 : 0.05;
  const deadMax = Math.max(0.5, roundDelta(Math.max(settings.absP98, 0.5)));
  const deadStep = deadMax >= 5 ? 0.1 : 0.05;

  const setAuto = (auto: boolean) => {
    if (auto) {
      const p98 = roundDelta(Math.max(settings.absP98, 0.01));
      onChange({ rangeMode: "auto", min: -p98, max: p98 });
    } else {
      onChange({ rangeMode: "manual" });
    }
  };

  return (
    <div className="mx-2 mb-2 space-y-4 rounded-lg border border-white/[0.06] bg-[#16161a] p-3">
      <div>
        <div className="mb-1.5 text-[11px] text-gray-400">Palette</div>
        <Select
          value={settings.palette}
          onValueChange={(v) => onChange({ palette: v as CutFillPaletteId })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUTFILL_PALETTES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div
          className="h-3 w-full rounded-sm border border-white/[0.06]"
          style={{ background: paletteCssGradient(settings.palette) }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-gray-500">
          <span className="tabular-nums">{formatDelta(settings.min)}</span>
          <span className="text-gray-400">cut · 0 · fill</span>
          <span className="tabular-nums">{formatDelta(settings.max)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400">Auto range (±p98)</span>
        <Switch checked={isAuto} onCheckedChange={setAuto} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-gray-400">Range ±</span>
          <span className="tabular-nums text-gray-300">{roundDelta(span)} m</span>
        </div>
        <Slider
          value={[Math.min(Math.max(span, step), sliderMax)]}
          min={step}
          max={sliderMax}
          step={step}
          disabled={isAuto}
          onValueChange={([v]) => onChange({ rangeMode: "manual", min: -v, max: v })}
          aria-label="Cut/fill symmetric range"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-gray-400">Opacity</span>
          <span className="tabular-nums text-gray-300">{Math.round(settings.opacity * 100)}%</span>
        </div>
        <Slider
          value={[Math.round(settings.opacity * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={([v]) => onChange({ opacity: v / 100 })}
          aria-label="Cut/fill opacity"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-gray-400">Hide |Δ| below</span>
          <span className="tabular-nums text-gray-300">{settings.deadbandM.toFixed(2)} m</span>
        </div>
        <Slider
          value={[Math.min(settings.deadbandM, deadMax)]}
          min={0}
          max={deadMax}
          step={deadStep}
          onValueChange={([v]) => onChange({ deadbandM: v })}
          aria-label="Cut/fill deadband"
        />
      </div>
    </div>
  );
}

/** A cut/fill row backed by the live diff-raster: switch + gear opening the
 * colormap card (mirrors TerrainLayerRow's gear UX). */
function CutFillLayerRow({
  control,
  settings,
  onToggle,
  onChange,
}: {
  control: LayerControl;
  settings: CutFillSettings;
  onToggle: () => void;
  onChange: (patch: Partial<CutFillSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex h-9 items-center gap-2.5 px-2">
        <span className={`shrink-0 ${control.visible ? "text-[#C97A4E]" : "text-gray-500"}`}>
          <HugeiconsIcon icon={SparklesIcon} size={16} />
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            control.visible ? "font-medium text-[#F3F4F6]" : "text-gray-300"
          }`}
        >
          {control.label}
        </span>
        {control.loading && (
          <HugeiconsIcon icon={Loading03Icon} size={13} className="shrink-0 animate-spin text-[#C97A4E]" />
        )}
        <button
          type="button"
          aria-label="Cut/fill colormap settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <HugeiconsIcon icon={Settings01Icon} size={14} />
        </button>
        <Switch checked={control.visible} onCheckedChange={onToggle} />
      </div>
      {open && <CutFillSettingsCard settings={settings} onChange={onChange} />}
    </div>
  );
}

/** Row controlling a whole group of layers (View Types master toggles). */
function GroupRow({
  icon,
  label,
  group,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  group: LayerControl[];
  onToggle: (key: string) => void;
}) {
  const anyVisible = group.some((l) => l.visible);
  const loading = group.some((l) => l.loading);
  const error = group.find((l) => l.error)?.error ?? null;

  const toggleGroup = () => {
    if (anyVisible) {
      // Hide every visible member.
      group.filter((l) => l.visible).forEach((l) => onToggle(l.key));
    } else {
      // Show the first member (terrain exclusivity is handled upstream).
      const first = group[0];
      if (first) onToggle(first.key);
    }
  };

  return (
    <ControlRow
      icon={icon}
      label={label}
      active={anyVisible}
      loading={loading}
      error={error}
      onToggle={toggleGroup}
    />
  );
}

/** Picks a lens icon from its derived label (slope/gradient vs vegetation). */
function lensIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("gradient") || l.includes("slope") || l.includes("aspect")) {
    return <HugeiconsIcon icon={AnalyticsUpIcon} size={16} />;
  }
  return <HugeiconsIcon icon={SparklesIcon} size={16} />;
}

// ------------------------------------------------------------------- panel

export function LayerPanel({
  layers = [],
  designs = [],
  processing,
  surveyStatus,
  terrainExaggeration,
  baseMap,
  imageCount,
  gcpCount,
  hasImageLayer = false,
  hasGcpLayer = false,
  imagesVisible = false,
  gcpsVisible = false,
  colorMap,
  shading,
  availableColorMaps,
  hasHillshade,
  contourIntervalM,
  availableContourIntervals,
  digitalTwinEnabled = false,
  digitalTwinAvailable = false,
  showDigitalTwin = true,
  sunLightingEnabled = false,
  sunHour = 12,
  cutfillSettings = {},
  onToggle,
  onOpacity,
  onCutfillSettings,
  onToggleDesign,
  onTerrainExaggeration,
  onSetBaseMap,
  onColorMapChange,
  onShadingChange,
  onContourIntervalChange,
  onGenerateContours,
  onToggleImages,
  onToggleGcps,
  onToggleDigitalTwin,
  onSunLightingChange,
}: LayerPanelProps) {
  const byPrefix = (prefix: string) => layers.filter((l) => l.key.startsWith(prefix));
  const ortho = byPrefix("ortho-");
  const terrain = byPrefix("terrain-");
  const lenses = byPrefix("lens-").filter(
    (l) => !l.lensRamp || !["viridis", "terrain", "plasma", "grayscale", "hillshade"].includes(l.lensRamp)
  );
  const vectors = byPrefix("vector-");
  const contourVectors = vectors.filter((l) => contourRole(l.vectorRole));
  const pointClouds = byPrefix("pointcloud-");
  const siteModels = byPrefix("sitemodel-");
  const cutFill = byPrefix("cutfill-");

  return (
    <div className="flex flex-col pb-2">
      {processing && layers.length === 0 && (
        <div className="mx-2 mb-2 mt-3 flex items-start gap-2 rounded-lg border border-[#2A2D35] bg-[#1E2028]/50 p-3">
          <HugeiconsIcon icon={Loading03Icon} size={14} className="mt-0.5 shrink-0 animate-spin text-[#C97A4E]" />
          <div>
            <p className="text-xs font-medium text-gray-300">Processing survey…</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Layers appear here when processors finish
              {surveyStatus ? ` (status: ${surveyStatus})` : ""}. Checking every 30s.
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- MAP LAYERS */}
      {(ortho.length > 0 || terrain.length > 0 || lenses.length > 0 || cutFill.length > 0 || designs.length > 0) && (
        <Section title="Map Layers" defaultOpen>
          {ortho.map((l) => (
            <ControlRow
              key={l.key}
              icon={<HugeiconsIcon icon={Image01Icon} size={16} />}
              label={l.label}
              active={l.visible}
              loading={l.loading}
              error={l.error}
              onToggle={() => onToggle(l.key)}
            />
          ))}
          {terrain.map((l) => (
            <TerrainLayerRow
              key={l.key}
              control={l}
              onToggle={() => onToggle(l.key)}
              onOpacity={(o) => onOpacity(l.key, o)}
              colorMap={colorMap}
              shading={shading}
              availableColorMaps={availableColorMaps}
              hasHillshade={hasHillshade}
              onColorMapChange={onColorMapChange}
              onShadingChange={onShadingChange}
            />
          ))}
          {lenses.map((l) => (
            <ControlRow
              key={l.key}
              icon={lensIcon(l.label)}
              label={l.label}
              active={l.visible}
              loading={l.loading}
              error={l.error}
              onToggle={() => onToggle(l.key)}
            />
          ))}
          {cutFill.map((l) => {
            // Live diff-raster rows get the colormap gear; the baked-tile
            // fallback (no raster / load failure) keeps the plain toggle.
            const settings = l.cutfillLive ? cutfillSettings[l.key] : undefined;
            return settings && onCutfillSettings ? (
              <CutFillLayerRow
                key={l.key}
                control={l}
                settings={settings}
                onToggle={() => onToggle(l.key)}
                onChange={(patch) => onCutfillSettings(l.key, patch)}
              />
            ) : (
              <ControlRow
                key={l.key}
                icon={<HugeiconsIcon icon={SparklesIcon} size={16} />}
                label={l.label}
                active={l.visible}
                loading={l.loading}
                error={l.error}
                onToggle={() => onToggle(l.key)}
              />
            );
          })}
          {designs.map((d) => (
            <ControlRow
              key={d.key}
              icon={<HugeiconsIcon icon={PenTool02Icon} size={16} />}
              label={d.label}
              active={d.visible}
              disabled={!d.renderable}
              onToggle={() => onToggleDesign(d.key)}
              onDisabledClick={() =>
                toast.info("This design isn't renderable yet — raw CAD is tiled server-side first")
              }
            />
          ))}
        </Section>
      )}

      {/* ---------------------------------------------------- VIEW TYPES */}
      <Section title="View Types" defaultOpen>
        {terrain.length > 0 && (
          <GroupRow icon={<HugeiconsIcon icon={MountainIcon} size={16} />} label="Terrain" group={terrain} onToggle={onToggle} />
        )}
        {contourVectors.length > 0 && (
          <GroupRow icon={<HugeiconsIcon icon={RippleIcon} size={16} />} label="Contour Lines" group={contourVectors} onToggle={onToggle} />
        )}
        {siteModels.length > 0 && (
          <GroupRow icon={<HugeiconsIcon icon={CubeIcon} size={16} />} label="3D Model" group={siteModels} onToggle={onToggle} />
        )}
        {pointClouds.length > 0 && (
          <GroupRow icon={<HugeiconsIcon icon={DistributionIcon} size={16} />} label="Point Cloud" group={pointClouds} onToggle={onToggle} />
        )}
        {showDigitalTwin && (
          <ControlRow
            icon={<HugeiconsIcon icon={Building03Icon} size={16} />}
            label="Digital Twin"
            active={digitalTwinEnabled}
            disabled={!digitalTwinAvailable}
            onToggle={() => onToggleDigitalTwin?.()}
            onDisabledClick={() =>
              toast.info("Digital Twin requires a Cesium ion token (World Terrain)")
            }
          />
        )}
      </Section>

      {/* --------------------------------------------------- SURVEY DATA */}
      <Section title="Survey Data">
        <ControlRow
          icon={<HugeiconsIcon icon={Camera01Icon} size={16} />}
          label="Images"
          count={imageCount ? `${imageCount.toLocaleString()} images` : undefined}
          active={imagesVisible}
          disabled={!hasImageLayer}
          onToggle={() => onToggleImages?.()}
          onDisabledClick={() => toast.info("Image positions — not available for this survey")}
        />
        <ControlRow
          icon={<HugeiconsIcon icon={Target01Icon} size={16} />}
          label="GCPs"
          count={gcpCount ? `${gcpCount} GCPs` : undefined}
          active={gcpsVisible}
          disabled={!hasGcpLayer}
          onToggle={() => onToggleGcps?.()}
          onDisabledClick={() => toast.info("Ground control points — not available for this survey")}
        />
      </Section>

      {/* -------------------------------------------------- MAP CONTROLS */}
      <Section title="Map Controls">
        <div className="flex h-9 items-center gap-2.5 px-2">
          <HugeiconsIcon icon={MapsIcon} size={16} className="shrink-0 text-[#C97A4E]" />
          <span className="min-w-0 flex-1 text-[13px] text-gray-300">Base Map</span>
          <Select value={baseMap} onValueChange={onSetBaseMap}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASE_MAPS.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <SunPositionRow
          enabled={sunLightingEnabled}
          hour={sunHour}
          onChange={(enabled, hour) => onSunLightingChange?.(enabled, hour)}
        />

        <div className="px-2 pt-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-400">Vertical Exag</span>
            <span className="tabular-nums text-gray-300">{terrainExaggeration.toFixed(1)}x</span>
          </div>
          <Slider
            value={[terrainExaggeration]}
            min={1}
            max={3}
            step={0.1}
            onValueChange={([v]) => onTerrainExaggeration(v)}
            aria-label="Vertical exaggeration"
          />
        </div>

        <div className="mt-1 flex h-9 items-center gap-2.5 px-2">
          <HugeiconsIcon icon={RippleIcon} size={16} className="shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1 text-[13px] text-gray-300">Contour Interval</span>
          {onGenerateContours && (
            <button
              type="button"
              onClick={onGenerateContours}
              className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[11px] text-gray-400 outline-none transition-colors hover:bg-white/[0.04] hover:text-[#C97A4E] focus-visible:ring-1 focus-visible:ring-[#C97A4E]/50"
            >
              {availableContourIntervals.length === 0 ? "Generate…" : "+ Add…"}
            </button>
          )}
          <Select
            value={contourIntervalM != null ? String(contourIntervalM) : undefined}
            onValueChange={(v) => onContourIntervalChange(Number(v))}
            disabled={availableContourIntervals.length === 0}
          >
            <SelectTrigger className="w-20">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {availableContourIntervals.map((v) => (
                <SelectItem key={v} value={String(v)}>
                  {formatIntervalLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>
    </div>
  );
}
