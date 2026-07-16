"use client";

// Measurement polling (viewer-shell §2.3 hook `useMeasurementsPoll`,
// cut-line :523-534). MOVED VERBATIM: the debounced server-side search refetch
// (:523-534) and the 5s compute poll while any measurement is computing
// (:543-549). refreshMeasurements + the debounce/signature refs live in
// ViewerRuntime and are passed in; the spinner setter goes through the store.
// Bodies line-identical.
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, type RefObject } from "react";
import type { Measurement } from "@/lib/api/assetSvc";

export function useMeasurementsPoll(deps: {
  measurementSearch: string;
  measurements: Measurement[];
  refreshMeasurements: () => Promise<void>;
  setSearchingMeasurements: (v: boolean) => void;
  appliedSearchRef: RefObject<string>;
  searchRef: RefObject<string>;
  measurementsSigRef: RefObject<string>;
}) {
  const {
    measurementSearch,
    measurements,
    refreshMeasurements,
    setSearchingMeasurements,
    appliedSearchRef,
    searchRef,
    measurementsSigRef,
  } = deps;

  // Debounce the search box, then refetch server-side (asset-svc `?search=`).
  useEffect(() => {
    const q = measurementSearch.trim();
    const t = setTimeout(() => {
      if (appliedSearchRef.current === q) return;
      appliedSearchRef.current = q;
      searchRef.current = q;
      measurementsSigRef.current = "";
      setSearchingMeasurements(true);
      refreshMeasurements().finally(() => setSearchingMeasurements(false));
    }, 300);
    return () => clearTimeout(t);
  }, [measurementSearch, refreshMeasurements]);

  // Poll measurements every 5s while any compute is in flight.
  const anyComputing = measurements.some((m) => m.status === "computing");
  useEffect(() => {
    if (!anyComputing) return;
    const t = setInterval(refreshMeasurements, 5_000);
    return () => clearInterval(t);
  }, [anyComputing, refreshMeasurements]);
}
