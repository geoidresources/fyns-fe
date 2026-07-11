"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Box,
  Download,
  FileArchive,
  FileImage,
  FileText,
  Link as LinkIcon,
  Loader2,
  Map as MapIcon,
  Mountain,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { listProjects, type Project } from "@/lib/api/userSvc";
import {
  listDesigns,
  listSurveyAssets,
  listSurveys,
  type DesignRecord,
  type SourceAsset,
  type Survey,
} from "@/lib/api/assetSvc";
import { formatSurveyDate } from "@/lib/utils";

// Files — every user-uploaded source object, grouped by site → survey, plus
// each site's registered designs. Downloads go through the same-origin /gcs
// proxy (next.config.ts rewrite): same-origin is what lets the browser honour
// the `download` attribute instead of navigating, and it needs no bucket CORS.

// ---------------------------------------------------------------- helpers

const GCS_HTTP = "https://storage.googleapis.com/";
const GCS_SCHEME = "gs://";

/** Same-origin download href for a stored object URL (gs:// or https). Null
 * for URLs outside the GCS bucket (nothing else is expected here). */
function downloadHref(url?: string): string | null {
  if (!url) return null;
  if (url.startsWith(GCS_HTTP)) return "/gcs/" + url.slice(GCS_HTTP.length);
  if (url.startsWith(GCS_SCHEME)) return "/gcs/" + url.slice(GCS_SCHEME.length);
  return null;
}

/** Canonical shareable https URL (what backend processors consume). */
function canonicalUrl(url?: string): string | null {
  if (!url) return null;
  if (url.startsWith(GCS_SCHEME)) return GCS_HTTP + url.slice(GCS_SCHEME.length);
  return url;
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Rendered element (not a component reference) so JSX call sites don't create
 * a component during render. */
function fileIcon(filename: string): React.ReactNode {
  const props = { size: 16, className: "shrink-0 text-gray-500" };
  switch (ext(filename)) {
    case "jpg":
    case "jpeg":
    case "png":
      return <FileImage {...props} />;
    case "tif":
    case "tiff":
      return <Mountain {...props} />;
    case "las":
    case "laz":
      return <Box {...props} />;
    case "dxf":
    case "shp":
    case "geojson":
    case "json":
    case "xml":
      return <MapIcon {...props} />;
    case "zip":
      return <FileArchive {...props} />;
    default:
      return <FileText {...props} />;
  }
}

function formatBytes(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("File URL copied");
  } catch {
    toast.error("Could not copy URL");
  }
}

// ------------------------------------------------------------------ types

interface SurveyGroup {
  survey: Survey;
  assets: SourceAsset[];
}

interface SiteGroup {
  project: Project;
  surveys: SurveyGroup[];
  designs: DesignRecord[];
}

// ------------------------------------------------------------------- page

export default function FilesPage() {
  const [sites, setSites] = useState<SiteGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [query, setQuery] = useState("");

  // Initial state is already null/loading; the refresh button resets it in its
  // click handler before bumping refreshTick, so the effect only fetches.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const projects = await listProjects();
      // Fan out per project: surveys (then assets per survey) + designs.
      // Individual failures degrade to empty lists rather than killing the page.
      const groups = await Promise.all(
        projects.map(async (project): Promise<SiteGroup> => {
          const [surveyGroups, designs] = await Promise.all([
            listSurveys(project.id)
              .then(async ({ surveys }) => {
                const sorted = [...(surveys || [])].sort((a, b) =>
                  b.survey_date.localeCompare(a.survey_date)
                );
                return Promise.all(
                  sorted.map(async (survey): Promise<SurveyGroup> => {
                    const { assets } = await listSurveyAssets(survey.id).catch(() => ({
                      assets: [] as SourceAsset[],
                    }));
                    return { survey, assets: assets || [] };
                  })
                );
              })
              .catch(() => [] as SurveyGroup[]),
            listDesigns(project.id)
              .then((r) => r.designs || [])
              .catch(() => [] as DesignRecord[]),
          ]);
          return { project, surveys: surveyGroups, designs };
        })
      );
      if (!cancelled) setSites(groups);
    })().catch((err) => {
      console.error("Failed to load files:", err);
      if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load files");
    });

    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // Filename filter (also matches design names); groups with no matches hide.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!sites) return null;
    return sites
      .map((s) => ({
        ...s,
        surveys: s.surveys
          .map((sg) => ({
            ...sg,
            assets: q
              ? sg.assets.filter((a) => (a.filename || a.url).toLowerCase().includes(q))
              : sg.assets,
          }))
          .filter((sg) => sg.assets.length > 0),
        designs: q ? s.designs.filter((d) => d.name.toLowerCase().includes(q)) : s.designs,
      }))
      .filter((s) => s.surveys.length > 0 || s.designs.length > 0);
  }, [sites, q]);

  const totals = useMemo(() => {
    if (!visible) return { files: 0, designs: 0 };
    let files = 0;
    let designs = 0;
    for (const s of visible) {
      designs += s.designs.length;
      for (const sg of s.surveys) files += sg.assets.length;
    }
    return { files, designs };
  }, [visible]);

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 pb-24">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-100 mb-2">Files</h1>
            <p className="text-gray-500">
              {sites === null && !loadError
                ? "Loading uploaded source data…"
                : `${totals.files} uploaded file${totals.files === 1 ? "" : "s"}${
                    totals.designs ? ` · ${totals.designs} design${totals.designs === 1 ? "" : "s"}` : ""
                  } across your sites`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSites(null);
              setLoadError(null);
              setRefreshTick((t) => t + 1);
            }}
            title="Refresh"
            className="mt-2 flex h-9 w-9 items-center justify-center rounded-lg border border-[#1E2028] bg-[#0F1116] text-gray-400 transition-colors hover:text-gray-200"
          >
            <RefreshCw size={15} className={sites === null && !loadError ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files by name…"
            className="h-12 w-full rounded-xl border border-[#1E2028] bg-[#0F1116] pl-11 pr-4 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#C97A4E] transition-colors"
          />
        </div>

        {loadError ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
            <p className="text-sm text-red-400">{loadError}</p>
          </div>
        ) : visible === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 size={15} className="animate-spin" /> Loading files…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState searching={!!q} />
        ) : (
          <div className="flex flex-col gap-8">
            {visible.map((site) => (
              <SiteSection key={site.project.id} site={site} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sections

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A2D35] bg-[#0F1116]/60 py-16">
      <FileText size={26} className="text-gray-600" />
      <p className="text-gray-300 font-medium">{searching ? "No files match your search" : "No uploads yet"}</p>
      {!searching && (
        <Link
          href="/upload"
          className="mt-1 flex items-center gap-2 rounded-xl bg-[#C97A4E] px-5 py-2.5 text-sm font-semibold text-[#0A0D14] transition-colors hover:bg-[#b06941]"
        >
          <Upload size={15} />
          Upload data
        </Link>
      )}
    </div>
  );
}

function SiteSection({ site }: { site: SiteGroup }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-gray-100">{site.project.name}</h2>
      <div className="flex flex-col gap-4">
        {site.surveys.map((sg) => (
          <div key={sg.survey.id}>
            <div className="mb-1.5 flex items-baseline gap-2 px-1">
              <span className="text-[13px] font-medium text-gray-400">
                {formatSurveyDate(sg.survey.survey_date)}
              </span>
              <span className="text-[11px] text-gray-600">
                {sg.survey.survey_type || "survey"} · {sg.assets.length} file{sg.assets.length === 1 ? "" : "s"}
              </span>
              <Link
                href={`/viewer/${sg.survey.id}`}
                className="ml-auto text-[11px] text-[#C97A4E] transition-colors hover:text-[#e08959]"
              >
                Open in viewer
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#1E2028] bg-[#0F1116]">
              {sg.assets.map((a, i) => (
                <FileRow
                  key={a.id}
                  name={a.filename || a.url.split("/").pop() || a.id}
                  chip={a.role || a.kind}
                  pending={a.status === "pending_upload"}
                  sizeBytes={a.size_bytes}
                  crs={a.crs}
                  url={a.url}
                  last={i === sg.assets.length - 1}
                />
              ))}
            </div>
          </div>
        ))}

        {site.designs.length > 0 && (
          <div>
            <div className="mb-1.5 px-1 text-[13px] font-medium text-gray-400">
              Designs{" "}
              <span className="text-[11px] font-normal text-gray-600">
                · {site.designs.length} file{site.designs.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#1E2028] bg-[#0F1116]">
              {site.designs.map((d, i) => (
                <FileRow
                  key={d.id}
                  name={d.name}
                  chip={d.format}
                  pending={false}
                  crs={d.source_crs}
                  url={d.file_url}
                  last={i === site.designs.length - 1}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FileRow({
  name,
  chip,
  pending,
  sizeBytes,
  crs,
  url,
  last,
}: {
  name: string;
  chip?: string;
  pending: boolean;
  sizeBytes?: number;
  crs?: string;
  url?: string;
  last: boolean;
}) {
  const href = downloadHref(url);
  const share = canonicalUrl(url);
  const size = formatBytes(sizeBytes);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] ${
        last ? "" : "border-b border-[#1E2028]"
      }`}
    >
      {fileIcon(name)}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-200">{name}</p>
        <p className="truncate text-[11px] text-gray-600">
          {[size, crs].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      {chip && (
        <span className="shrink-0 rounded-md bg-[#1E2028] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 border border-[#2A2D35]">
          {chip.replace(/_/g, " ")}
        </span>
      )}
      {pending ? (
        <span className="shrink-0 rounded-md bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-yellow-400 border border-yellow-500/20">
          pending
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {share && (
            <button
              type="button"
              onClick={() => copyUrl(share)}
              title="Copy file URL"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200"
            >
              <LinkIcon size={14} />
            </button>
          )}
          {href ? (
            <a
              href={href}
              download={name}
              title={`Download ${name}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/5 hover:text-[#C97A4E]"
            >
              <Download size={15} />
            </a>
          ) : (
            <span
              title="No downloadable object for this entry"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-700"
            >
              <Download size={15} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
