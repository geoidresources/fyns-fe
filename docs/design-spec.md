# GEOID TerraMine — Figma Design Specification

> Source: Figma file `BVO7GCirdxAA0LhpAxYkli` ("Untitled"), Page 1.
> Linked frame: **Map Viewer** (`node-id 1:1321`).
> This document describes the **whole design** in detail — the app shell, every
> screen in the prototype, and the full component breakdown of the Map Viewer
> experience (the primary surface implemented in `fyns-fe`).

---

## 1. Overview

The design is a **dark-themed geospatial digital-twin platform** for open-pit /
mine-site survey analytics. The hero surface is a **3D map viewer** that renders
a photogrammetry reality-mesh of a mine and lets users toggle survey layers,
overlay CAD designs, and draw/measure volumetric features (stockpiles, blasts,
benches, haul roads). Contextual inspectors on the right expose per-feature
analytics (volume, tonnage, cut/fill).

The visual language is **utilitarian dark UI** — near-black charcoal surfaces,
hairline white borders, a single warm terracotta/orange accent, compact 11–13px
Inter type, and tight 4px-grid spacing. It reads like a professional CAD/GIS
tool (think Cesium / Pix4D / Propeller) rather than a consumer app.

---

## 2. Design system / tokens

### Color palette

| Role | Hex / value | Usage |
|------|-------------|-------|
| Accent (primary) | `#c2703e` (≈ `#C97A4E` in code) | Active states, checked checkboxes, selected tab pill, primary CTAs, active tool |
| Panel background | `rgba(17,17,20,0.95)` (`#111114` @ 95%) | Side panel / sheet surfaces, blurred over the viewport |
| App background | `#0A0D14` (near-black navy) | App canvas behind the 3D viewport |
| Control surface | `#19191d` | Active tab pill, search input, inset metric cards |
| Hairline border | `rgba(255,255,255,0.08)` | Panel edges, dividers, input borders, checkbox outline |
| Text — primary | `#f4f4f5` | Layer/feature names, headings |
| Text — secondary | `#a1a1aa` | Measurement detail rows, secondary labels |
| Text — muted | `#71717a` | Section headings, counts, placeholders, inactive tabs |
| Status — success | green (`Approved` chip, completed) | Approval / completed states |
| Status — danger | red | `Delete`, failed states |

### Typography

- **Family:** Inter (Regular 400 / Medium 500).
- **Section headings:** 11px, uppercase, letter-spacing ≈ `0.44px`, color `#71717a`.
- **Body / item labels:** 12px, line-height 18px, color `#f4f4f5`.
- **Detail / sub-rows:** 11px, line-height ≈ 16.5px, color `#a1a1aa`.
- **Mono footnote** (inspector debug line): monospace, ~10px, muted.

### Geometry & spacing

- **Grid:** 4px base unit. Common paddings: 8px (rows), 12–16px (panel insets).
- **Radii:** `9999px` (tab pills), `4px` (rows, inputs, tool buttons), `3px`
  (checkbox squares), larger rounded cards for inspectors.
- **Row height:** 32px (layer/folder rows), 28px (sub-rows, search input).
- **Checkbox:** 16×16, 3px radius; checked = filled `#c2703e` with a 10px check
  glyph; unchecked = transparent with `rgba(255,255,255,0.08)` border.
- **Icons:** 12–14px inside the panels, line-style (Lucide-equivalent).

---

## 3. App shell / global layout

The full application screen (`Geo id - int`, 1564×894) is composed of, left → right:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Top nav bar: View:  [Landing][Sign Up][Login][Globe View]            │  ~43px
│              [Map Viewer•][Digital Twin][Reconcile Dashboard][Upload]  │
├──┬──┬───────────────┬───────────────────────────────────────┬──┬──────┤
│  │  │               │  floating draw toolbar (top center)    │  │      │
│IR│MT│  Map Viewer   │                                        │RR│Right │
│  │  │  panel        │        3D mine-site viewport           │  │ctx   │
│48│52│  (200px)      │        (mesh + measurement overlays)   │60│panel │
│px│px│  Layers/      │                                        │px│280px │
│  │  │  Designs/     │                                        │  │      │
│  │  │  Measure      │  bottom status bar (coords/scale/date) │  │      │
└──┴──┴───────────────┴───────────────────────────────────────┴──┴──────┘
```

- **Top nav bar** — a prototype screen-switcher: `View:` label + pill tabs for
  every screen (Landing Page, Sign Up, Login, Globe View, **Map Viewer** [active,
  orange], Digital Twin, Reconcile Dashboard, Upload).
- **IR — Left icon rail (48px):** primary app navigation, ~10 stacked 35×42
  icon buttons (home, projects, layers, measure, reports, settings, etc.) with a
  logo mark at top and account control at the bottom.
- **MT — Map-tools rail (52px):** a secondary vertical toolbar of map/scene
  controls (zoom, home, orbit, layers shortcuts).
- **Map Viewer panel (200px):** the Layers / Designs / Measurements panel
  (detailed in §5) — the same component as the linked `1:1321` frame.
- **Viewport (1264×698):** the 3D reality-mesh of the pit, with colored
  measurement overlays (red exclusion zone, green stockpile footprint), a
  floating draw toolbar at top center, and a bottom status bar.
- **RR — Right icon rail (60px):** view/inspector switches.
- **Right contextual panel (280px):** feature inspector (Stockpile detail) or
  the Measure tool palette, depending on mode.

---

## 4. Screens in the prototype

| Screen | Purpose |
|--------|---------|
| **Landing Page** | Marketing / hero entry. |
| **Sign Up** | Account creation. |
| **Login** | Authentication. |
| **Globe View** | A 360×710 globe panel — an Earth/globe browser to pick a project/site before drilling into a survey. |
| **Map Viewer** ★ | The core survey viewer (this spec's focus). |
| **Digital Twin** | Full-fidelity twin view (full-screen `Geo id - int` screens). |
| **Reconcile Dashboard** | Analytics/reconciliation dashboard. |
| **Upload** | Data/asset upload flow. |

The file also contains **Map Viewer width variants** (responsive / collapse
states): a **48px collapsed icon rail**, **200px**, **203px** (the linked frame),
and **280px** wide versions of the panel.

---

## 5. Map Viewer panel — detailed breakdown

The linked frame `1:1321` (203×894). Flat, full-height left sidebar:
`background rgba(17,17,20,0.95)`, right border `rgba(255,255,255,0.08)`,
padding `16px` vertical / `12px` horizontal, content column ~175px wide.

### 5.1 Tab switcher (top)

A segmented pill, 160px wide, two equal buttons:

- **`Surveys`** — inactive (text `#71717a`).
- **`Layers`** — active: pill `bg #19191d`, text `#f4f4f5`.

Pills are fully rounded (`9999px`), 32px tall.

### 5.2 Layers section

Header: **`SURVEY V3 · 18 MAY`** (11px uppercase, `#71717a`) — survey version +
capture date. Below it, a flat list of layer rows (32px each, 8px gap):

| Layer | Checkbox state |
|-------|----------------|
| `orthomosaic` | ✅ on (filled `#c2703e`) |
| `DSM hillshade` | ✅ on |
| `point cloud (48M pts)` | ☐ off (outlined) |
| `contours · 1m` | ✅ on |

Each row = a 16px checkbox + 12px label. The label can carry an inline detail
(point count, contour interval). Off layers keep the same label color; only the
checkbox differs.

### 5.3 Designs section

Header: **`DESIGNS`**. Rows mirror the layer rows (checkbox + label), for CAD
overlays:

- `pit phase 3 (DXF)` — ✅ on
- `haul road A (LandXML)` — ✅ on

The format (`DXF`, `LandXML`) is shown in parentheses after the name.

### 5.4 Measurements section

Header: **`MEASUREMENTS`**, then:

1. **Tool row** — 5 compact 12px icon buttons (4px padding each): the
   measurement/annotation tools (draw, capture, sort, filter, new-folder).
2. **Search field** — 28px tall, `bg #19191d`, hairline border, magnifier icon,
   placeholder `Search measurements...` (`rgba(244,244,245,0.5)`).
3. **Folder groups** — collapsible folders, each a 32px header row:
   `chevron + folder icon + name + (count)`. Sub-items are indented 24px,
   28px tall, rendered as single muted lines (`#a1a1aa`, 11px).

Folders shown (Figma order):

| Folder | Count | Sample rows |
|--------|-------|-------------|
| **Stockpiles** | (12) | `SP-01 · limestone · 14,820 m³`, `SP-02 · coal · 8,420 m³` |
| **Blasting** | — | `Blast area B7-E (post-blast)`, `Blast area B6-W (pre-blast)`, `Exclusion zone B7` |
| **Berm checks** | — | (collapsed) |
| **Bench monitoring** | (8) | (collapsed) |
| **Haul road analysis** | — | (collapsed) |
| **Field ops** | — | (collapsed) |
| **Hydro** | — | (collapsed) |

Stockpiles & Blasting are shown **expanded**; the rest **collapsed**. Sub-row
text reads as a single `id · material · value` line.

### 5.5 Footer

A full-width ghost button: **`+ Add layer`** (12px medium, `#a1a1aa`, hover
surface), pinned at the bottom.

---

## 6. Center viewport

- **Content:** a textured 3D reality-mesh of the open-pit mine (photogrammetry),
  free-orbit camera.
- **Measurement overlays:** translucent colored polygons drawn on the surface —
  e.g. a **green** stockpile footprint and a **red** exclusion/blast zone, with
  vertex handles and edge labels.
- **Floating draw toolbar** (top-center, pill, dark, blurred): an active-tool
  chip (`• Point`) followed by line / **polygon** (pentagon) / **section**
  (scissors) / circle / **slope** (trend-line) tools, a divider, then probe
  (sphere), triangle, **undo**, **grid/snap**, and **⋯ (more)**.
- **Bottom status bar:** cursor coordinates, scale, north indicator, and the
  active survey date.

---

## 7. Right contextual panels (280px)

### 7.1 Feature inspector — "Stockpile #SP-12"

Opens when a measured feature is selected.

- **Header:** `Stockpile #SP-12` + close (`×`).
- **Two text inputs** (rename / tag).
- **Tabs:** `PROPERTIES` (active) | `STYLE`.
- **Status chips:** `Approved` (green) · `Limestone` (gray).
- **Metrics card** (2×2, inset `#19191d`):
  - Volume `12,840 m³` · Tonnage `32,100 t`
  - Area `1,420 m²` · Perimeter `142 m`
- **Meta list:** `Material: Limestone`, `Density: 2.5 t/m³`,
  `Base method: Smart base`, `Calculated: 18 May 09:42`.
- **Action rows** (chevron rows): `Receipt ›`, `Run cut/fill ›`, `Add to report ›`.
- **Destructive:** `✕ Delete` (red).
- **Footnote (mono):** `receipt · surface=v3 · base=smart · density=2.5 · calc=PD09:42`.

### 7.2 Measure palette — "Measure"

Opens in measurement/draw mode.

- **Header:** `Measure` + close (`×`).
- **Tool grid (2×3 cards):** `Point`, `Line`, `Polygon`, `Section` (scissors),
  `Probe`, `Slope` — each a card with centered icon + label.
- **`Template`** input (preset selector).
- **`Live readout`** card: `Volume: — m³` / `Area: — m²` (updates while drawing).
- **`Volume method`** radio list: `Smart base`, `Reference RL`,
  `Previous survey`, `Design surface`, `Custom base`.

---

## 8. Globe View (companion screen)

A standalone 360×710 panel presenting an interactive globe to locate and select
a project/site, serving as the entry point before opening a survey in the Map
Viewer. Same dark theme and accent.

---

## 9. Interaction & state notes

- **Layer/design toggles:** checkbox on/off controls scene visibility; accent
  fill denotes a rendered layer.
- **Tab switch:** `Surveys` ↔ `Layers` swaps the panel body (survey browser vs.
  layer/measurement controls).
- **Folders:** click a folder header to expand/collapse; count reflects total
  child measurements.
- **Search:** filters measurement rows live.
- **Tools:** selecting a draw tool (panel tool row, floating toolbar, or Measure
  palette) enters draw mode; the Measure palette's `Live readout` updates as
  vertices are placed; finishing a shape opens the feature inspector.
- **Inspector actions:** `Run cut/fill`, `Add to report`, `Receipt`, plus
  approve (status chip) and delete.

---

## 10. Implementation status in `fyns-fe`

The **Map Viewer panel** (§5) is implemented and wired in the survey viewer:

| Design element | Component | Status |
|----------------|-----------|--------|
| Surveys/Layers tabs | `components/ui/tabs.tsx` + `SurveyViewer` | ✅ Built (shadcn/Radix) |
| Layer checkbox rows | `components/viewer/LayerPanel.tsx` + `ui/checkbox.tsx` | ✅ Wired to real manifest layers |
| Survey header (`SURVEY V… · DATE`) | `SurveyViewer` `surveyLabel` | ✅ Real (version + date) |
| Designs section | `LayerPanel` + `lib/viewer/sampleData.ts` | ⚙️ UI built; sample data (backend has none yet) |
| Measurements toolbar + search + folders | `components/viewer/MeasurementPanel.tsx` + `ui/collapsible.tsx` | ✅ UI built; folders from `Measurement.folder` |
| Grouped measurement fixtures | `lib/viewer/sampleData.ts` | ⚙️ Sample (Stockpiles/Blasting/…) until backend serves folders |
| `+ Add layer` footer | `SurveyViewer` | ⚙️ Placeholder (upload flow pending) |
| Surveys tab list | `components/viewer/SurveyList.tsx` | ✅ Wired to `listSurveys` |
| Primary nav rail (52px, §3) | `components/dashboard/Sidebar.tsx` | ✅ Built (dashboard shell) |
| Map-tools rail (48px, §3) | `components/viewer/ViewerToolRail.tsx` | ✅ Built; Select/Distance/Cross-section wired to draw, rest scaffolded |
| Right contextual panels (§7) | `MeasurePalette.tsx` + `FeatureInspector.tsx` | ⚙️ Built; analytics values still placeholder |
| Floating draw toolbar (§6) | `components/viewer/ViewerDrawToolbar.tsx` | ✅ Built; Point/Line/Polygon/Section/Area/Slope/Volume wired to draw, rest scaffolded |

**Both left rails are now present:** the primary nav rail (the dashboard
`Sidebar`) and the 48px map-tools rail (`ViewerToolRail`), matching the design's
two-rail left edge.

**Not yet implemented** (future work): the **right 60px icon rail**, the
**bottom status bar**, real analytics in the right inspector panels, and the
companion screens (Globe View, Digital Twin, Reconcile Dashboard, Upload).

> **Color reconciliation:** the implementation maps Figma's `#c2703e` accent and
> grays to the project's existing theme tokens (`#C97A4E`, `#12141A`, `#1E2028`,
> Tailwind grays) for consistency with the rest of `fyns-fe`.
