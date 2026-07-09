import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a survey/measurement date for display. Survey dates arrive as
 * date-only strings (e.g. "2024-01-15"), which `new Date()` parses as UTC
 * midnight; rendering with the browser's local timezone then shifts the date
 * back a day for anyone west of UTC. Pin the formatter to UTC so the calendar
 * date shown always matches the stored one.
 */
export function formatSurveyDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
