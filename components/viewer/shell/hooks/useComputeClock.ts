"use client";

import { useEffect, useState } from "react";

/** Ticks a clock while `active`, so time-derived UI can change without any data
 * changing (ORB-39).
 *
 * This is load-bearing rather than cosmetic: `refreshMeasurements` skips the
 * store update when the poll signature (`id:status:updated_at`) is unchanged, so
 * a compute that died server-side produces an identical signature on every poll
 * forever — nothing re-renders, and a purely elapsed-time affordance would never
 * appear. The interval is the only thing that moves.
 *
 * Idle when `active` is false, so a viewer with nothing computing pays nothing. */
export function useComputeClock(active: boolean, intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}
