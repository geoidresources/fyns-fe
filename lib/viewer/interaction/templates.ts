// Template registry (plan §5): three primitive GROUPS × N templates. The toolbar
// renders from this table (primitive buttons + dropdowns); the machine stores the
// armed template; commit resolves kind with the template as the FIRST source,
// falling back to the panel calcType → mode default (checklist C8 unchanged —
// every P1 template carries defaultKind:null, exactly today's behavior).
//
// P1 ships parity templates only (the six retired TOOLS). Presets that pre-pick a
// calc kind (e.g. a "Stockpile" polygon template) come later — defaultKind is the
// seam, but the kind strings must be checked against lib/viewer/calc.ts first.

import type { Primitive } from "./types.ts";

export type TemplateId =
  | "point"
  | "line"
  | "polygon"
  | "section"
  | "probe"
  | "slope";

/** Toolbar grouping: which primitive button's dropdown a template lives under. */
export type TemplateGroup = "point" | "line" | "polygon";

export interface MeasureTemplate {
  id: TemplateId;
  label: string;
  group: TemplateGroup;
  /** null → probe template (elevation sample), routed to the legacy probe path. */
  primitive: Primitive | null;
  probe?: boolean;
  /** Seed calc kind at commit; null defers to panel calcType → mode default. */
  defaultKind: string | null;
  drawOpts?: { label?: string; slope?: boolean };
}

export const TEMPLATES: MeasureTemplate[] = [
  // Point group — both are probes (single-click samples), legacy-routed in P1.
  { id: "point", label: "Point", group: "point", primitive: null, probe: true, defaultKind: null },
  { id: "probe", label: "Probe", group: "point", primitive: null, probe: true, defaultKind: null },

  // Line group
  { id: "line", label: "Line", group: "line", primitive: "polyline", defaultKind: null, drawOpts: { label: "Line" } },
  { id: "section", label: "Section", group: "line", primitive: "polyline", defaultKind: null, drawOpts: { label: "Section" } },
  { id: "slope", label: "Slope", group: "line", primitive: "polyline", defaultKind: null, drawOpts: { label: "Slope", slope: true } },

  // Polygon group
  { id: "polygon", label: "Polygon", group: "polygon", primitive: "polygon", defaultKind: null, drawOpts: { label: "Polygon" } },
];

export const templateById = (id: TemplateId): MeasureTemplate | undefined =>
  TEMPLATES.find((t) => t.id === id);

export const templatesFor = (group: TemplateGroup): MeasureTemplate[] =>
  TEMPLATES.filter((t) => t.group === group);

/** Namespaced tool key — SAME scheme as the legacy toolbar ("palette:line"), so
 * the store mirror keeps every panel's lit/active logic working unchanged. */
export const toolKeyFor = (id: TemplateId): string => `palette:${id}`;
