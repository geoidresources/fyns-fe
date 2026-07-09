"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  Building2,
  Camera,
  ChevronRight,
  Circle,
  Layers,
  Loader2,
  Map as MapIcon,
  Minus,
  Settings2,
  Sparkles,
  Sun,
  TrendingUp,
} from "lucide-react";
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
  sunLightingEnabled?: boolean;
  sunHour?: number;
  onToggle: (key: string) => void;
  onOpacity: (key: string, opacity: number) => void;
  onToggleDesign: (key: string) => void;
  onTerrainExaggeration: (value: number) => void;
  onSetBaseMap: (value: string) => void;
  onColorMapChange: (value: string) => void;
  onShadingChange: (value: string) => void;
  onContourIntervalChange: (intervalM: number) => void;
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
        <ChevronRight
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
}) {
  return (
    <div className="flex h-9 items-center gap-2.5 px-2">
      <span className={`shrink-0 ${active ? "text-[#C97A4E]" : "text-gray-500"}`}>{icon}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          active ? "font-medium text-[#F3F4F6]" : "text-gray-300"
        }`}
      >
        {label}
        {count && <span className="ml-1.5 text-[11px] text-gray-500">{count}</span>}
      </span>
      {loading && <Loader2 size={13} className="shrink-0 animate-spin text-[#C97A4E]" />}
      {!loading && error && (
        <span title={error}>
          <AlertCircle size={13} className="shrink-0 text-red-400" />
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
        <Sun size={16} className={`shrink-0 ${enabled ? "text-[#C97A4E]" : "text-gray-500"}`} />
        <span className="min-w-0 flex-1 text-[13px] text-gray-300">Sun Position</span>
        <button
          type="button"
          aria-label="Sun position settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <Settings2 size={14} />
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

const COLOR_MAPS = ["Viridis", "Terrain", "Plasma", "Grayscale"];
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

  React.useEffect(() => {
    if (!stats) return;
    setRange({
      min: String(Math.round(stats.min_elevation)),
      max: String(Math.round(stats.max_elevation)),
    });
  }, [stats]);

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
          <Layers size={16} />
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            control.visible ? "font-medium text-[#F3F4F6]" : "text-gray-300"
          }`}
        >
          {control.label}
        </span>
        {control.loading && <Loader2 size={13} className="shrink-0 animate-spin text-[#C97A4E]" />}
        <button
          type="button"
          aria-label="Toggle settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <ChevronRight size={14} className={`transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
        </button>
        <button
          type="button"
          aria-label="Layer settings"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-gray-500 transition-colors hover:text-gray-300"
        >
          <Settings2 size={14} />
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
    return <TrendingUp size={16} />;
  }
  return <Sparkles size={16} />;
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
  sunLightingEnabled = false,
  sunHour = 12,
  onToggle,
  onOpacity,
  onToggleDesign,
  onTerrainExaggeration,
  onSetBaseMap,
  onColorMapChange,
  onShadingChange,
  onContourIntervalChange,
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

  return (
    <div className="flex flex-col pb-2">
      {processing && layers.length === 0 && (
        <div className="mx-2 mb-2 mt-3 flex items-start gap-2 rounded-lg border border-[#2A2D35] bg-[#1E2028]/50 p-3">
          <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-[#C97A4E]" />
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
      {(ortho.length > 0 || terrain.length > 0 || lenses.length > 0 || designs.length > 0) && (
        <Section title="Map Layers" defaultOpen>
          {ortho.map((l) => (
            <ControlRow
              key={l.key}
              icon={<Layers size={16} />}
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
          {designs.map((d) => (
            <ControlRow
              key={d.key}
              icon={<MapIcon size={16} />}
              label={d.label}
              active={d.visible}
              disabled={!d.renderable}
              onToggle={() => onToggleDesign(d.key)}
            />
          ))}
        </Section>
      )}

      {/* ---------------------------------------------------- VIEW TYPES */}
      <Section title="View Types" defaultOpen>
        {terrain.length > 0 && (
          <GroupRow icon={<Layers size={16} />} label="Terrain" group={terrain} onToggle={onToggle} />
        )}
        {contourVectors.length > 0 && (
          <GroupRow icon={<Minus size={16} />} label="Contour Lines" group={contourVectors} onToggle={onToggle} />
        )}
        {siteModels.length > 0 && (
          <GroupRow icon={<Building2 size={16} />} label="3D Model" group={siteModels} onToggle={onToggle} />
        )}
        {pointClouds.length > 0 && (
          <GroupRow icon={<Circle size={16} />} label="Point Cloud" group={pointClouds} onToggle={onToggle} />
        )}
        <ControlRow
          icon={<Building2 size={16} />}
          label="Digital Twin"
          active={digitalTwinEnabled}
          disabled={!digitalTwinAvailable}
          onToggle={() => {
            if (!digitalTwinAvailable) {
              toast.info("Digital Twin requires a Cesium ion token (World Terrain)");
              return;
            }
            onToggleDigitalTwin?.();
          }}
        />
      </Section>

      {/* --------------------------------------------------- SURVEY DATA */}
      <Section title="Survey Data">
        <ControlRow
          icon={<Camera size={16} />}
          label="Images"
          count={imageCount ? `${imageCount.toLocaleString()} images` : undefined}
          active={imagesVisible}
          disabled={!hasImageLayer}
          onToggle={() => {
            if (!hasImageLayer) {
              toast.info("Image positions — not available for this survey");
              return;
            }
            onToggleImages?.();
          }}
        />
        <ControlRow
          icon={<Circle size={16} />}
          label="GCPs"
          count={gcpCount ? `${gcpCount} GCPs` : undefined}
          active={gcpsVisible}
          disabled={!hasGcpLayer}
          onToggle={() => {
            if (!hasGcpLayer) {
              toast.info("Ground control points — not available for this survey");
              return;
            }
            onToggleGcps?.();
          }}
        />
      </Section>

      {/* -------------------------------------------------- MAP CONTROLS */}
      <Section title="Map Controls">
        <div className="flex h-9 items-center gap-2.5 px-2">
          <MapIcon size={16} className="shrink-0 text-[#C97A4E]" />
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
          <Minus size={16} className="shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1 text-[13px] text-gray-300">Contour Interval</span>
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
