"use client";

// Manifest + project load (viewer-shell §2.3 hook `useManifestLoad`). MOVED
// VERBATIM from SurveyViewer: the initial manifest+measurements load (:494-499),
// the project fetch keyed on survey.project_id (:501-516), and the 30s manifest
// poll while processors run (:537-541). loadManifest/refreshMeasurements stay in
// ViewerRuntime as callbacks and are passed in; state writes go through the
// store setters in `deps`. Bodies line-identical (incl. the original
// set-state-in-effect disable).
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect } from "react";
import { getProject, type Project } from "@/lib/api/userSvc";
import type { Manifest } from "@/lib/api/assetSvc";

export function useManifestLoad(deps: {
  manifest: Manifest | null;
  layersEmpty: boolean;
  loadManifest: () => Promise<void>;
  refreshMeasurements: () => Promise<void>;
  setProject: (p: Project | null) => void;
}) {
  const { manifest, layersEmpty, loadManifest, refreshMeasurements, setProject } = deps;

  useEffect(() => {
    // Async loads — state updates land after the fetch resolves, not in-render.
    loadManifest();
    refreshMeasurements();
  }, [loadManifest, refreshMeasurements]);

  useEffect(() => {
    const projectId = manifest?.survey.project_id;
    if (!projectId) return;

    let cancelled = false;
    getProject(projectId)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((err) => {
        console.error("Failed to fetch project:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest?.survey.project_id]);

  // Poll the manifest every 30s while processors are still running.
  useEffect(() => {
    if (!layersEmpty) return;
    const t = setInterval(loadManifest, 30_000);
    return () => clearInterval(t);
  }, [layersEmpty, loadManifest]);
}
