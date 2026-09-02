# Cross-section PDF sheet — design

**Date:** 2026-09-02 · **Owner rulings:** this session (see "Rulings" at the end) ·
**Replaces:** the A4-portrait matplotlib section PDF (debt #52 slice 1).

## Goal

The PDF of a cross-section must be a faithful print of what the engineer sees on
the Sections stage: the litho or geotech partition fill, the investigation logs,
the boundaries exactly where the screen draws them. It is laid out as an A3-high
landscape drawing sheet in the DOV "lengteprofiel" spirit, with a location map, a
four-field title block, and the printed scales. The engineer previews the sheet
live, plays with the app's own exaggeration and spacing sliders, and exports.

The current exporter cannot be made faithful: it redraws contacts as straight
chords per formation, in depth-below-surface (the screen draws absolute level), and
never draws a fill. It is replaced, not tuned.

## Scope

In:

* One section per sheet. Litho fill or geotech fill (the on-screen partition),
  never the 3-D model fill.
* Live preview dialog with controls; export to PDF through Chromium's printer.
* Location map with the app's basemap, A – A′, coloured investigations, short
  codes, project legend, scale bar, north arrow.
* Four free-text fields with editable labels, persisted per section.
* EN and NL through the existing language catalogues.
* Deletion of the backend section PDF route + exporter + tests and of the
  ReportLab / matplotlib dependencies (only they used them).

Out (later slices reuse this sheet as a page):

* Multi-section reports, cover pages, per-unit statistics pages (debt #52 B/C/D).
* Fence / 3-D views on paper.
* DXF and D-Series exports (unchanged; they already POST the on-screen partition).

## The sheet

All dimensions in millimetres. The sheet is one HTML page sized to the paper.

* **Paper.** Height 297 (A3 short side), fixed in fit mode. Width follows the
  profile and is never below 420 (a short profile still gets a full A3). Hard cap
  5000 (Chromium's PDF limit is 200 in); past it the preview says so and export
  is refused.
* **Margins.** 10 all round; a 0.3 pt trim frame at the margin.
* **Left, the profile.** Elevation axis (m TAW) with a 14 wide label gutter on the
  left; along-section axis (m, from A) under it with an 8 high label band; then a
  14 high unit legend strip (colour swatch + unit name, wrapping). Above the
  drawing a 10 high band for **A** (left) and **A′** (right) and the short code
  of each column in its project colour. Drawing height in fit mode:
  297 − 10 − 10 − 10 − 8 − 14 = **245**.
* **Right, one column, width 100, gutter 8 from the profile.** Top: the map box
  (100 × 87.5, the 8 : 7 aspect of the mockup). Directly under it, flush: the
  project legend. Bottom: the title block, 100 wide, four rows of label + value.
  Under the title block, the scale line: `H 1:1000   V 1:200   overhoging 5×`
  (EN: `exaggeration`), and the distance mode in the bottom-left corner of the
  sheet: `StrixGeo · werkelijke afstand` / `gepakt` / `tussenin` (EN: true
  distance / packed / in between).
* **The drawing.** The partition polygons in region order, seams shared, exactly
  the screen's polygons. The fill runs continuously across the columns; a column
  is a hairline axis with the CPT qc trace or the borehole lithology strip drawn
  ON the fill, no white mask. Unit names inside the fills as on screen (the
  screen's label placement is reused; when a region is too small the label is
  dropped, never overlapped). Contacts are the polygon seams; no separate contact
  polylines.
* **Typography.** The app's UI font stack. Chromium embeds whatever it renders.

## Scale modes

Let `range_m` be the elevation span the screen shows for the section (highest
collar or DEM top to deepest column or layer base, plus 0.5 m above and below),
`vex` the vertical exaggeration, `spacing` the column-spacing value in 0..1.

* **Fit (default).** `scaleV = 245 / range_m` mm per m. `scaleH = scaleV / vex`.
  Column x positions come from the screen's own `layoutColumnsHorizontally`
  (true × packed lerp by `spacing`, then the edge-gap nudge) evaluated in mm
  with `scaleH`. Profile width = last column x + trailing half-gap. Paper width =
  10 + 14 + profile width + 8 + 100 + 10, floored at 420.
* **Explicit.** The engineer types `H 1:N_h` and `V 1:N_v`. `scaleH = 1000 / N_h`,
  `scaleV = 1000 / N_v`, `vex` becomes `N_h / N_v` (shown read-only). Drawing
  height = `range_m × scaleV`; paper height = max(297, that + 52). Width as in
  fit mode. Nothing is clipped: the sheet grows.
* Printed scales are always shown as `1:N` with N rounded to an integer; in fit
  mode N is whatever falls out (e.g. 1:1 237).

## Rendering architecture

**One drawing, two viewers.** A second renderer entry, `sheet.html`, mounts a
`SectionSheet` React component and nothing else. It does no data fetching. It
receives a `SheetPayload` by `postMessage` (preview) or by IPC relay (print) and
draws the sheet at the paper size. The preview dialog embeds `sheet.html` in an
iframe; the export path loads the same `sheet.html` in a hidden `BrowserWindow`
and prints it. Preview and PDF are therefore the same DOM, the same CSS, the same
fonts.

**The payload is the screen's geometry.** The Sections stage already assembles
the on-screen partition for the D-Series exports (`buildSectionExportPartition`:
columns with `along_m` / world x y / investigation id, regions per gap as
`(fraction, elevation_m)` polygons with `formation_id`, `body_id`, `layer_ids`).
`SheetPayload` extends that with what a drawing needs and D-Stability does not:

* per column: investigation kind (CPT / borehole), name, short code, project key,
  project colour index, collar elevation, total depth, the qc series (depth,
  qc) for a CPT, the lithology strip (top, base, colour) for a borehole;
* units: `formation_id → name, colour, display_order` (the on-screen legend);
* map: every investigation of the project inside the map extent with
  `on_profile: bool`, world x y, short code, project colour index; the section
  line endpoints; the basemap source id currently selected in the app;
* section: name, EPSG, vertical datum, length;
* settings: fill axis, scale mode + values, vex, spacing, the four fields, the
  language.

Fractions are resolved to x at draw time, so the spacing slider re-lays the same
polygons without recomputing any fill. Elevation is drawn as absolute level, as on
screen.

**Preview dialog** (Sections stage, Export ▸ PDF…). Left: the iframe, scaled to
fit the dialog, with the paper size under it (`Blad 297 × 612 mm`). Right: the
controls — fill axis (litho / geotech, disabled when the model does not exist),
scale mode, the two sliders (seeded from the section's `vertical_exaggeration`
and `view_state.column_spacing`; moving them changes only the sheet), the H and V
inputs in explicit mode, the four fields with their labels, Export. Every change
posts a new payload to the iframe; the sheet re-renders synchronously (no fetch).

**Print pipeline** (main process). `sheet:export-pdf` carries the payload. Main
opens a hidden window on `sheet.html`, relays the payload once `did-finish-load`
fires, waits for the page's `sheet:ready` (fonts loaded via `document.fonts.ready`
AND basemap tiles loaded, or the tile timeout), calls
`webContents.printToPDF({ pageSize: { width, height } in inches, printBackground:
true, margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 } })`,
returns the bytes, closes the window. The renderer then runs the existing
save-dialog + `writeExportFile` flow. A 30 s watchdog turns a stuck print into an
error toast. The default file name is `<section name> – profiel A-A'.pdf` (EN:
`profile`).

## The map

* **Basemap.** The tile source the app's map currently uses (`basemapSources`),
  through Leaflet inside `sheet.html`, all interaction disabled, attribution
  rendered as a small caption inside the box (a licence requirement for OSM).
* **Extent.** Bounding box of the section line and the on-profile investigations,
  padded 25 % each side, minimum span 200 m, then widened or heightened to the
  box's 8 : 7 aspect. Web-Mercator, so north is up and the arrow is fixed.
* **Overlay** (SVG in the Leaflet overlay pane, so it prints as vectors): the
  section line, 1.8 pt, with **A** at the start and **A′** at the end; one dot per
  investigation, full colour + short code for on-profile ones, 50 % opacity for
  the others; scale bar (two alternating segments, labelled 0 / half / full, the
  full length chosen from 50, 100, 200, 500, 1000 m to be about a third of the box
  width); north arrow with **N** in the bottom-right corner.
* **Offline.** Tiles that fail to load leave the ground blank (`#f1efe8`) and a
  caption `basiskaart niet beschikbaar (offline)` / `basemap unavailable
  (offline)` appears; line, dots and legend still print. Export does not wait
  more than 4 s for tiles.

## Codes, colours, legend

* **Short code** of an investigation, from its name. Split the name on `-`. The
  code is the last token (`GEO-16/095-S7` → `S7`, `GEO-16/095-B4` → `B4`). When
  the last token is purely numeric and the token before it is a single letter,
  the code is that letter plus the number (`B-4` → `B4`). A name without `-` is
  its own code (`Sondering 12` → `Sondering 12`). Codes are not made unique;
  colour disambiguates.
* **Project key** = the investigation's `project_id` (GEF opdrachtnummer / DOV
  opdracht); an empty one groups under the language string `(geen project)` /
  `(no project)`.
* **Colours**: the Okabe–Ito palette (8 colour-blind-safe hues) assigned by first
  appearance from A along the profile, then by map position for off-profile
  projects; cycles after 8.
* **Project legend** (under the map): one row per project — dot, project key in
  bold, then the codes in along-order in a monospace face; a last muted row reads
  `S = sondering · B = boring · vaal = niet op het profiel` (EN: `S = CPT · B =
  borehole · faded = not on the profile`).
* **Unit legend** (under the profile): colour swatch + unit name for every unit
  that has a region on the sheet, in `display_order`.

## Settings and persistence

`section.view_state.pdf_sheet` (JSON, additive, absent until first use):

```
{ fill: 'litho' | 'geotech', scaleMode: 'fit' | 'explicit',
  hScale: number | null, vScale: number | null,
  vex: number, spacing: number,
  fields: [{ label: string, value: string } × 4] }
```

Defaults: fill = the axis the stage is on; `fit`; vex and spacing = the section's
current values; fields = Project / Profiel / Opdrachtgever / Datum · Auteur (EN:
Project / Profile / Client / Date · Author) with the project name, the section
name, empty, and today's ISO date pre-filled. The block is saved on Export and
on dialog close (PATCH view_state, as the spacing slider already does), so it
travels in the `.strix` bundle.

## Backend

Delete `section_pdf_report_exporter.py`, `pdf_layout.py`, their constants, the
`GET …/sections/{id}/export/pdf` route, the desktop client method, and the three
matplotlib-dependent unit-test files. Remove `reportlab` and `matplotlib` from
`pyproject.toml` and `uv.lock`; nothing else imports them (verified by grep in the
plan). The compile manifest and the installer's Python payload shrink
accordingly.

## Error handling

* No accepted layers on the chosen axis → the dialog opens but Export is disabled
  with `Geen opvulling om te printen op deze as` / `No fill to print on this
  axis`. Mirrors the D-Series "refuse rather than ship an empty artefact" rule.
* Paper width over 5000 mm → the size label turns amber, Export disabled, message
  names the width and suggests packed spacing or a coarser H scale.
* Print failure or watchdog → error toast with the reason; the hidden window is
  always closed.
* Tile failure → offline caption (above), never a blocked export.

## Testing

Pure (vitest, `desktop/`):

* `sheetGeometry`: fit mode derives V from the range and H from vex; width floors
  at 420; explicit mode grows the height past 297; the 5000 cap; printed `1:N`
  rounding.
* `shortCode`: the four rule cases (`GEO-16/095-S7`, `GEO-16/095-B4`, `B-4`,
  `Sondering 12`).
* `projectPalette`: first-appearance order from A, cycling after 8, empty key
  grouping.
* `sheetSettings`: defaults, round trip through `view_state`, seeding from the
  section's vex and spacing.
* `mapExtent`: padding, minimum span, aspect widening.

Component (vitest + RTL): `SectionSheet` renders one path per region, the A / A′
labels, the four fields, the scale line, and no white column masks.

Playwright (e2e, `scripts/run-e2e.ps1`): open the preview on the seeded section,
move the exaggeration slider and see the paper-size label change, export, assert
the written file starts with `%PDF-` and its `/MediaBox` width and height equal
the size label within 1 pt. The flow runs offline: the basemap falls back to the
offline caption.

Verification against the ask, before "done": export CS1 from the owner's project
and diff the sheet's region outlines against the screen's `PartitionFillOverlay`
paths for the same section (same fractions, same elevations, no line that is not
a polygon seam).

## Files (indicative)

New: `desktop/src/renderer/sheet.html`, `desktop/src/renderer/src/sheet/`
(`main.tsx`, `SectionSheet.tsx`, `SheetMap.tsx`, `TitleBlock.tsx`,
`sheetGeometry.ts`, `shortCode.ts`, `projectPalette.ts`, `mapExtent.ts`,
`sheetPayload.ts` types, tests), `desktop/src/main/sheetPdf.ts` (hidden window +
print + watchdog), preview dialog under `shell/stages/sections/`, `sheet` keys
in `i18n/locales/{en,nl}/`.

Changed: the electron-vite renderer input list, preload bridge (`exportSheetPdf`,
`onSheetPayload`), `useSectionExportVerbs.ts` (PDF verb opens the preview),
`buildSectionExportPartition.ts` (reused, extended into the payload builder),
`api/clients/section.ts` (client method removed), `pyproject.toml`, `uv.lock`,
`docs/exports.md`, `docs/debt.md` #52.

Deleted: the backend exporter trio, the route, the three matplotlib tests.

## Rulings (owner, 2026-09-02, verbatim where it matters)

* "I want it to be horizontal, geotech or litho fill on (not 3d model fill)… I
  just want a faithful render, make a preview window that previews the pdf
  export, the map pane is ugly too… 4 blank fields mimic the dov lengteprofiel
  layout, i want to be able to play with scalers and distancers in the preview."
* Scales: "just keep the sliders as they are in the app… sheet fits the profile…
  keep explicit scales as an alternative option." Paper: "go for a3 height."
* Layout: tekenblad, "put the map on the right next to the section make it the
  same width as the box on the right bottom… the tests need short labels and a
  legend. Put labels like s6 s5 b4 and put the legend with the geo identifier and
  give each unique project an unique colour don't forget to add a basemap and
  A - A'… each map needs a scale and a north arrow… The fill should run over the
  columns." Then: legend flush under the map; the "litho fill · qc log · borehole
  log" caption dropped; "make it english and dutch depending on app language."
* Approach: option 1 (client sheet + Chromium print). "go ahead, i'll check if we
  need editing after you build."
