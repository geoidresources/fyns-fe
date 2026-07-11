"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProjects, createProject, type Project } from "@/lib/api/userSvc";
import {
  createSurvey,
  createDesign,
  generateSurvey,
  initUploads,
  listSurveys,
  markAssetUploaded,
  type Survey,
} from "@/lib/api/assetSvc";
import {
  ACCEPT,
  DROPZONE_HINT,
  ROLE_LABELS,
  SELECTABLE_ROLES,
  buildProcessorPlan,
  contentTypeFor,
  designFormat,
  guessRole,
  roleToAssetKind,
  type DataType,
  type FileRole,
  type PlannedSkip,
} from "@/lib/upload/planner";
import { putToSignedUrl } from "@/lib/upload/putToSignedUrl";

// ---------------------------------------------------------------- constants

const DATA_TYPES: { id: DataType; label: string }[] = [
  { id: "survey", label: "Survey" },
  { id: "lidar", label: "LiDAR" },
  { id: "preprocessed", label: "Pre-processed" },
  { id: "design", label: "Design" },
];

/** Curated horizontal CRS options (value is what processors receive). */
const CRS_OPTIONS = [
  { value: "EPSG:4326", label: "WGS84 (EPSG:4326)" },
  { value: "EPSG:32643", label: "WGS84 / UTM Zone 43N" },
  { value: "EPSG:32644", label: "WGS84 / UTM Zone 44N" },
  { value: "EPSG:32645", label: "WGS84 / UTM Zone 45N" },
  { value: "EPSG:32754", label: "WGS84 / UTM Zone 54S" },
  { value: "EPSG:32755", label: "WGS84 / UTM Zone 55S" },
  { value: "EPSG:32756", label: "WGS84 / UTM Zone 56S" },
  { value: "EPSG:28355", label: "GDA94 / MGA Zone 55" },
  { value: "EPSG:7855", label: "GDA2020 / MGA Zone 55" },
];

const VDATUM_OPTIONS = [
  { value: "EGM2008", label: "EGM2008" },
  { value: "EGM96", label: "EGM96" },
  { value: "ellipsoidal", label: "Ellipsoidal (WGS84)" },
  { value: "AHD", label: "AHD" },
];

const TAG_SUGGESTIONS = ["pit", "survey", "lidar", "design"];

const DRAFT_KEY = "geoid-upload-draft";

// ------------------------------------------------------------------- types

interface QueuedFile {
  file: File;
  role: FileRole;
  /** 0..1 while uploading. */
  progress: number;
  status: "queued" | "uploading" | "uploaded" | "error";
}

interface RunResult {
  surveyId: string | null;
  workflows: { label: string; id: string }[];
  designs: string[];
  skips: PlannedSkip[];
}

type Phase = "form" | "working" | "done";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateHuman(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

// -------------------------------------------------------------------- page

export default function UploadPage() {
  const router = useRouter();

  // Destination
  const [destination, setDestination] = useState<"existing" | "new">("existing");
  const [projects, setProjects] = useState<Project[]>([]);
  const [siteId, setSiteId] = useState("");
  const [newSiteName, setNewSiteName] = useState("");

  // Data
  const [dataType, setDataType] = useState<DataType>("survey");
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [datasetName, setDatasetName] = useState("");
  // Whether the user has typed their own dataset name (stops the autofill).
  // State, not a ref — it is read during render to derive the shown name.
  const [datasetEdited, setDatasetEdited] = useState(false);
  const [surveyDate, setSurveyDate] = useState(todayISO());
  const [epsg, setEpsg] = useState("EPSG:4326");
  const [vdatum, setVdatum] = useState("EGM2008");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Run state
  const [phase, setPhase] = useState<Phase>("form");
  const [stepText, setStepText] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------ bootstrap

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => console.error("Failed to fetch projects:", err));
  }, []);

  // ?site=<id> preselects a site; ?new=1 opens the New-site path. Read from
  // window.location (not useSearchParams) so the page needs no Suspense
  // boundary for static prerender. URL + localStorage are external systems
  // only readable client-side, and seeding them via useState initializers
  // would mismatch the server-rendered HTML — a mount effect is the correct
  // place. React batches these mount setStates into a single re-render, so the
  // sync-setState lint is intentionally waived for this one effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const site = params.get("site");
    if (site) {
      setDestination("existing");
      setSiteId(site);
    } else if (params.get("new")) {
      setDestination("new");
    }

    // Restore the last draft (form fields only — File handles can't persist).
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Record<string, unknown>;
        if (!site && typeof d.siteId === "string") setSiteId(d.siteId);
        if (!site && d.destination === "new") setDestination("new");
        if (typeof d.newSiteName === "string") setNewSiteName(d.newSiteName);
        if (typeof d.dataType === "string" && DATA_TYPES.some((t) => t.id === d.dataType)) {
          setDataType(d.dataType as DataType);
        }
        if (typeof d.datasetName === "string" && d.datasetName) {
          setDatasetName(d.datasetName);
          setDatasetEdited(true);
        }
        if (typeof d.epsg === "string") setEpsg(d.epsg);
        if (typeof d.vdatum === "string") setVdatum(d.vdatum);
        if (Array.isArray(d.tags)) setTags(d.tags.filter((t): t is string => typeof t === "string"));
        setDraftSaved(true);
      }
    } catch {
      // corrupted draft — ignore
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist the draft as the user edits (debounced). Only a user-edited
  // dataset name is saved — the autofilled one re-derives on restore.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            destination,
            siteId,
            newSiteName,
            dataType,
            datasetName: datasetEdited ? datasetName : "",
            epsg,
            vdatum,
            tags,
          })
        );
        setDraftSaved(true);
      } catch {
        // storage full/blocked — the dot just stays off
      }
    }, 600);
    return () => clearTimeout(t);
  }, [destination, siteId, newSiteName, dataType, datasetName, datasetEdited, epsg, vdatum, tags]);

  // Dataset name derives as "<site> — <date>" until the user edits it — a
  // render-time derivation (no effect), so it always tracks the current site
  // and date without cascading renders.
  const selectedProject = useMemo(() => projects.find((p) => p.id === siteId), [projects, siteId]);
  const siteNameForAutofill = destination === "new" ? newSiteName.trim() : selectedProject?.name;
  const effectiveDatasetName = datasetEdited
    ? datasetName
    : siteNameForAutofill
      ? `${siteNameForAutofill} — ${formatDateHuman(surveyDate)}`
      : "";

  // ------------------------------------------------------------ file queue

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      setFiles((prev) => {
        const next = [...prev];
        for (const f of Array.from(list)) {
          if (next.some((q) => q.file.name === f.name)) continue; // dedupe by name
          next.push({ file: f, role: guessRole(f.name, dataType), progress: 0, status: "queued" });
        }
        return next;
      });
    },
    [dataType]
  );

  const changeDataType = (t: DataType) => {
    setDataType(t);
    // Roles are type-specific; re-guess rather than carrying stale roles over.
    setFiles((prev) => prev.map((q) => ({ ...q, role: guessRole(q.file.name, t) })));
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((q) => q.file.name !== name));

  const setRole = (name: string, role: FileRole) =>
    setFiles((prev) => prev.map((q) => (q.file.name === name ? { ...q, role } : q)));

  // ------------------------------------------------------------------ tags

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,+$/, "");
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput("");
  };

  // ---------------------------------------------------------------- submit

  const canSubmit =
    phase === "form" &&
    files.length > 0 &&
    effectiveDatasetName.trim().length > 0 &&
    (destination === "existing" ? !!siteId : newSiteName.trim().length >= 2);

  const run = async () => {
    setPhase("working");
    try {
      // 1) Resolve the destination project.
      let project = selectedProject ?? null;
      if (destination === "new") {
        setStepText("Creating site…");
        project = await createProject({
          name: newSiteName.trim(),
          crs_epsg: Number(epsg.replace("EPSG:", "")) || undefined,
          crs_label: CRS_OPTIONS.find((o) => o.value === epsg)?.label,
          vertical_datum: vdatum,
        });
      }
      if (!project) throw new Error("Select a site first");

      // 2) Resolve the survey that hosts the upload. Data uploads are a new
      //    epoch (new survey); designs attach to the latest existing survey's
      //    storage folder, creating one only when the project has none.
      let survey: Survey;
      if (dataType === "design") {
        setStepText("Resolving survey…");
        const { surveys } = await listSurveys(project.id);
        const latest = [...(surveys || [])].sort((a, b) => b.survey_date.localeCompare(a.survey_date))[0];
        survey =
          latest ??
          (await createSurvey({
            project_id: project.id,
            survey_date: surveyDate,
            survey_type: "design",
            metadata: { dataset_name: effectiveDatasetName.trim(), tags, source: "platform-upload" },
          }));
      } else {
        setStepText("Creating survey…");
        survey = await createSurvey({
          project_id: project.id,
          survey_date: surveyDate,
          survey_type: dataType === "lidar" ? "lidar" : dataType === "preprocessed" ? "preprocessed" : "aerial",
          metadata: {
            dataset_name: effectiveDatasetName.trim(),
            tags,
            source: "platform-upload",
            source_crs: epsg,
            source_vertical_datum: vdatum,
          },
        });
      }

      // 3) Signed upload slots.
      setStepText("Requesting upload URLs…");
      const { uploads } = await initUploads(
        survey.id,
        files.map((q) => ({
          filename: q.file.name,
          kind: roleToAssetKind(q.role),
          role: q.role,
          content_type: contentTypeFor(q.file.name),
          crs: epsg,
        }))
      );
      const uploadByName = new Map(uploads.map((u) => [u.asset.filename || "", u]));

      // 4) PUT each file, then mark it uploaded. Sequential keeps memory and
      //    connection pressure sane for multi-GB rasters.
      const uploadedUrls = new Map<string, string>();
      for (const q of files) {
        const slot = uploadByName.get(q.file.name);
        if (!slot) throw new Error(`No upload slot returned for ${q.file.name}`);
        setStepText(`Uploading ${q.file.name}…`);
        setFiles((prev) => prev.map((p) => (p.file.name === q.file.name ? { ...p, status: "uploading" } : p)));
        try {
          await putToSignedUrl(slot.upload_url, q.file, contentTypeFor(q.file.name), (frac) => {
            setFiles((prev) => prev.map((p) => (p.file.name === q.file.name ? { ...p, progress: frac } : p)));
          });
        } catch (err) {
          setFiles((prev) => prev.map((p) => (p.file.name === q.file.name ? { ...p, status: "error" } : p)));
          throw err;
        }
        await markAssetUploaded(survey.id, slot.asset.id);
        uploadedUrls.set(q.file.name, slot.asset.url);
        setFiles((prev) =>
          prev.map((p) => (p.file.name === q.file.name ? { ...p, status: "uploaded", progress: 1 } : p))
        );
      }

      // 5) Dispatch processing / register designs.
      const outcome: RunResult = { surveyId: survey.id, workflows: [], designs: [], skips: [] };
      if (dataType === "design") {
        for (const q of files) {
          setStepText(`Registering design ${q.file.name}…`);
          const d = await createDesign({
            project_id: project.id,
            name: files.length === 1 ? effectiveDatasetName.trim() : q.file.name,
            format: designFormat(q.file.name),
            file_url: uploadedUrls.get(q.file.name) || "",
            source_crs: epsg,
            metadata: { tags, source: "platform-upload" },
          });
          outcome.designs.push(d.name);
        }
      } else {
        const plan = buildProcessorPlan(
          files.map((q) => ({ name: q.file.name, role: q.role, url: uploadedUrls.get(q.file.name) || "" })),
          { epsg, workingCrs: survey.working_crs }
        );
        outcome.skips = plan.skips;
        for (const d of plan.dispatches) {
          setStepText(`Dispatching ${d.label}…`);
          const res = await generateSurvey(survey.id, { ...d.request, version: "v1" });
          outcome.workflows.push({ label: d.label, id: res.workflow_id });
        }
      }

      localStorage.removeItem(DRAFT_KEY);
      setResult(outcome);
      setPhase("done");
      toast.success(
        dataType === "design"
          ? `${outcome.designs.length} design${outcome.designs.length === 1 ? "" : "s"} registered`
          : `Upload complete — ${outcome.workflows.length} processing workflow${outcome.workflows.length === 1 ? "" : "s"} dispatched`
      );
    } catch (err) {
      console.error("Upload & process failed:", err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
      setPhase("form");
      setStepText("");
    }
  };

  // -------------------------------------------------------------------- UI

  const sectionLabel = "text-sm font-medium text-gray-400 mb-2 block";
  const boxClass = "bg-[#0F1116] border border-[#1E2028] rounded-xl";

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 pb-24">
        <h1 className="text-4xl font-bold text-gray-100 mb-2">Upload</h1>
        <p className="text-gray-500 mb-8">Add survey data or designs to your site</p>

        {phase === "done" && result ? (
          <DoneSummary
            result={result}
            dataType={dataType}
            onOpenViewer={() => result.surveyId && router.push(`/viewer/${result.surveyId}`)}
            onAgain={() => {
              setFiles([]);
              setResult(null);
              setPhase("form");
              setStepText("");
            }}
            onDashboard={() => router.push("/globe")}
          />
        ) : (
          <>
            {/* Destination */}
            <label className={sectionLabel}>Destination</label>
            <div className={`grid grid-cols-2 p-1 gap-1 mb-3 ${boxClass}`}>
              {(
                [
                  { id: "existing", label: "Existing site" },
                  { id: "new", label: "New site" },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={phase === "working"}
                  onClick={() => setDestination(d.id)}
                  className={`h-11 rounded-lg text-sm font-medium transition-colors ${
                    destination === d.id
                      ? "bg-[#16181D] border border-[#2A2D35] text-gray-100"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {destination === "existing" ? (
              <Select value={siteId} onValueChange={setSiteId} disabled={phase === "working"}>
                <SelectTrigger className={`w-full mb-8 px-4 text-gray-200 ${boxClass}`} style={{ height: "3.25rem" }}>
                  <SelectValue placeholder="Select a site…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                disabled={phase === "working"}
                placeholder="New site name, e.g. Bandalkop pit"
                className={`h-13 mb-8 px-4 ${boxClass}`}
              />
            )}

            {/* Data type */}
            <label className={sectionLabel}>Data type</label>
            <div className={`grid grid-cols-4 p-1 gap-1 mb-6 ${boxClass}`}>
              {DATA_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={phase === "working"}
                  onClick={() => changeDataType(t.id)}
                  className={`h-11 rounded-lg text-sm font-medium transition-colors ${
                    dataType === t.id
                      ? "bg-[#16181D] border border-[#2A2D35] text-gray-100"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (phase === "form") addFiles(e.dataTransfer.files);
              }}
              onClick={() => phase === "form" && fileInputRef.current?.click()}
              className={`mb-6 flex h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed transition-colors ${
                dragOver ? "border-[#C97A4E] bg-[#C97A4E]/5" : "border-[#2A2D35] bg-[#0F1116]/60 hover:border-[#3A3D45]"
              }`}
            >
              <CloudUpload size={28} className="text-gray-500" />
              <p className="text-gray-200 font-medium">Drag &amp; drop files here</p>
              <p className="text-sm text-gray-500">{DROPZONE_HINT[dataType]}</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT[dataType]}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {/* File queue */}
            {files.length > 0 && (
              <div className="mb-8 flex flex-col gap-2">
                {files.map((q) => (
                  <div key={q.file.name} className={`px-4 py-3 ${boxClass}`}>
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="shrink-0 text-gray-500" />
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{q.file.name}</span>
                      <span className="shrink-0 text-xs text-gray-500">{formatBytes(q.file.size)}</span>
                      <Select
                        value={q.role}
                        onValueChange={(v) => setRole(q.file.name, v as FileRole)}
                        disabled={phase === "working" || SELECTABLE_ROLES[dataType].length < 2}
                      >
                        <SelectTrigger className="h-7 w-32 shrink-0 rounded-md border-[#2A2D35] bg-[#16181D] px-2 text-xs text-gray-300">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SELECTABLE_ROLES[dataType].map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {phase === "form" ? (
                        <button
                          type="button"
                          onClick={() => removeFile(q.file.name)}
                          className="shrink-0 text-gray-500 transition-colors hover:text-red-400"
                          aria-label={`Remove ${q.file.name}`}
                        >
                          <X size={15} />
                        </button>
                      ) : q.status === "uploading" ? (
                        <Loader2 size={14} className="shrink-0 animate-spin text-[#C97A4E]" />
                      ) : q.status === "uploaded" ? (
                        <span className="shrink-0 text-xs text-green-400">done</span>
                      ) : q.status === "error" ? (
                        <span className="shrink-0 text-xs text-red-400">failed</span>
                      ) : null}
                    </div>
                    {(q.status === "uploading" || q.status === "uploaded") && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1E2028]">
                        <div
                          className="h-full rounded-full bg-[#C97A4E] transition-[width] duration-200"
                          style={{ width: `${Math.round(q.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Dataset name + survey date */}
            <div className="mb-6 grid grid-cols-[1fr_170px] gap-3">
              <div>
                <label className={sectionLabel}>Dataset name</label>
                <Input
                  value={effectiveDatasetName}
                  onChange={(e) => {
                    setDatasetEdited(true);
                    setDatasetName(e.target.value);
                  }}
                  disabled={phase === "working"}
                  placeholder="Site — date"
                  className={`h-13 px-4 ${boxClass}`}
                />
              </div>
              <div>
                <label className={sectionLabel}>Survey date</label>
                <Input
                  type="date"
                  value={surveyDate}
                  onChange={(e) => setSurveyDate(e.target.value)}
                  disabled={phase === "working"}
                  className={`h-13 px-4 ${boxClass}`}
                />
              </div>
            </div>

            {/* CRS */}
            <label className={sectionLabel}>Coordinate reference system</label>
            <div className="mb-6 grid grid-cols-2 gap-3">
              <Select value={epsg} onValueChange={setEpsg} disabled={phase === "working"}>
                <SelectTrigger className={`w-full px-4 text-gray-200 ${boxClass}`} style={{ height: "3.25rem" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={vdatum} onValueChange={setVdatum} disabled={phase === "working"}>
                <SelectTrigger className={`w-full px-4 text-gray-200 ${boxClass}`} style={{ height: "3.25rem" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VDATUM_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <label className={sectionLabel}>Tags</label>
            <div className={`mb-2 flex min-h-13 flex-wrap items-center gap-2 px-3 py-2.5 ${boxClass}`}>
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E2028] px-2.5 py-1 text-xs text-gray-300"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    className="text-gray-500 hover:text-gray-300"
                    aria-label={`Remove tag ${t}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  } else if (e.key === "Backspace" && !tagInput && tags.length) {
                    setTags((prev) => prev.slice(0, -1));
                  }
                }}
                disabled={phase === "working"}
                placeholder={tags.length === 0 ? "Add tags…" : ""}
                className="h-6 min-w-24 flex-1 bg-transparent text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none"
              />
            </div>
            <div className="mb-10 flex gap-2">
              {TAG_SUGGESTIONS.filter((s) => !tags.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={phase === "working"}
                  onClick={() => addTag(s)}
                  className="rounded-full border border-[#2A2D35] px-3 py-1 text-xs text-gray-400 transition-colors hover:border-[#3A3D45] hover:text-gray-200"
                >
                  + {s}
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-gray-500">
                {phase === "working" ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-[#C97A4E]" />
                    {stepText}
                  </>
                ) : draftSaved ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                    Saved as draft
                  </>
                ) : null}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={phase === "working"}
                  onClick={() => router.push("/globe")}
                  className="h-12 rounded-xl bg-[#16181D] border border-[#1E2028] px-6 text-sm font-medium text-gray-300 transition-colors hover:bg-[#1E2028] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={run}
                  className="h-12 rounded-xl bg-[#C97A4E] px-6 text-sm font-semibold text-[#0A0D14] transition-colors hover:bg-[#b06941] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === "working" ? "Working…" : "Upload & process"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ done summary

function DoneSummary({
  result,
  dataType,
  onOpenViewer,
  onAgain,
  onDashboard,
}: {
  result: RunResult;
  dataType: DataType;
  onOpenViewer: () => void;
  onAgain: () => void;
  onDashboard: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#1E2028] bg-[#0F1116] p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-100">
        {dataType === "design" ? "Designs registered" : "Upload complete — processing dispatched"}
      </h2>
      <p className="mb-5 text-sm text-gray-500">
        {dataType === "design"
          ? "The design files are stored and attached to the project."
          : "Processors are running; layers appear in the viewer as each one completes."}
      </p>

      {result.workflows.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5">
          {result.workflows.map((w) => (
            <div key={w.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-gray-300">{w.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-gray-500">{w.id.slice(0, 8)}…</span>
            </div>
          ))}
        </div>
      )}

      {result.designs.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5">
          {result.designs.map((d) => (
            <div key={d} className="text-sm text-gray-300">
              {d}
            </div>
          ))}
        </div>
      )}

      {result.skips.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
          {result.skips.map((s) => (
            <p key={s.filename} className="text-xs text-yellow-400/90">
              {s.filename}: {s.reason}
            </p>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-3">
        {result.surveyId && dataType !== "design" && (
          <button
            type="button"
            onClick={onOpenViewer}
            className="h-11 rounded-xl bg-[#C97A4E] px-5 text-sm font-semibold text-[#0A0D14] transition-colors hover:bg-[#b06941]"
          >
            Open in viewer
          </button>
        )}
        <button
          type="button"
          onClick={onAgain}
          className="h-11 rounded-xl border border-[#1E2028] bg-[#16181D] px-5 text-sm font-medium text-gray-300 transition-colors hover:bg-[#1E2028]"
        >
          Upload more
        </button>
        <button
          type="button"
          onClick={onDashboard}
          className="h-11 px-4 text-sm font-medium text-gray-400 transition-colors hover:text-gray-200"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
