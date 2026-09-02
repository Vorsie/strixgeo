# Cross-section PDF sheet — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the backend matplotlib section PDF with a faithful, previewable A3-high landscape sheet rendered by the desktop app itself and printed through Chromium.

**Architecture:** A second renderer entry (`sheet.html`) draws a `SectionSheet` from a serialisable `SheetPayload` that the Sections stage assembles from the on-screen partition (the same builder the D-Series exports use) plus the column logs, the units and the map points. The preview dialog shows `sheet.html` in an iframe and re-posts the payload on every control change; export loads the same page in a hidden `BrowserWindow` and calls `webContents.printToPDF` with the computed paper size. The old backend route, exporter, tests and the ReportLab/matplotlib dependencies are deleted.

**Tech Stack:** Electron 42 (`printToPDF`), React 18, Leaflet (already a dependency), electron-vite multi-entry renderer, vitest + RTL, Playwright e2e, FastAPI backend (deletion only).

**Spec:** `docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md` — read it first; the numbers below come from it.

**Project rules that bind every task:** one file per commit, Conventional Commits, English identifiers, every `eslint-disable react-hooks/exhaustive-deps` carries a `// reason:` line, no new dependency, no `any`. Run vitest from `desktop/`, never the repo root. Never touch the owner's main checkout: work in the worktree from Task 0. Never commit (the session main lands the work); leave the tree clean and report per-file.

**Two conventions used everywhere below.** All paper geometry is computed in millimetres and drawn in CSS pixels at 96 dpi: `PX_PER_MM = 96 / 25.4`. Every sheet constant lives in `sheetConstants.ts` (Task 1), never inline.

---

## File structure

New — `desktop/src/renderer/src/sheet/` (the sheet page, no data fetching, no shell context):

| File | Responsibility |
|---|---|
| `sheetConstants.ts` | Every paper dimension + `PX_PER_MM` + the Okabe–Ito palette |
| `sheetPayload.ts` | The `SheetPayload` / `SheetSettings` types (the wire contract between stage, iframe and print window) |
| `investigationName.ts` (+test) | `splitInvestigationName(name) → { projectKey, code }` |
| `projectPalette.ts` (+test) | project key → colour index by first appearance |
| `sheetGeometry.ts` (+test) | fit / explicit scales → paper size, column x, printed `1:N` |
| `mapExtent.ts` (+test) | bbox of line + points → padded 8:7 extent; scale-bar pick |
| `regionPath.ts` (+test) | fraction polygon → SVG path `d` |
| `sheetSettings.ts` (+test) | defaults + `view_state.pdf_sheet` read/write |
| `SectionSheet.tsx` (+test) | the whole sheet: profile, legends, title block, scale line |
| `ProfileDrawing.tsx` | the SVG profile (fills, seams, columns, axes, A/A′) |
| `SheetMap.tsx` | Leaflet basemap + SVG overlay + ready/offline signalling |
| `TitleBlock.tsx` | the four fields |
| `main.tsx` | entry: receives the payload (postMessage or IPC), renders, signals ready |
| `sheet.html` (in `desktop/src/renderer/`) | the second HTML entry |

New — Sections stage (`desktop/src/renderer/src/shell/stages/sections/`):

| File | Responsibility |
|---|---|
| `useSectionExportInputs.ts` | the `investigations` + `packingClassOf` memos lifted out of `useDseriesExportItems.tsx` (second copy → extract) |
| `useSheetPayload.ts` | async builder: partition + logs + units + map points → `SheetPayload` |
| `SheetPreviewDialog.tsx` | the preview dialog: iframe + controls + Export |
| `fetchSectionLogs.ts` (in `components/sections/`) | the CPT plot + borehole detail fetches lifted out of `useSectionData.ts` (second copy → extract) |

New — main / preload: `desktop/src/main/sheetPdf.ts` (hidden window + print + watchdog); preload gains `printSheetPdf`, `onSheetPayload`, `sheetReady`.

New — e2e: `desktop/tests/e2e/flow_export_section_pdf.spec.ts`.

Modified: `desktop/electron-vite.config.ts` (second renderer input), `desktop/src/main/index.ts` (register the IPC), `desktop/src/preload/index.ts`, `desktop/src/renderer/src/i18n/locales/{en,nl}/sheet.ts` + both `index.ts`, `useSectionExportVerbs.ts`, `SectionsToolbarDialogs.tsx`, `sectionsTailToolbarItems.tsx`, `useDseriesExportItems.tsx`, `components/sections/useSectionData.ts`, `api/clients/section.ts` (remove `exportPdf`), `App.tsx` (remove `handleExportSectionPdf` + the prop threading), `docs/exports.md`, `docs/debt.md`, `pyproject.toml`, `uv.lock`.

Deleted: `components/ReportMetadataDialog.tsx` (+ its test if one exists), the backend trio + route + four tests (Task 16).

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree off develop**

```bash
cd /c/Users/robin/Documents/Strix
git worktree add ../Strix-sheet -b section-pdf-sheet develop
cd ../Strix-sheet/desktop && npm ci && node node_modules/electron/install.js
```

Expected: `git -C ../Strix-sheet status` clean; `node --version` prints v22.

- [ ] **Step 2: Baseline gates**

```bash
cd /c/Users/robin/Documents/Strix-sheet/desktop
npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json && npx vitest run --reporter=dot 2>&1 | tail -4
```

Expected: 0 tsc errors; vitest all passed (record the count — the final run must not lose a test).

---

### Task 1: Constants and the payload contract

**Files:**
- Create: `desktop/src/renderer/src/sheet/sheetConstants.ts`
- Create: `desktop/src/renderer/src/sheet/sheetPayload.ts`

- [ ] **Step 1: Write the constants**

```ts
// desktop/src/renderer/src/sheet/sheetConstants.ts
/**
 * Every paper dimension of the cross-section sheet, in millimetres, plus the
 * one conversion the drawing needs. Numbers come from the design spec
 * (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md, "The sheet").
 */

/** CSS pixels per millimetre at Chromium's 96 dpi print resolution. */
export const PX_PER_MM = 96 / 25.4

/** A3 short side — the sheet's fixed height in fit mode. */
export const PAPER_HEIGHT_MM = 297
/** A3 long side — the sheet's minimum width; a short profile still gets a full A3. */
export const PAPER_MIN_WIDTH_MM = 420
/** Chromium refuses PDF pages past 200 in; past this width export is refused. */
export const PAPER_MAX_WIDTH_MM = 5000

export const MARGIN_MM = 10
/** Left gutter for the m TAW axis labels. */
export const AXIS_GUTTER_MM = 14
/** Band above the drawing for A / A′ and the column codes. */
export const TOP_BAND_MM = 10
/** Band under the drawing for the along-section axis labels. */
export const ALONG_BAND_MM = 8
/** Unit legend strip under the profile. */
export const UNIT_LEGEND_MM = 14
/** Drawing height in fit mode: 297 − 10 − 10 − 10 − 8 − 14. */
export const DRAWING_HEIGHT_FIT_MM =
  PAPER_HEIGHT_MM - 2 * MARGIN_MM - TOP_BAND_MM - ALONG_BAND_MM - UNIT_LEGEND_MM
/** Everything on the page that is not the drawing, vertically (explicit mode). */
export const VERTICAL_CHROME_MM = PAPER_HEIGHT_MM - DRAWING_HEIGHT_FIT_MM

/** The right-hand column: map, project legend, title block. */
export const RIGHT_COLUMN_MM = 100
export const GUTTER_MM = 8
/** Map box, 8 : 7 aspect. */
export const MAP_HEIGHT_MM = 87.5
export const MAP_LEGEND_GAP_MM = 3
export const TITLE_BLOCK_MM = 40
export const SCALE_LINE_MM = 6

/** Half the drawn width of a column on paper (qc trace reach, log strip). */
export const COLUMN_HALF_WIDTH_MM = 5
/** Edge gap the nudge keeps between neighbouring columns. */
export const COLUMN_EDGE_GAP_MM = 2
/** Trailing space after the last column before the gutter. */
export const PROFILE_TRAILING_MM = 6
/** Padding above the highest and below the lowest level shown. */
export const LEVEL_PAD_M = 0.5
/** Explicit-mode drawings never collapse below this. */
export const MIN_DRAWING_HEIGHT_MM = 60

/** Map extent: padding each side, minimum span, box aspect. */
export const MAP_PAD_FRACTION = 0.25
export const MAP_MIN_SPAN_M = 200
export const MAP_ASPECT = 8 / 7
/** Scale-bar candidates; the one nearest a third of the box width wins. */
export const SCALE_BAR_CANDIDATES_M = [50, 100, 200, 500, 1000, 2000] as const
/** Export waits this long for basemap tiles, then prints without them. */
export const TILE_WAIT_MS = 4000

/** Okabe–Ito, colour-blind safe, one per project in order of first appearance. */
export const PROJECT_PALETTE = [
  '#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442', '#000000',
] as const

/** A region label is dropped when its bounding box is smaller than this. */
export const LABEL_MIN_WIDTH_PX = 60
export const LABEL_MIN_HEIGHT_PX = 14
```

- [ ] **Step 2: Write the payload types**

```ts
// desktop/src/renderer/src/sheet/sheetPayload.ts
/**
 * The wire contract of the cross-section sheet. Assembled on the Sections
 * stage (``useSheetPayload``), posted into the preview iframe, relayed by the
 * main process into the hidden print window. Plain JSON: no functions, no
 * class instances, so it survives ``postMessage`` and IPC unchanged.
 *
 * Geometry stays in the screen's frame: regions are ``[fraction, elevation_m]``
 * polygons per gap (exactly ``RegionInput``), columns carry their true
 * ``along_m``. Column x on paper is resolved at draw time from the spacing
 * slider, so a slider move never recomputes a fill.
 */
import type { BoreholeDetailResponse } from '../api/clients/borehole'
import type { CptPlotResponse } from '../api/clients/cpt'
import type { RegionInput } from '../utils/buildVoxelRequest'

export type SheetFill = 'litho' | 'geotech'
export type SheetScaleMode = 'fit' | 'explicit'

export interface SheetField {
  label: string
  value: string
}

export interface SheetSettings {
  fill: SheetFill
  scaleMode: SheetScaleMode
  /** ``1:N`` denominators; only read in explicit mode. */
  hScale: number | null
  vScale: number | null
  vex: number
  /** 0 = packed, 1 = true distance (the section's ``column_spacing``). */
  spacing: number
  fields: [SheetField, SheetField, SheetField, SheetField]
}

export interface SheetColumn {
  investigationId: string
  kind: 'cpt' | 'borehole'
  name: string
  code: string
  projectKey: string
  colourIndex: number
  alongM: number
  collarElevationM: number
  totalDepthM: number
  /** CPT only. */
  cptType: string | null
  plot: CptPlotResponse | null
  /** Borehole only. */
  detail: BoreholeDetailResponse | null
}

export interface SheetUnit {
  formationId: string
  name: string
  colour: string
  displayOrder: number
}

export interface SheetMapPoint {
  investigationId: string
  kind: 'cpt' | 'borehole'
  code: string
  colourIndex: number
  worldX: number
  worldY: number
  onProfile: boolean
}

export interface SheetProjectLegendRow {
  projectKey: string
  colourIndex: number
  /** Codes in A → A′ order (on-profile first), then map order. */
  codes: string[]
}

export interface SheetPayload {
  language: 'en' | 'nl'
  section: {
    id: string
    name: string
    epsg: number
    lengthM: number
    startX: number
    startY: number
    endX: number
    endY: number
    /** The section's ``view_state`` — the column components read their channel toggles from it. */
    viewState: Record<string, unknown> | null
  }
  columns: SheetColumn[]
  regions: RegionInput[]
  units: SheetUnit[]
  /** Highest / lowest level drawn, already padded by ``LEVEL_PAD_M``. */
  levelMaxM: number
  levelMinM: number
  map: {
    basemapId: string
    points: SheetMapPoint[]
    legend: SheetProjectLegendRow[]
  }
  settings: SheetSettings
}

/** What the sheet page reports back once it has laid itself out. */
export interface SheetReadyMessage {
  type: 'sheet:ready'
  paperWidthMm: number
  paperHeightMm: number
  /** True when the basemap tiles never arrived (offline caption shown). */
  offline: boolean
}

export interface SheetPayloadMessage {
  type: 'sheet:payload'
  payload: SheetPayload
}
```

- [ ] **Step 3: Type-check**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: 0 errors.

- [ ] **Step 4: Report the two files for commit** (`feat(sheet): paper constants` / `feat(sheet): payload contract`).

---

### Task 2: Investigation name split

**Files:**
- Create: `desktop/src/renderer/src/sheet/investigationName.ts`
- Test: `desktop/src/renderer/src/sheet/investigationName.test.ts`

- [ ] **Step 1: Write the failing test** (rule in the spec's words)

```ts
// desktop/src/renderer/src/sheet/investigationName.test.ts
import { describe, expect, it } from 'vitest'
import { splitInvestigationName } from './investigationName'

describe('splitInvestigationName — short code and project key from a DOV/GEF name', () => {
  it('a DOV name: the code is the token after the last dash, the project is the rest', () => {
    expect(splitInvestigationName('GEO-16/095-S7')).toEqual({ projectKey: 'GEO-16/095', code: 'S7' })
    expect(splitInvestigationName('GEO-16/095-B4')).toEqual({ projectKey: 'GEO-16/095', code: 'B4' })
  })
  it('a numeric last token after a single letter keeps the letter', () => {
    expect(splitInvestigationName('B-4')).toEqual({ projectKey: '', code: 'B4' })
    expect(splitInvestigationName('GEO-19/022-S-12')).toEqual({ projectKey: 'GEO-19/022', code: 'S12' })
  })
  it('a name without a dash is its own code and has no project', () => {
    expect(splitInvestigationName('Sondering 12')).toEqual({ projectKey: '', code: 'Sondering 12' })
  })
  it('trims whitespace and never returns an empty code', () => {
    expect(splitInvestigationName('  GEO-1/2-  ')).toEqual({ projectKey: 'GEO-1/2', code: 'GEO-1/2' })
  })
})
```

- [ ] **Step 2: Run it, expect RED**

Run: `cd desktop && npx vitest run src/renderer/src/sheet/investigationName.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/sheet/investigationName.ts
/**
 * Short code + project key from an investigation name (spec "Codes, colours,
 * legend"). DOV names are ``<opdracht>-<code>`` (``GEO-16/095-S7``); the
 * opdracht is what the owner calls "the geo identifier" and it is the colour
 * key on the map. A name without a dash has no project and is its own code.
 */
export interface SplitName {
  projectKey: string
  code: string
}

export function splitInvestigationName(rawName: string): SplitName {
  const name = rawName.trim()
  const tokens = name.split('-').map(t => t.trim())
  if (tokens.length === 1) return { projectKey: '', code: name }
  let code = tokens[tokens.length - 1]
  let head = tokens.slice(0, -1)
  // ``B-4`` / ``…-S-12``: a bare number after a single letter keeps the letter.
  if (/^\d+$/.test(code) && head.length > 0 && /^[A-Za-z]$/.test(head[head.length - 1])) {
    code = head[head.length - 1] + code
    head = head.slice(0, -1)
  }
  const projectKey = head.join('-')
  if (code === '') return { projectKey, code: projectKey || name }
  return { projectKey, code }
}
```

- [ ] **Step 4: Run it, expect GREEN.** Same command. Expected: 4 passed.

- [ ] **Step 5: Report** (`feat(sheet): short code and project key from an investigation name` + `test(sheet): …`).

---

### Task 3: Project palette

**Files:**
- Create: `desktop/src/renderer/src/sheet/projectPalette.ts`
- Test: `desktop/src/renderer/src/sheet/projectPalette.test.ts`

- [ ] **Step 1: Failing test**

```ts
// desktop/src/renderer/src/sheet/projectPalette.test.ts
import { describe, expect, it } from 'vitest'
import { assignProjectColours, NO_PROJECT_KEY } from './projectPalette'
import { PROJECT_PALETTE } from './sheetConstants'

describe('assignProjectColours — one colour per project, by first appearance from A', () => {
  it('numbers projects in the order they are first met', () => {
    const idx = assignProjectColours(['GEO-2', 'GEO-1', 'GEO-2', 'GEO-3'])
    expect(idx.get('GEO-2')).toBe(0)
    expect(idx.get('GEO-1')).toBe(1)
    expect(idx.get('GEO-3')).toBe(2)
  })
  it('cycles after the palette is exhausted', () => {
    const keys = Array.from({ length: PROJECT_PALETTE.length + 1 }, (_, i) => `P${i}`)
    const idx = assignProjectColours(keys)
    expect(idx.get(`P${PROJECT_PALETTE.length}`)).toBe(0)
  })
  it('an empty key groups under the no-project key', () => {
    const idx = assignProjectColours(['', 'GEO-1', ''])
    expect(idx.get(NO_PROJECT_KEY)).toBe(0)
    expect(idx.get('GEO-1')).toBe(1)
    expect(idx.size).toBe(2)
  })
})
```

- [ ] **Step 2: RED.** Run: `cd desktop && npx vitest run src/renderer/src/sheet/projectPalette.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/sheet/projectPalette.ts
/** Project key → palette index, in order of first appearance (spec "Colours"). */
import { PROJECT_PALETTE } from './sheetConstants'

/** Sentinel for investigations whose name carries no project. Rendered through i18n. */
export const NO_PROJECT_KEY = ' no-project'

export function normaliseProjectKey(key: string): string {
  return key === '' ? NO_PROJECT_KEY : key
}

/**
 * Parameters
 * ----------
 * keysInOrder : the project key of every investigation, on-profile ones first
 *   in A → A′ order, then the off-profile map points.
 */
export function assignProjectColours(keysInOrder: readonly string[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const raw of keysInOrder) {
    const key = normaliseProjectKey(raw)
    if (!index.has(key)) index.set(key, index.size % PROJECT_PALETTE.length)
  }
  return index
}

export function projectColour(colourIndex: number): string {
  return PROJECT_PALETTE[colourIndex % PROJECT_PALETTE.length]
}
```

- [ ] **Step 4: GREEN.** Expected: 3 passed.
- [ ] **Step 5: Report.**

---

### Task 4: Sheet geometry

**Files:**
- Create: `desktop/src/renderer/src/sheet/sheetGeometry.ts`
- Test: `desktop/src/renderer/src/sheet/sheetGeometry.test.ts`

The column x positions reuse the screen's own layout, `layoutColumnsHorizontally` (`desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts`), fed in millimetres: `scaleH` in mm per m, `bandHalfWidth` = `COLUMN_HALF_WIDTH_MM`, `edgeGapPx` = `COLUMN_EDGE_GAP_MM`, `marginLeft` = `MARGIN_MM + AXIS_GUTTER_MM + COLUMN_HALF_WIDTH_MM`. Its `ZoomLayoutColumn` needs `id`, `along`, `fixedWidthPx`, `halfWidthMultiple` (`wheelZoomAnchor.ts:50-56`): pass `fixedWidthPx: 0`, `halfWidthMultiple: 2` so every column is one band wide.

- [ ] **Step 1: Failing test**

```ts
// desktop/src/renderer/src/sheet/sheetGeometry.test.ts
import { describe, expect, it } from 'vitest'
import { computeSheetGeometry } from './sheetGeometry'
import {
  DRAWING_HEIGHT_FIT_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM, PAPER_MIN_WIDTH_MM,
} from './sheetConstants'

const base = {
  levelMaxM: 5, levelMinM: -20,                 // range 25 m
  columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 100 }, { id: 'c', alongM: 400 }],
}

describe('computeSheetGeometry — the sheet fits the profile', () => {
  it('fit mode: V comes from the depth range over the 245 mm drawing, H from the exaggeration', () => {
    const g = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(g.scaleVmmPerM).toBeCloseTo(DRAWING_HEIGHT_FIT_MM / 25, 6)
    expect(g.scaleHmmPerM).toBeCloseTo(g.scaleVmmPerM / 5, 6)
    expect(g.paperHeightMm).toBe(PAPER_HEIGHT_MM)
    expect(g.printedV).toBe(Math.round(1000 / g.scaleVmmPerM))
    expect(g.printedH).toBe(Math.round(1000 / g.scaleHmmPerM))
  })
  it('a short profile still gets a full A3 width', () => {
    const g = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 20 }], scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1 })
    expect(g.paperWidthMm).toBe(PAPER_MIN_WIDTH_MM)
  })
  it('a long profile at true distance makes a wider sheet than the same profile packed', () => {
    const wide = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 1 })
    const packed = computeSheetGeometry({ ...base, scaleMode: 'fit', hScale: null, vScale: null, vex: 1, spacing: 0 })
    expect(wide.paperWidthMm).toBeGreaterThan(packed.paperWidthMm)
    expect(wide.columnXmm[2]).toBeGreaterThan(wide.columnXmm[1])
  })
  it('explicit mode: typed scales win, vex is derived, the page grows past A3 when the drawing needs it', () => {
    const g = computeSheetGeometry({ ...base, scaleMode: 'explicit', hScale: 1000, vScale: 50, vex: 5, spacing: 1 })
    expect(g.scaleHmmPerM).toBeCloseTo(1, 6)
    expect(g.scaleVmmPerM).toBeCloseTo(20, 6)
    expect(g.vexEffective).toBeCloseTo(20, 6)
    expect(g.drawingHeightMm).toBeCloseTo(500, 6)
    expect(g.paperHeightMm).toBeGreaterThan(PAPER_HEIGHT_MM)
  })
  it('a sheet past the width cap is flagged, never clipped', () => {
    const g = computeSheetGeometry({ ...base, columns: [{ id: 'a', alongM: 0 }, { id: 'b', alongM: 50_000 }], scaleMode: 'explicit', hScale: 100, vScale: 100, vex: 1, spacing: 1 })
    expect(g.paperWidthMm).toBeGreaterThan(PAPER_MAX_WIDTH_MM)
    expect(g.overCap).toBe(true)
  })
})
```

- [ ] **Step 2: RED.** Run: `cd desktop && npx vitest run src/renderer/src/sheet/sheetGeometry.test.ts`

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/sheet/sheetGeometry.ts
/**
 * Paper size and column placement for the sheet (spec "Scale modes").
 * Pure: millimetres in, millimetres out. Column x reuses the screen's own
 * ``layoutColumnsHorizontally`` so the spacing slider means on paper exactly
 * what it means on screen.
 */
import { layoutColumnsHorizontally } from '../components/sections/wheelZoomAnchor'
import {
  AXIS_GUTTER_MM, COLUMN_EDGE_GAP_MM, COLUMN_HALF_WIDTH_MM, DRAWING_HEIGHT_FIT_MM,
  GUTTER_MM, MARGIN_MM, MIN_DRAWING_HEIGHT_MM, PAPER_HEIGHT_MM, PAPER_MAX_WIDTH_MM,
  PAPER_MIN_WIDTH_MM, PROFILE_TRAILING_MM, RIGHT_COLUMN_MM, TOP_BAND_MM, VERTICAL_CHROME_MM,
} from './sheetConstants'
import type { SheetScaleMode } from './sheetPayload'

export interface SheetGeometryInput {
  levelMaxM: number
  levelMinM: number
  /** Sorted by ``alongM`` ascending. */
  columns: readonly { id: string; alongM: number }[]
  scaleMode: SheetScaleMode
  hScale: number | null
  vScale: number | null
  vex: number
  spacing: number
}

export interface SheetGeometry {
  paperWidthMm: number
  paperHeightMm: number
  drawingHeightMm: number
  /** Left edge of the drawing (after margin + axis gutter). */
  drawingLeftMm: number
  drawingTopMm: number
  drawingWidthMm: number
  rightColumnLeftMm: number
  scaleHmmPerM: number
  scaleVmmPerM: number
  printedH: number
  printedV: number
  vexEffective: number
  /** One entry per input column, same order, mm from the paper's left edge. */
  columnXmm: number[]
  overCap: boolean
}

export function computeSheetGeometry(input: SheetGeometryInput): SheetGeometry {
  const rangeM = Math.max(1e-3, input.levelMaxM - input.levelMinM)
  let scaleV: number
  let scaleH: number
  let drawingHeightMm: number
  if (input.scaleMode === 'explicit' && input.hScale && input.vScale) {
    scaleH = 1000 / input.hScale
    scaleV = 1000 / input.vScale
    drawingHeightMm = Math.max(MIN_DRAWING_HEIGHT_MM, rangeM * scaleV)
  } else {
    scaleV = DRAWING_HEIGHT_FIT_MM / rangeM
    scaleH = scaleV / Math.max(1e-6, input.vex)
    drawingHeightMm = DRAWING_HEIGHT_FIT_MM
  }
  const drawingLeftMm = MARGIN_MM + AXIS_GUTTER_MM
  const placements = layoutColumnsHorizontally({
    columns: input.columns.map(c => ({
      id: c.id, along: c.alongM, fixedWidthPx: 0, halfWidthMultiple: 2,
    })),
    xMin: input.columns[0]?.alongM ?? 0,
    scaleH,
    bandHalfWidth: COLUMN_HALF_WIDTH_MM,
    columnSpacing: input.spacing,
    marginLeft: drawingLeftMm + COLUMN_HALF_WIDTH_MM,
    edgeGapPx: COLUMN_EDGE_GAP_MM,
  })
  const byId = new Map(placements.map(p => [p.id, p.nudgedX]))
  const columnXmm = input.columns.map(c => byId.get(c.id) ?? drawingLeftMm)
  const lastX = columnXmm.length > 0 ? Math.max(...columnXmm) : drawingLeftMm
  const drawingRightMm = lastX + COLUMN_HALF_WIDTH_MM + PROFILE_TRAILING_MM
  const naturalWidth = drawingRightMm + GUTTER_MM + RIGHT_COLUMN_MM + MARGIN_MM
  const paperWidthMm = Math.max(PAPER_MIN_WIDTH_MM, Math.ceil(naturalWidth))
  const rightColumnLeftMm = paperWidthMm - MARGIN_MM - RIGHT_COLUMN_MM
  return {
    paperWidthMm,
    paperHeightMm: Math.max(PAPER_HEIGHT_MM, Math.ceil(drawingHeightMm + VERTICAL_CHROME_MM)),
    drawingHeightMm,
    drawingLeftMm,
    drawingTopMm: MARGIN_MM + TOP_BAND_MM,
    drawingWidthMm: rightColumnLeftMm - GUTTER_MM - drawingLeftMm,
    rightColumnLeftMm,
    scaleHmmPerM: scaleH,
    scaleVmmPerM: scaleV,
    printedH: Math.round(1000 / scaleH),
    printedV: Math.round(1000 / scaleV),
    vexEffective: scaleV / scaleH,
    columnXmm,
    overCap: paperWidthMm > PAPER_MAX_WIDTH_MM,
  }
}
```

- [ ] **Step 4: GREEN.** Expected: 5 passed. If `layoutColumnsHorizontally`'s column type has grown a field since `wheelZoomAnchor.ts:50-56`, add it with the neutral value the screen uses for a plain column — do not fork the layout function.

- [ ] **Step 5: Report.**

---

### Task 5: Map extent and scale bar

**Files:**
- Create: `desktop/src/renderer/src/sheet/mapExtent.ts`
- Test: `desktop/src/renderer/src/sheet/mapExtent.test.ts`

- [ ] **Step 1: Failing test**

```ts
// desktop/src/renderer/src/sheet/mapExtent.test.ts
import { describe, expect, it } from 'vitest'
import { computeMapExtent, pickScaleBarM } from './mapExtent'
import { MAP_ASPECT, MAP_MIN_SPAN_M } from './sheetConstants'

describe('computeMapExtent — the section line and its tests, padded, in the box aspect', () => {
  it('pads 25 % each side and honours the 8:7 aspect', () => {
    const e = computeMapExtent([{ x: 0, y: 0 }, { x: 800, y: 0 }])
    expect(e.maxX - e.minX).toBeCloseTo(1200, 6)              // 800 + 2 × 200
    expect((e.maxX - e.minX) / (e.maxY - e.minY)).toBeCloseTo(MAP_ASPECT, 6)
    expect((e.minX + e.maxX) / 2).toBeCloseTo(400, 6)
  })
  it('a tiny cluster is widened to the minimum span', () => {
    const e = computeMapExtent([{ x: 10, y: 10 }, { x: 12, y: 11 }])
    expect(e.maxX - e.minX).toBeGreaterThanOrEqual(MAP_MIN_SPAN_M)
  })
  it('a tall extent widens to the aspect instead of shrinking', () => {
    const e = computeMapExtent([{ x: 0, y: 0 }, { x: 0, y: 700 }])
    expect(e.maxY - e.minY).toBeCloseTo(1050, 6)
    expect(e.maxX - e.minX).toBeCloseTo(1050 * MAP_ASPECT, 6)
  })
})

describe('pickScaleBarM — about a third of the box', () => {
  it('picks the candidate nearest a third of the visible width', () => {
    expect(pickScaleBarM(1200)).toBe(500)
    expect(pickScaleBarM(300)).toBe(100)
    expect(pickScaleBarM(30_000)).toBe(2000)
  })
})
```

- [ ] **Step 2: RED.** Run: `cd desktop && npx vitest run src/renderer/src/sheet/mapExtent.test.ts`

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/sheet/mapExtent.ts
/** Map box extent in projected metres (spec "The map — Extent") + the scale bar pick. */
import { MAP_ASPECT, MAP_MIN_SPAN_M, MAP_PAD_FRACTION, SCALE_BAR_CANDIDATES_M } from './sheetConstants'

export interface Extent { minX: number; minY: number; maxX: number; maxY: number }

export function computeMapExtent(points: readonly { x: number; y: number }[]): Extent {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  let spanX = Math.max(MAP_MIN_SPAN_M, (maxX - minX) * (1 + 2 * MAP_PAD_FRACTION))
  let spanY = Math.max(MAP_MIN_SPAN_M / MAP_ASPECT, (maxY - minY) * (1 + 2 * MAP_PAD_FRACTION))
  // Widen (never shrink) to the box aspect.
  if (spanX / spanY < MAP_ASPECT) spanX = spanY * MAP_ASPECT
  else spanY = spanX / MAP_ASPECT
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  return { minX: cx - spanX / 2, maxX: cx + spanX / 2, minY: cy - spanY / 2, maxY: cy + spanY / 2 }
}

export function pickScaleBarM(visibleWidthM: number): number {
  const target = visibleWidthM / 3
  let best: number = SCALE_BAR_CANDIDATES_M[0]
  for (const c of SCALE_BAR_CANDIDATES_M) {
    if (Math.abs(c - target) < Math.abs(best - target)) best = c
  }
  return best
}
```

- [ ] **Step 4: GREEN.** Expected: 4 passed.
- [ ] **Step 5: Report.**

---

### Task 6: Region path

**Files:**
- Create: `desktop/src/renderer/src/sheet/regionPath.ts`
- Test: `desktop/src/renderer/src/sheet/regionPath.test.ts`

- [ ] **Step 1: Failing test**

```ts
// desktop/src/renderer/src/sheet/regionPath.test.ts
import { describe, expect, it } from 'vitest'
import { regionPathD, regionBounds } from './regionPath'

const columnX = [100, 300, 600]                          // px, along-order
const levelToY = (level: number): number => 50 + (10 - level) * 4  // levelMax 10 at y=50, 4 px/m

describe('regionPathD — a fraction polygon of gap g lands between column g and g+1', () => {
  it('fraction 0 is the left column, 1 the right column, elevation is absolute level', () => {
    const d = regionPathD({ gap_index: 1, polygon: [[0, 10], [1, 10], [1, 0], [0, 0]] }, columnX, levelToY)
    expect(d).toBe('M300 50L600 50L600 90L300 90Z')
  })
  it('an empty polygon yields an empty path', () => {
    expect(regionPathD({ gap_index: 0, polygon: [] }, columnX, levelToY)).toBe('')
  })
  it('bounds are the bbox of the resolved points', () => {
    expect(regionBounds({ gap_index: 0, polygon: [[0.5, 5], [1, 0]] }, columnX, levelToY))
      .toEqual({ minX: 200, maxX: 300, minY: 70, maxY: 90 })
  })
})
```

- [ ] **Step 2: RED.** Run: `cd desktop && npx vitest run src/renderer/src/sheet/regionPath.test.ts`

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/sheet/regionPath.ts
/** Fraction polygons (``RegionInput``) → pixel paths. Numbers are rounded to 0.01 px. */

export interface FractionRegion {
  gap_index: number
  polygon: readonly (readonly [number, number])[]
}

function r2(v: number): string {
  return String(Math.round(v * 100) / 100)
}

export function resolveRegionPoints(
  region: FractionRegion,
  columnX: readonly number[],
  levelToY: (level: number) => number,
): [number, number][] {
  const x0 = columnX[region.gap_index] ?? 0
  const x1 = columnX[region.gap_index + 1] ?? x0
  return region.polygon.map(([f, level]) => [x0 + f * (x1 - x0), levelToY(level)])
}

export function regionPathD(
  region: FractionRegion,
  columnX: readonly number[],
  levelToY: (level: number) => number,
): string {
  const pts = resolveRegionPoints(region, columnX, levelToY)
  if (pts.length === 0) return ''
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r2(x)} ${r2(y)}`).join('') + 'Z'
}

export function regionBounds(
  region: FractionRegion,
  columnX: readonly number[],
  levelToY: (level: number) => number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = resolveRegionPoints(region, columnX, levelToY)
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
```

- [ ] **Step 4: GREEN.** Expected: 3 passed.
- [ ] **Step 5: Report.**

---

### Task 7: Settings defaults and persistence

**Files:**
- Create: `desktop/src/renderer/src/sheet/sheetSettings.ts`
- Test: `desktop/src/renderer/src/sheet/sheetSettings.test.ts`

- [ ] **Step 1: Failing test**

```ts
// desktop/src/renderer/src/sheet/sheetSettings.test.ts
import { describe, expect, it } from 'vitest'
import { defaultSheetSettings, readSheetSettings, writeSheetSettings } from './sheetSettings'

const labels = { project: 'Project', profile: 'Profiel', client: 'Opdrachtgever', dateAuthor: 'Datum · Auteur' }

describe('sheet settings — seeded from the section, persisted in view_state.pdf_sheet', () => {
  it('defaults take the section vex and spacing, and pre-fill project, section and date', () => {
    const s = defaultSheetSettings({
      fill: 'litho', vex: 4, spacing: 0.7, projectName: 'Kaai 1712', sectionName: 'CS1', today: '2026-09-02', labels,
    })
    expect(s).toMatchObject({ fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 4, spacing: 0.7 })
    expect(s.fields.map(f => f.label)).toEqual(['Project', 'Profiel', 'Opdrachtgever', 'Datum · Auteur'])
    expect(s.fields.map(f => f.value)).toEqual(['Kaai 1712', 'CS1', '', '2026-09-02'])
  })
  it('round-trips through view_state and ignores junk', () => {
    const s = defaultSheetSettings({ fill: 'geotech', vex: 2, spacing: 1, projectName: 'P', sectionName: 'S', today: 'd', labels })
    const vs = writeSheetSettings({ column_spacing: 0.5 }, { ...s, scaleMode: 'explicit', hScale: 1000, vScale: 200 })
    expect(vs.column_spacing).toBe(0.5)
    expect(readSheetSettings(vs, s)).toMatchObject({ scaleMode: 'explicit', hScale: 1000, vScale: 200, fill: 'geotech' })
    expect(readSheetSettings({ pdf_sheet: 'garbage' }, s)).toEqual(s)
    expect(readSheetSettings({ pdf_sheet: { fill: 'model' } }, s)).toEqual(s)
  })
})
```

- [ ] **Step 2: RED.** Run: `cd desktop && npx vitest run src/renderer/src/sheet/sheetSettings.test.ts`

- [ ] **Step 3: Implement**

```ts
// desktop/src/renderer/src/sheet/sheetSettings.ts
/** Defaults + ``view_state.pdf_sheet`` read/write (spec "Settings and persistence"). Additive: absent until first use. */
import type { SheetField, SheetFill, SheetScaleMode, SheetSettings } from './sheetPayload'

export interface FieldLabels { project: string; profile: string; client: string; dateAuthor: string }

export function defaultSheetSettings(seed: {
  fill: SheetFill; vex: number; spacing: number
  projectName: string; sectionName: string; today: string; labels: FieldLabels
}): SheetSettings {
  return {
    fill: seed.fill, scaleMode: 'fit', hScale: null, vScale: null, vex: seed.vex, spacing: seed.spacing,
    fields: [
      { label: seed.labels.project, value: seed.projectName },
      { label: seed.labels.profile, value: seed.sectionName },
      { label: seed.labels.client, value: '' },
      { label: seed.labels.dateAuthor, value: seed.today },
    ],
  }
}

const FILLS: readonly SheetFill[] = ['litho', 'geotech']
const MODES: readonly SheetScaleMode[] = ['fit', 'explicit']

function isField(v: unknown): v is SheetField {
  return !!v && typeof v === 'object' && typeof (v as SheetField).label === 'string' && typeof (v as SheetField).value === 'string'
}

/** Returns ``fallback`` untouched when the stored block is missing or malformed. */
export function readSheetSettings(
  viewState: Record<string, unknown> | null | undefined,
  fallback: SheetSettings,
): SheetSettings {
  const raw = viewState?.pdf_sheet
  if (!raw || typeof raw !== 'object') return fallback
  const d = raw as Record<string, unknown>
  const fields = Array.isArray(d.fields) && d.fields.length === 4 && d.fields.every(isField)
    ? (d.fields as SheetSettings['fields'])
    : fallback.fields
  const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  if (!FILLS.includes(d.fill as SheetFill)) return fallback
  return {
    fill: d.fill as SheetFill,
    scaleMode: MODES.includes(d.scaleMode as SheetScaleMode) ? (d.scaleMode as SheetScaleMode) : 'fit',
    hScale: numOrNull(d.hScale),
    vScale: numOrNull(d.vScale),
    vex: num(d.vex, fallback.vex),
    spacing: Math.min(1, Math.max(0, num(d.spacing, fallback.spacing))),
    fields,
  }
}

/** Shallow-merges the block into a copy of the view state (the PATCH body the section client takes). */
export function writeSheetSettings(
  viewState: Record<string, unknown> | null | undefined,
  settings: SheetSettings,
): Record<string, unknown> {
  return { ...(viewState ?? {}), pdf_sheet: settings }
}
```

- [ ] **Step 4: GREEN.** Expected: 2 passed.
- [ ] **Step 5: Report.**

---

### Task 8: Language keys

**Files:**
- Create: `desktop/src/renderer/src/i18n/locales/en/sheet.ts`
- Create: `desktop/src/renderer/src/i18n/locales/nl/sheet.ts`
- Modify: `desktop/src/renderer/src/i18n/locales/en/index.ts` (import + spread `SHEET` after `OUTPUTS`, and add it to the per-module list the duplicate-key test reads)
- Modify: `desktop/src/renderer/src/i18n/locales/nl/index.ts` (same)

`localeParity.test.ts` (already in the suite) fails on any key or placeholder drift between the two files — that is the test for this task.

- [ ] **Step 1: Write the English module**

```ts
// desktop/src/renderer/src/i18n/locales/en/sheet.ts
// Cross-section PDF sheet — preview dialog + the printed sheet.
// Part of the English message catalogue — see 'locales/en/index.ts' for the rules.
export const SHEET = {
  'sheet.title': 'Section sheet',
  'sheet.export': 'Export PDF',
  'sheet.exporting': 'Printing…',
  'sheet.close': 'Close',
  'sheet.fill': 'Fill',
  'sheet.fill.litho': 'Lithostratigraphy',
  'sheet.fill.geotech': 'Geotechnical',
  'sheet.scaleMode': 'Scale',
  'sheet.scaleMode.fit': 'Fit to A3 height',
  'sheet.scaleMode.explicit': 'Explicit scales',
  'sheet.hScale': 'Horizontal 1 :',
  'sheet.vScale': 'Vertical 1 :',
  'sheet.vex': 'Vertical exaggeration',
  'sheet.spacing': 'Column spacing',
  'sheet.paperSize': 'Sheet {w} × {h} mm',
  'sheet.fields': 'Title block',
  'sheet.field.project': 'Project',
  'sheet.field.profile': 'Profile',
  'sheet.field.client': 'Client',
  'sheet.field.dateAuthor': 'Date · Author',
  'sheet.scaleLine': 'H 1:{h}   V 1:{v}   exaggeration {vex}×',
  'sheet.distance.true': 'true distance',
  'sheet.distance.packed': 'packed',
  'sheet.distance.between': 'in between',
  'sheet.legend.projects': 'S = CPT · B = borehole · faded = not on the profile',
  'sheet.legend.noProject': '(no project)',
  'sheet.map.offline': 'basemap unavailable (offline)',
  'sheet.noFill': 'No fill to print on this axis.',
  'sheet.tooWide': 'The sheet would be {w} mm wide (limit 5000). Use packed spacing or a coarser horizontal scale.',
  'sheet.exported': 'PDF exported.',
  'sheet.exportFailed': 'Could not export the PDF.',
  'sheet.fileSuffix': 'profile A-A′',
  'sheet.mTaw': 'm TAW',
} as const
```

- [ ] **Step 2: Write the Dutch module** (same keys, same placeholders; export name per the `nl/*.ts` convention — open `nl/sections.ts` and mirror it)

```ts
// desktop/src/renderer/src/i18n/locales/nl/sheet.ts
// Dwarsprofiel-PDF — voorbeeldvenster + het gedrukte blad.
export const SHEET = {
  'sheet.title': 'Profielblad',
  'sheet.export': 'PDF exporteren',
  'sheet.exporting': 'Bezig met printen…',
  'sheet.close': 'Sluiten',
  'sheet.fill': 'Opvulling',
  'sheet.fill.litho': 'Lithostratigrafie',
  'sheet.fill.geotech': 'Geotechnisch',
  'sheet.scaleMode': 'Schaal',
  'sheet.scaleMode.fit': 'Passend op A3-hoogte',
  'sheet.scaleMode.explicit': 'Expliciete schalen',
  'sheet.hScale': 'Horizontaal 1 :',
  'sheet.vScale': 'Verticaal 1 :',
  'sheet.vex': 'Overhoging',
  'sheet.spacing': 'Kolomafstand',
  'sheet.paperSize': 'Blad {w} × {h} mm',
  'sheet.fields': 'Tekstblok',
  'sheet.field.project': 'Project',
  'sheet.field.profile': 'Profiel',
  'sheet.field.client': 'Opdrachtgever',
  'sheet.field.dateAuthor': 'Datum · Auteur',
  'sheet.scaleLine': 'H 1:{h}   V 1:{v}   overhoging {vex}×',
  'sheet.distance.true': 'werkelijke afstand',
  'sheet.distance.packed': 'gepakt',
  'sheet.distance.between': 'tussenin',
  'sheet.legend.projects': 'S = sondering · B = boring · vaal = niet op het profiel',
  'sheet.legend.noProject': '(geen project)',
  'sheet.map.offline': 'basiskaart niet beschikbaar (offline)',
  'sheet.noFill': 'Geen opvulling om te printen op deze as.',
  'sheet.tooWide': 'Het blad zou {w} mm breed worden (limiet 5000). Gebruik gepakte kolommen of een grovere horizontale schaal.',
  'sheet.exported': 'PDF geëxporteerd.',
  'sheet.exportFailed': 'De PDF kon niet worden gemaakt.',
  'sheet.fileSuffix': 'profiel A-A′',
  'sheet.mTaw': 'm TAW',
} as const
```

- [ ] **Step 3: Register both** in the two `index.ts` (import, spread after `OUTPUTS`, add to the module list).

- [ ] **Step 4: Run the parity + duplicate tests**

Run: `cd desktop && npx vitest run src/renderer/src/i18n`
Expected: all passed.

- [ ] **Step 5: Report** (4 files).

---

### Task 9: The sheet components

**Files:**
- Create: `desktop/src/renderer/src/sheet/TitleBlock.tsx`
- Create: `desktop/src/renderer/src/sheet/ProfileDrawing.tsx`
- Create: `desktop/src/renderer/src/sheet/SectionSheet.tsx`
- Test: `desktop/src/renderer/src/sheet/SectionSheet.test.tsx`

`SheetMap` is Task 10; `SectionSheet` takes it as a child slot so this task's test renders without Leaflet.

- [ ] **Step 1: Failing component test**

```tsx
// desktop/src/renderer/src/sheet/SectionSheet.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SectionSheet } from './SectionSheet'
import type { SheetPayload } from './sheetPayload'

function payload(): SheetPayload {
  return {
    language: 'nl',
    section: { id: 's1', name: 'CS1', epsg: 31370, lengthM: 400, startX: 0, startY: 0, endX: 400, endY: 0, viewState: null },
    columns: [
      { investigationId: 'c1', kind: 'cpt', name: 'GEO-16/095-S6', code: 'S6', projectKey: 'GEO-16/095', colourIndex: 0, alongM: 0, collarElevationM: 5, totalDepthM: 20, cptType: 'CPTU', plot: null, detail: null },
      { investigationId: 'c2', kind: 'cpt', name: 'GEO-16/095-S5', code: 'S5', projectKey: 'GEO-16/095', colourIndex: 0, alongM: 400, collarElevationM: 4, totalDepthM: 18, cptType: 'CPTU', plot: null, detail: null },
    ],
    regions: [
      { formation_id: 'f-sand', body_id: 'b1', gap_index: 0, polygon: [[0, 5], [1, 4], [1, -3], [0, -2]] },
      { formation_id: 'f-clay', body_id: 'b2', gap_index: 0, polygon: [[0, -2], [1, -3], [1, -15], [0, -15]] },
    ],
    units: [
      { formationId: 'f-sand', name: 'ZAND · Quartair', colour: '#e8c26a', displayOrder: 1 },
      { formationId: 'f-clay', name: 'KLEI · Quartair', colour: '#9db7c9', displayOrder: 2 },
    ],
    levelMaxM: 5.5, levelMinM: -15.5,
    map: { basemapId: 'osm', points: [], legend: [{ projectKey: 'GEO-16/095', colourIndex: 0, codes: ['S6', 'S5'] }] },
    settings: {
      fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1,
      fields: [{ label: 'Project', value: 'Kaai 1712' }, { label: 'Profiel', value: 'CS1' }, { label: 'Opdrachtgever', value: '' }, { label: 'Datum · Auteur', value: '2026-09-02' }],
    },
  }
}

describe('SectionSheet — the printed sheet is the on-screen partition', () => {
  it('draws one path per region, in unit colour, with no white column mask', () => {
    render(<SectionSheet payload={payload()} map={<div data-testid="map-slot" />} />)
    const paths = screen.getAllByTestId('sheet-region')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveAttribute('fill', '#e8c26a')
    expect(screen.queryAllByTestId('sheet-column-mask')).toHaveLength(0)
  })
  it('labels the ends A and A′ and the columns by short code', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('A′')).toBeInTheDocument()
    expect(screen.getByText('S6')).toBeInTheDocument()
  })
  it('renders the four fields, the scale line and the unit legend', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    expect(screen.getByText('Kaai 1712')).toBeInTheDocument()
    expect(screen.getByText('Opdrachtgever')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-scale-line').textContent).toMatch(/H 1:\d+/)
    expect(screen.getByText('KLEI · Quartair')).toBeInTheDocument()
  })
  it('sizes the page to the computed paper', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    const page = screen.getByTestId('sheet-page')
    expect(page.style.width).toBe('420mm')
    expect(page.style.height).toBe('297mm')
  })
})
```

- [ ] **Step 2: RED.** Run: `cd desktop && npx vitest run src/renderer/src/sheet/SectionSheet.test.tsx`

- [ ] **Step 3: TitleBlock**

```tsx
// desktop/src/renderer/src/sheet/TitleBlock.tsx
import type { SheetField } from './sheetPayload'

/** The four-field title block (spec "The sheet"). Labels are the engineer's own. */
export function TitleBlock({ fields, heightMm }: { fields: readonly SheetField[]; heightMm: number }): JSX.Element {
  return (
    <div
      data-testid="sheet-title-block"
      style={{ height: `${heightMm}mm`, border: '0.3pt solid #1f2933', display: 'grid', gridTemplateRows: 'repeat(4, 1fr)', fontSize: '9pt', lineHeight: 1.15 }}
    >
      {fields.map((f, i) => (
        <div key={i} style={{ padding: '1mm 1.5mm', borderBottom: i < 3 ? '0.3pt solid #1f2933' : 'none', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <span style={{ fontSize: '6pt', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a9098' }}>{f.label}</span>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.value}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: ProfileDrawing**

```tsx
// desktop/src/renderer/src/sheet/ProfileDrawing.tsx
/**
 * The SVG profile: fills (the screen's partition polygons), seams, column
 * hairlines with the qc trace or lithology strip ON the fill, both axes,
 * A / A′ and the column codes. Coordinates are CSS px at 96 dpi; the
 * geometry (Task 4) is in mm and converted here once.
 */
import { CptDataColumn } from '../components/sections/CptDataColumn'
import { BoreholeColumn } from '../components/sections/BoreholeColumn'
import { readBoreholeChannels, readCptChannels } from '../components/sections/cptChannels'
import { projectColour } from './projectPalette'
import { regionBounds, regionPathD } from './regionPath'
import {
  ALONG_BAND_MM, COLUMN_HALF_WIDTH_MM, LABEL_MIN_HEIGHT_PX, LABEL_MIN_WIDTH_PX, PX_PER_MM, TOP_BAND_MM,
} from './sheetConstants'
import type { SheetGeometry } from './sheetGeometry'
import type { SheetPayload } from './sheetPayload'

const INK = '#1f2933'

export function ProfileDrawing({ payload, geometry, mTawLabel }: {
  payload: SheetPayload; geometry: SheetGeometry; mTawLabel: string
}): JSX.Element {
  const g = geometry
  const widthPx = (g.drawingLeftMm + g.drawingWidthMm) * PX_PER_MM
  const topPx = TOP_BAND_MM * PX_PER_MM
  const heightPx = topPx + g.drawingHeightMm * PX_PER_MM + ALONG_BAND_MM * PX_PER_MM
  const scaleVpx = g.scaleVmmPerM * PX_PER_MM
  const levelToY = (level: number): number => topPx + (payload.levelMaxM - level) * scaleVpx
  const columnX = g.columnXmm.map(mm => mm * PX_PER_MM)
  const unitById = new Map(payload.units.map(u => [u.formationId, u]))
  const axisX = g.drawingLeftMm * PX_PER_MM
  const bottomY = levelToY(payload.levelMinM)
  const halfWidthPx = COLUMN_HALF_WIDTH_MM * PX_PER_MM
  const cptChannels = readCptChannels(payload.section.viewState)
  const boreholeChannels = readBoreholeChannels(payload.section.viewState)

  // Level ticks every 1, 2, 5, 10 or 20 m so there are at most 14 of them.
  const range = payload.levelMaxM - payload.levelMinM
  const step = [1, 2, 5, 10, 20].find(s => range / s <= 14) ?? 50
  const ticks: number[] = []
  for (let l = Math.ceil(payload.levelMinM / step) * step; l <= payload.levelMaxM; l += step) ticks.push(l)
  const alongStep = [10, 20, 50, 100, 200, 500].find(s => payload.section.lengthM / s <= 12) ?? 1000

  return (
    <svg data-testid="sheet-profile" width={widthPx} height={heightPx} viewBox={`0 0 ${widthPx} ${heightPx}`} style={{ display: 'block', fontFamily: 'inherit' }}>
      {/* fills — the partition, seams shared, nothing drawn over them but the logs */}
      {payload.regions.map((r, i) => {
        const unit = unitById.get(r.formation_id)
        return (
          <path key={i} data-testid="sheet-region" d={regionPathD(r, columnX, levelToY)} fill={unit?.colour ?? '#dddddd'} stroke={INK} strokeWidth={0.6} strokeLinejoin="round" />
        )
      })}
      {/* unit names inside big-enough regions */}
      {payload.regions.map((r, i) => {
        const b = regionBounds(r, columnX, levelToY)
        if (b.maxX - b.minX < LABEL_MIN_WIDTH_PX || b.maxY - b.minY < LABEL_MIN_HEIGHT_PX) return null
        const unit = unitById.get(r.formation_id)
        return (
          <text key={`l${i}`} x={(b.minX + b.maxX) / 2} y={(b.minY + b.maxY) / 2} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={INK} opacity={0.85}>
            {unit?.name ?? ''}
          </text>
        )
      })}
      {/* columns: hairline + log, drawn on the fill */}
      {payload.columns.map((c, i) => {
        const x = columnX[i]
        const y0 = levelToY(c.collarElevationM)
        const y1 = levelToY(c.collarElevationM - c.totalDepthM)
        return (
          <g key={c.investigationId}>
            <line x1={x} y1={y0} x2={x} y2={y1} stroke={INK} strokeWidth={0.5} opacity={0.55} />
            {c.kind === 'cpt' && c.plot && (
              <CptDataColumn plot={c.plot} cptType={c.cptType ?? 'CPT'} channels={cptChannels} halfWidth={halfWidthPx} screenX={x} surfaceElevationM={c.collarElevationM} plotTop={topPx} plotBottom={bottomY} levelToScreen={levelToY} showLabels={false} />
            )}
            {c.kind === 'borehole' && c.detail && (
              <BoreholeColumn detail={c.detail} channels={boreholeChannels} screenX={x} halfWidth={halfWidthPx} surfaceElevationM={c.collarElevationM} plotTop={topPx} plotBottom={bottomY} levelToScreen={levelToY} />
            )}
            <text x={x} y={topPx - 4} textAnchor="middle" fontSize={9} fontWeight={500} fill={projectColour(c.colourIndex)}>{c.code}</text>
          </g>
        )
      })}
      {/* axes */}
      <line x1={axisX} y1={topPx} x2={axisX} y2={bottomY} stroke={INK} strokeWidth={0.8} />
      {ticks.map(l => (
        <g key={l}>
          <line x1={axisX - 4} y1={levelToY(l)} x2={axisX} y2={levelToY(l)} stroke={INK} strokeWidth={0.6} />
          <text x={axisX - 6} y={levelToY(l)} textAnchor="end" dominantBaseline="middle" fontSize={7} fill={INK}>{l > 0 ? `+${l}` : String(l)}</text>
        </g>
      ))}
      <text x={axisX - 6} y={topPx - 6} textAnchor="end" fontSize={6.5} fill={INK}>{mTawLabel}</text>
      <line x1={axisX} y1={bottomY} x2={columnX[columnX.length - 1] ?? axisX} y2={bottomY} stroke={INK} strokeWidth={0.8} />
      {payload.columns.map((c, i) => (
        c.alongM % alongStep === 0 || i === 0 || i === payload.columns.length - 1
          ? <text key={`a${i}`} x={columnX[i]} y={bottomY + 12} textAnchor="middle" fontSize={7} fill={INK}>{Math.round(c.alongM)}{i === payload.columns.length - 1 ? ' m' : ''}</text>
          : null
      ))}
      {/* A / A′ */}
      <text x={axisX} y={12} fontSize={12} fontWeight={600} fill="#c8442b">A</text>
      <text x={columnX[columnX.length - 1] ?? axisX} y={12} textAnchor="end" fontSize={12} fontWeight={600} fill="#c8442b">A′</text>
    </svg>
  )
}
```

Check the exact prop lists of `CptDataColumn` (`CptDataColumn.tsx:72-124`) and `BoreholeColumn` (`BoreholeColumn.tsx:65-133`) before committing; every required prop must be passed, every optional one left at its default. If either component renders a white background rect behind its trace, pass the prop that disables it (`overlayMode`, `cardVeilOpacity={0}` on `CptDataColumn`; `logFillOpacity` on `BoreholeColumn`) — the spec forbids a white column mask.

- [ ] **Step 5: SectionSheet**

```tsx
// desktop/src/renderer/src/sheet/SectionSheet.tsx
/** The whole sheet at paper size. ``map`` is a slot so tests render without Leaflet. */
import type { ReactNode } from 'react'
import type { MessageKey } from '../i18n/locales/en'
import { translate, type MessageParams } from '../i18n/translate'
import { ProfileDrawing } from './ProfileDrawing'
import { projectColour, NO_PROJECT_KEY } from './projectPalette'
import {
  MAP_HEIGHT_MM, MAP_LEGEND_GAP_MM, MARGIN_MM, RIGHT_COLUMN_MM, SCALE_LINE_MM,
  TITLE_BLOCK_MM, UNIT_LEGEND_MM,
} from './sheetConstants'
import { computeSheetGeometry, type SheetGeometry } from './sheetGeometry'
import type { SheetPayload } from './sheetPayload'
import { TitleBlock } from './TitleBlock'

export function sheetGeometryOf(payload: SheetPayload): SheetGeometry {
  const s = payload.settings
  return computeSheetGeometry({
    levelMaxM: payload.levelMaxM, levelMinM: payload.levelMinM,
    columns: payload.columns.map(c => ({ id: c.investigationId, alongM: c.alongM })),
    scaleMode: s.scaleMode, hScale: s.hScale, vScale: s.vScale, vex: s.vex, spacing: s.spacing,
  })
}

function distanceKey(spacing: number): MessageKey {
  if (spacing >= 0.999) return 'sheet.distance.true'
  if (spacing <= 0.001) return 'sheet.distance.packed'
  return 'sheet.distance.between'
}

export function SectionSheet({ payload, map }: { payload: SheetPayload; map: ReactNode }): JSX.Element {
  const lang = payload.language
  const t = (key: MessageKey, params?: MessageParams): string => translate(lang, key, params)
  const g = sheetGeometryOf(payload)
  const units = [...payload.units].filter(u => payload.regions.some(r => r.formation_id === u.formationId)).sort((a, b) => a.displayOrder - b.displayOrder)
  const ink = '#1f2933'
  return (
    <div
      data-testid="sheet-page"
      style={{ position: 'relative', width: `${g.paperWidthMm}mm`, height: `${g.paperHeightMm}mm`, background: '#ffffff', color: ink, overflow: 'hidden', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}
    >
      <div style={{ position: 'absolute', inset: `${MARGIN_MM}mm`, border: '0.3pt solid #8a9098', pointerEvents: 'none' }} />
      {/* profile */}
      <div style={{ position: 'absolute', left: 0, top: `${MARGIN_MM}mm` }}>
        <ProfileDrawing payload={payload} geometry={g} mTawLabel={t('sheet.mTaw')} />
      </div>
      {/* unit legend */}
      <div data-testid="sheet-unit-legend" style={{ position: 'absolute', left: `${g.drawingLeftMm}mm`, width: `${g.drawingWidthMm}mm`, bottom: `${MARGIN_MM}mm`, height: `${UNIT_LEGEND_MM}mm`, display: 'flex', flexWrap: 'wrap', gap: '1mm 4mm', alignContent: 'center', fontSize: '8pt' }}>
        {units.map(u => (
          <span key={u.formationId} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
            <i style={{ width: '5mm', height: '3mm', background: u.colour, border: `0.3pt solid ${ink}` }} />{u.name}
          </span>
        ))}
      </div>
      {/* right column */}
      <div style={{ position: 'absolute', left: `${g.rightColumnLeftMm}mm`, top: `${MARGIN_MM}mm`, width: `${RIGHT_COLUMN_MM}mm`, height: `${g.paperHeightMm - 2 * MARGIN_MM}mm` }}>
        <div data-testid="sheet-map-box" style={{ height: `${MAP_HEIGHT_MM}mm`, border: `0.3pt solid ${ink}`, overflow: 'hidden', position: 'relative', background: '#f1efe8' }}>{map}</div>
        <div data-testid="sheet-project-legend" style={{ marginTop: `${MAP_LEGEND_GAP_MM}mm`, fontSize: '7.5pt', lineHeight: 1.35 }}>
          {payload.map.legend.map(row => (
            <div key={row.projectKey} style={{ display: 'flex', gap: '1.5mm', alignItems: 'baseline' }}>
              <i style={{ width: '2.5mm', height: '2.5mm', borderRadius: '50%', background: projectColour(row.colourIndex), border: `0.3pt solid ${ink}`, flex: 'none', transform: 'translateY(0.2mm)' }} />
              <span><b>{row.projectKey === NO_PROJECT_KEY ? t('sheet.legend.noProject') : row.projectKey}</b> <span style={{ color: '#5b6673', fontFamily: 'ui-monospace, monospace', fontSize: '7pt' }}>{row.codes.join(' · ')}</span></span>
            </div>
          ))}
          <div style={{ color: '#5b6673', fontSize: '6.5pt', marginTop: '1mm' }}>{t('sheet.legend.projects')}</div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${SCALE_LINE_MM}mm` }}>
          <TitleBlock fields={payload.settings.fields} heightMm={TITLE_BLOCK_MM} />
        </div>
        <div data-testid="sheet-scale-line" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, fontSize: '8pt', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre' }}>
          {t('sheet.scaleLine', { h: g.printedH, v: g.printedV, vex: Math.round(g.vexEffective * 10) / 10 })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: `${MARGIN_MM + 1}mm`, bottom: `${MARGIN_MM - 3.5}mm`, fontSize: '6.5pt', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a9098' }}>
        StrixGeo · {t(distanceKey(payload.settings.spacing))}
      </div>
    </div>
  )
}
```

`MessageParams` is exported from `i18n/translate.ts:27`; `MessageKey` from `i18n/locales/en`. If `translate`'s signature differs (`translate.ts:87`), adapt the `t` wrapper, not the call sites.

- [ ] **Step 6: GREEN.** Run the component test. Expected: 4 passed.

- [ ] **Step 7: Report** (4 files: TitleBlock, ProfileDrawing, SectionSheet, test).

---

### Task 10: The map

**Files:**
- Create: `desktop/src/renderer/src/sheet/SheetMap.tsx`

No unit test (Leaflet needs a real DOM box); covered by the e2e flow (offline path) and the owner's eyeball (online path). Pure parts are Task 5.

- [ ] **Step 1: Implement**

```tsx
// desktop/src/renderer/src/sheet/SheetMap.tsx
/**
 * Basemap + vector overlay for the sheet's map box (spec "The map").
 * Leaflet draws the tiles; the overlay (line A–A′, dots, codes, scale bar,
 * north arrow) is one SVG positioned over the box and re-laid on every
 * ``move`` so it prints as vectors. Reports ``onReady(offline)`` once tiles
 * loaded or ``TILE_WAIT_MS`` passed.
 */
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { lambertToWgs84 } from '../hooks/useWgs84'
import { basemapById } from '../utils/basemapSources'
import { computeMapExtent, pickScaleBarM } from './mapExtent'
import { projectColour } from './projectPalette'
import { TILE_WAIT_MS } from './sheetConstants'
import type { SheetPayload } from './sheetPayload'

const INK = '#1f2933'
const LINE = '#c8442b'

/** The tile provider's attribution as plain text — the print has no links to click. */
function attributionText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

export function SheetMap({ payload, offlineLabel, onReady }: {
  payload: SheetPayload; offlineLabel: string; onReady: (offline: boolean) => void
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [offline, setOffline] = useState(false)
  const [tick, setTick] = useState(0)
  const source = basemapById(payload.map.basemapId) ?? basemapById('osm')

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const map = L.map(el, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0,
    })
    mapRef.current = map
    let loaded = false
    let done = false
    const finish = (isOffline: boolean): void => {
      if (done) return
      done = true
      setOffline(isOffline)
      onReady(isOffline)
    }
    if (source) {
      const layer = L.tileLayer(source.url, { maxZoom: 19 })
      layer.on('load', () => { loaded = true; finish(false) })
      layer.on('tileerror', () => { if (!loaded) finish(true) })
      layer.addTo(map)
    } else {
      finish(true)
    }
    const timer = window.setTimeout(() => finish(!loaded), TILE_WAIT_MS)
    const extent = computeMapExtent([
      { x: payload.section.startX, y: payload.section.startY }, { x: payload.section.endX, y: payload.section.endY },
      ...payload.map.points.filter(p => p.onProfile).map(p => ({ x: p.worldX, y: p.worldY })),
    ])
    const sw = lambertToWgs84(extent.minX, extent.minY)
    const ne = lambertToWgs84(extent.maxX, extent.maxY)
    map.fitBounds(L.latLngBounds(L.latLng(sw[0], sw[1]), L.latLng(ne[0], ne[1])), { padding: [0, 0], animate: false })
    map.on('move zoom resize', () => setTick(v => v + 1))
    setTick(v => v + 1)
    return () => { window.clearTimeout(timer); map.remove(); mapRef.current = null }
    // reason: the map is created once per payload identity; every field the
    // effect reads is part of that payload, and re-running on onReady/source
    // identity would tear down the tiles mid-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  const map = mapRef.current
  const box = boxRef.current
  const toPx = (x: number, y: number): [number, number] => {
    if (!map) return [0, 0]
    const [lat, lng] = lambertToWgs84(x, y)
    const p = map.latLngToContainerPoint(L.latLng(lat, lng))
    return [p.x, p.y]
  }
  const w = box?.clientWidth ?? 0
  const h = box?.clientHeight ?? 0
  const a = toPx(payload.section.startX, payload.section.startY)
  const b = toPx(payload.section.endX, payload.section.endY)
  // px per 100 m from the fitted extent (Web-Mercator distortion is negligible at box scale).
  const east = toPx(payload.section.startX + 100, payload.section.startY)
  const pxPer100m = Math.max(1e-6, Math.hypot(east[0] - a[0], east[1] - a[1]))
  const barM = pickScaleBarM((w / pxPer100m) * 100)
  const barPx = (barM / 100) * pxPer100m

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
      <svg key={tick} data-testid="sheet-map-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={LINE} strokeWidth={2.4} />
        <text x={a[0] - 12} y={a[1] + 4} fontSize={11} fontWeight={600} fill={LINE}>A</text>
        <text x={b[0] + 4} y={b[1] - 4} fontSize={11} fontWeight={600} fill={LINE}>A′</text>
        {payload.map.points.map(p => {
          const [x, y] = toPx(p.worldX, p.worldY)
          return (
            <g key={p.investigationId} opacity={p.onProfile ? 1 : 0.5}>
              <circle cx={x} cy={y} r={p.onProfile ? 3.2 : 2.6} fill={projectColour(p.colourIndex)} stroke={INK} strokeWidth={0.6} />
              <text x={x + 4.5} y={y - 3} fontSize={8} fontWeight={500} fill={INK}>{p.code}</text>
            </g>
          )
        })}
        <g transform={`translate(8 ${h - 10})`} fontSize={7} fill={INK}>
          <rect x={0} y={0} width={barPx / 2} height={3} fill={INK} />
          <rect x={barPx / 2} y={0} width={barPx / 2} height={3} fill="#fff" stroke={INK} strokeWidth={0.5} />
          <text x={0} y={-2}>0</text><text x={barPx / 2 - 6} y={-2}>{barM / 2}</text><text x={barPx - 8} y={-2}>{barM} m</text>
        </g>
        <g transform={`translate(${w - 14} ${h - 24})`} fill={INK}>
          <polygon points="0,-11 4,4 0,1 -4,4" />
          <text x={-3.5} y={14} fontSize={8} fontWeight={600}>N</text>
        </g>
        {offline && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={8} fill="#5b6673">{offlineLabel}</text>}
      </svg>
      {source?.attribution && (
        <div style={{ position: 'absolute', right: 2, bottom: 1, fontSize: '5pt', color: '#5b6673', background: 'rgba(255,255,255,.7)', padding: '0 2px' }}>
          {attributionText(source.attribution)}
        </div>
      )}
    </div>
  )
}
```

Check `BasemapSource` for the exact field names (`url`, `attribution`, and whether it carries a `maxZoom` — `basemapSources.ts:54-64`); use its `maxZoom` when present.

- [ ] **Step 2: Type-check.** Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`. Expected: 0 errors.
- [ ] **Step 3: Report.**

---

### Task 11: The sheet page entry

**Files:**
- Create: `desktop/src/renderer/sheet.html`
- Create: `desktop/src/renderer/src/sheet/main.tsx`
- Create (move): `desktop/src/renderer/src/electronApi.d.ts` — the `declare global { interface Window { electron: … } }` block that lives in `App.tsx` today, cut verbatim and extended with the three sheet members, so both entries share one declaration
- Modify: `desktop/electron-vite.config.ts` (renderer `build.rollupOptions.input` gains `sheet`)
- Modify: `desktop/src/preload/index.ts` (add `onSheetPayload`, `sheetReady`, `printSheetPdf`)

- [ ] **Step 1: The HTML entry**

```html
<!-- desktop/src/renderer/sheet.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StrixGeo sheet</title>
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
      @page { margin: 0; }
    </style>
  </head>
  <body>
    <div id="sheet-root"></div>
    <script type="module" src="./src/sheet/main.tsx"></script>
  </body>
</html>
```

Copy any `<meta http-equiv="Content-Security-Policy">` line `index.html` carries, verbatim, so tile hosts and inline styles are allowed identically.

- [ ] **Step 2: The entry script**

```tsx
// desktop/src/renderer/src/sheet/main.tsx
/**
 * The sheet page. Waits for a ``SheetPayloadMessage`` — from the preview
 * dialog's ``postMessage`` (iframe) or from the main process relay (print
 * window) — renders the sheet, and reports ``sheet:ready`` back the same way
 * once fonts and tiles are settled (or the tile wait expired).
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { translate } from '../i18n/translate'
import { SectionSheet, sheetGeometryOf } from './SectionSheet'
import { SheetMap } from './SheetMap'
import type { SheetPayload, SheetPayloadMessage, SheetReadyMessage } from './sheetPayload'

function isPayloadMessage(data: unknown): data is SheetPayloadMessage {
  return !!data && typeof data === 'object' && (data as SheetPayloadMessage).type === 'sheet:payload'
}

function report(msg: SheetReadyMessage): void {
  if (window.parent !== window) window.parent.postMessage(msg, '*')
  window.electron?.sheetReady?.(msg)
}

function SheetApp(): JSX.Element | null {
  const [payload, setPayload] = useState<SheetPayload | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => { if (isPayloadMessage(e.data)) setPayload(e.data.payload) }
    window.addEventListener('message', onMessage)
    const off = window.electron?.onSheetPayload?.(p => setPayload(p))
    return () => { window.removeEventListener('message', onMessage); off?.() }
  }, [])
  if (!payload) return null
  const g = sheetGeometryOf(payload)
  const onReady = (offline: boolean): void => {
    void document.fonts.ready.then(() => report({ type: 'sheet:ready', paperWidthMm: g.paperWidthMm, paperHeightMm: g.paperHeightMm, offline }))
  }
  return (
    <SectionSheet
      payload={payload}
      map={<SheetMap payload={payload} offlineLabel={translate(payload.language, 'sheet.map.offline')} onReady={onReady} />}
    />
  )
}

createRoot(document.getElementById('sheet-root')!).render(<StrictMode><SheetApp /></StrictMode>)
```

- [ ] **Step 3: Preload additions** (next to `writeExportFile`, `desktop/src/preload/index.ts:93`)

```ts
  // Cross-section sheet (PDF). ``printSheetPdf`` hands the payload to the main
  // process, which renders sheet.html in a hidden window and prints it;
  // ``onSheetPayload`` / ``sheetReady`` are the hidden window's side of that.
  printSheetPdf: (payload: unknown): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('sheet:print-pdf', payload),
  onSheetPayload: (cb: (payload: never) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: never): void => cb(payload)
    ipcRenderer.on('sheet:payload', handler)
    return () => ipcRenderer.removeListener('sheet:payload', handler)
  },
  sheetReady: (msg: unknown): void => ipcRenderer.send('sheet:ready', msg),
```

In `electronApi.d.ts` type them as `printSheetPdf(payload: SheetPayload): Promise<ArrayBuffer>`, `onSheetPayload(cb: (payload: SheetPayload) => void): () => void`, `sheetReady(msg: SheetReadyMessage): void`, importing the types from `./sheet/sheetPayload` (a `.d.ts` may `import type`).

- [ ] **Step 4: Vite input**

In `desktop/electron-vite.config.ts` renderer `build.rollupOptions.input`, add `sheet: resolve(__dirname, 'src/renderer/sheet.html')` beside `index`.

- [ ] **Step 5: Build check**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json && npx electron-vite build 2>&1 | tail -5`
Expected: 0 errors; `out/renderer/sheet.html` exists.

- [ ] **Step 6: Report** (5 files).

---

### Task 12: Payload builder on the Sections stage

**Files:**
- Create: `desktop/src/renderer/src/components/sections/fetchSectionLogs.ts` (lifted from `useSectionData.ts:284-370`)
- Modify: `desktop/src/renderer/src/components/sections/useSectionData.ts` (call the lifted helper; behaviour byte-identical)
- Create: `desktop/src/renderer/src/shell/stages/sections/useSectionExportInputs.ts` (lifted from `useDseriesExportItems.tsx:12-60`)
- Modify: `desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx` (consume the lifted hook)
- Create: `desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts`
- Test: `desktop/src/renderer/src/shell/stages/sections/buildSheetPayload.test.ts` (the pure assembly)

- [ ] **Step 1: Lift the log fetches.** Move the code that fills `cptPlots` and `boreholeDetails` in `useSectionData.ts` into:

```ts
// desktop/src/renderer/src/components/sections/fetchSectionLogs.ts
import { api } from '../../api'
import type { BoreholeDetailResponse } from '../../api/clients/borehole'
import type { CptPlotResponse } from '../../api/clients/cpt'

/** The plot + detail fetches the section panel makes; the sheet builder makes the same ones. */
export async function fetchSectionLogs(
  projectId: string,
  cptIds: readonly string[],
  boreholeIds: readonly string[],
): Promise<{ cptPlots: Map<string, CptPlotResponse>; boreholeDetails: Map<string, BoreholeDetailResponse> }> {
  // Body = the exact calls useSectionData.ts:284-370 makes today (same client
  // methods, same concurrency), returning the two maps keyed by id. Cut, do
  // not rewrite; useSectionData then awaits this helper and sets its state.
}
```

Fill the body by cutting the existing code; `useSectionData` then awaits this helper. Run the existing tests: `npx vitest run src/renderer/src/components/sections` — all green before moving on.

- [ ] **Step 2: Lift the export inputs.** Move the `investigations` and `packingClassOf` memos (`useDseriesExportItems.tsx:27-60`) into `useSectionExportInputs.ts` returning `{ project, investigations, packingClassOf, lithoLayers, geotechLayers, activeLithoModel, visibleCpts, visibleBoreholes, axisFormations }`; `axisFormations` = the same expression `SectionsCanvas.tsx:1689` uses (`isLitho ? lithoFormations : isGeotech ? geotechFormations : formations`, all from `useShell().geoModel`). `useDseriesExportItems` consumes it. Run `npx vitest run src/renderer/src/shell/stages/sections` — green.

- [ ] **Step 3: Failing test for the pure assembly**

```ts
// desktop/src/renderer/src/shell/stages/sections/buildSheetPayload.test.ts
import { describe, expect, it } from 'vitest'
import type { SheetSettings } from '../../../sheet/sheetPayload'
import { assembleSheetPayload } from './useSheetPayload'

describe('assembleSheetPayload — the sheet is built from the drawn partition', () => {
  const partition = {
    start_x: 0, start_y: 0, end_x: 400, end_y: 0,
    columns: [
      { investigation_id: 'b', along_m: 400, world_x: 400, world_y: 0 },
      { investigation_id: 'a', along_m: 0, world_x: 0, world_y: 0 },
    ],
    regions: [{ formation_id: 'f1', body_id: null, gap_index: 0, polygon: [[0, 4], [1, 3], [1, -10], [0, -9]] as [number, number][] }],
  }
  const investigations = [
    { id: 'a', kind: 'cpt' as const, name: 'GEO-1/1-S6', location_x: 0, location_y: 0, elevation_m: 5, total_depth_m: 20, cpt_type: 'CPTU' },
    { id: 'b', kind: 'cpt' as const, name: 'GEO-1/1-S5', location_x: 400, location_y: 0, elevation_m: 4, total_depth_m: 18, cpt_type: 'CPTU' },
    { id: 'c', kind: 'borehole' as const, name: 'GEO-2/2-B4', location_x: 200, location_y: 150, elevation_m: 5, total_depth_m: 10, cpt_type: null },
  ]
  const base = {
    language: 'nl' as const,
    section: { id: 's', name: 'CS1', epsg: 31370, start_x: 0, start_y: 0, end_x: 400, end_y: 0, view_state: null },
    partition, investigations, cptPlots: new Map(), boreholeDetails: new Map(),
    units: [{ id: 'f1', name: 'ZAND', color: '#e8c26a', display_order: 1 }],
    basemapId: 'osm',
    settings: { fill: 'litho' as const, scaleMode: 'fit' as const, hScale: null, vScale: null, vex: 5, spacing: 1, fields: [{ label: 'a', value: '' }, { label: 'b', value: '' }, { label: 'c', value: '' }, { label: 'd', value: '' }] as SheetSettings['fields'] },
  }
  it('orders columns by along, codes them, colours by project, pads the level range', () => {
    const p = assembleSheetPayload(base)
    expect(p.columns.map(c => c.code)).toEqual(['S6', 'S5'])
    expect(p.columns[0].colourIndex).toBe(0)
    expect(p.levelMaxM).toBeCloseTo(5.5)      // highest collar 5 + 0.5
    expect(p.levelMinM).toBeCloseTo(-15.5)    // deepest column base 5 − 20 = −15, minus 0.5
    expect(p.regions).toBe(partition.regions)
  })
  it('the map carries every investigation, on-profile ones flagged, second project second colour', () => {
    const p = assembleSheetPayload(base)
    const byId = new Map(p.map.points.map(pt => [pt.investigationId, pt]))
    expect(byId.get('a')?.onProfile).toBe(true)
    expect(byId.get('c')?.onProfile).toBe(false)
    expect(byId.get('c')?.colourIndex).toBe(1)
    expect(p.map.legend.map(r => r.projectKey)).toEqual(['GEO-1/1', 'GEO-2/2'])
    expect(p.map.legend[0].codes).toEqual(['S6', 'S5'])
  })
})
```

Level rule: `levelMaxM = max(collar of on-profile columns, max region elevation) + LEVEL_PAD_M`; `levelMinM = min(collar − depth of on-profile columns, min region elevation) − LEVEL_PAD_M`.

- [ ] **Step 4: RED.** Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/buildSheetPayload.test.ts`

- [ ] **Step 5: Implement the builder**

```ts
// desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts
/**
 * Assembles the ``SheetPayload`` from what the Sections stage already has:
 * the drawn partition (``buildSectionExportPartition`` — the D-Series path),
 * the column logs (the panel's own fetches), the axis formations, and every
 * investigation for the map. ``assembleSheetPayload`` is pure and tested;
 * ``useSheetPayload`` is the thin async hook around it.
 */
import { useCallback } from 'react'
import type { BoreholeDetailResponse } from '../../../api/clients/borehole'
import type { CptPlotResponse } from '../../../api/clients/cpt'
import type { CrossSectionResponse } from '../../../api/clients/section'
import { fetchSectionLogs } from '../../../components/sections/fetchSectionLogs'
import { getLanguage } from '../../../i18n/languageSelect'
import { LEVEL_PAD_M } from '../../../sheet/sheetConstants'
import { splitInvestigationName } from '../../../sheet/investigationName'
import { assignProjectColours, normaliseProjectKey } from '../../../sheet/projectPalette'
import type { SheetColumn, SheetMapPoint, SheetPayload, SheetProjectLegendRow, SheetSettings } from '../../../sheet/sheetPayload'
import type { SectionPartitionInput } from '../../../utils/buildVoxelRequest'
import { readBasemapId } from '../../../utils/basemapSources'
import { buildSectionExportPartition } from './buildSectionExportPartition'
import { useSectionExportInputs } from './useSectionExportInputs'

export interface SheetInvestigation {
  id: string; kind: 'cpt' | 'borehole'; name: string
  location_x: number; location_y: number; elevation_m: number | null; total_depth_m: number | null; cpt_type: string | null
}

export interface AssembleInput {
  language: 'en' | 'nl'
  section: { id: string; name: string; epsg: number; start_x: number; start_y: number; end_x: number; end_y: number; view_state: Record<string, unknown> | null }
  partition: SectionPartitionInput
  investigations: readonly SheetInvestigation[]
  cptPlots: ReadonlyMap<string, CptPlotResponse>
  boreholeDetails: ReadonlyMap<string, BoreholeDetailResponse>
  units: readonly { id: string; name: string; color: string; display_order: number }[]
  basemapId: string
  settings: SheetSettings
}

export function assembleSheetPayload(input: AssembleInput): SheetPayload {
  const byId = new Map(input.investigations.map(i => [i.id, i]))
  const columnsSorted = [...input.partition.columns].sort((a, b) => a.along_m - b.along_m)
  const onProfileIds = new Set(columnsSorted.map(c => c.investigation_id))
  const keyOf = (id: string): string => splitInvestigationName(byId.get(id)?.name ?? '').projectKey
  const keysInOrder = [
    ...columnsSorted.map(c => keyOf(c.investigation_id)),
    ...input.investigations.filter(i => !onProfileIds.has(i.id)).map(i => keyOf(i.id)),
  ]
  const colourOf = assignProjectColours(keysInOrder)
  const columns: SheetColumn[] = columnsSorted.map(c => {
    const inv = byId.get(c.investigation_id)
    const { projectKey, code } = splitInvestigationName(inv?.name ?? c.investigation_id)
    return {
      investigationId: c.investigation_id, kind: inv?.kind ?? 'cpt', name: inv?.name ?? c.investigation_id, code, projectKey,
      colourIndex: colourOf.get(normaliseProjectKey(projectKey)) ?? 0, alongM: c.along_m,
      collarElevationM: inv?.elevation_m ?? 0, totalDepthM: inv?.total_depth_m ?? 0, cptType: inv?.cpt_type ?? null,
      plot: input.cptPlots.get(c.investigation_id) ?? null, detail: input.boreholeDetails.get(c.investigation_id) ?? null,
    }
  })
  const regionLevels = input.partition.regions.flatMap(r => r.polygon.map(p => p[1]))
  const levelMaxM = Math.max(...columns.map(c => c.collarElevationM), ...regionLevels) + LEVEL_PAD_M
  const levelMinM = Math.min(...columns.map(c => c.collarElevationM - c.totalDepthM), ...regionLevels) - LEVEL_PAD_M
  const points: SheetMapPoint[] = input.investigations.map(i => {
    const { projectKey, code } = splitInvestigationName(i.name)
    return { investigationId: i.id, kind: i.kind, code, colourIndex: colourOf.get(normaliseProjectKey(projectKey)) ?? 0, worldX: i.location_x, worldY: i.location_y, onProfile: onProfileIds.has(i.id) }
  })
  const legend: SheetProjectLegendRow[] = [...colourOf.entries()].map(([projectKey, colourIndex]) => ({
    projectKey, colourIndex,
    codes: [
      ...columns.filter(c => normaliseProjectKey(c.projectKey) === projectKey).map(c => c.code),
      ...points.filter(p => !p.onProfile && normaliseProjectKey(keyOf(p.investigationId)) === projectKey).map(p => p.code),
    ],
  }))
  const lengthM = Math.hypot(input.section.end_x - input.section.start_x, input.section.end_y - input.section.start_y)
  return {
    language: input.language,
    section: { id: input.section.id, name: input.section.name, epsg: input.section.epsg, lengthM, startX: input.section.start_x, startY: input.section.start_y, endX: input.section.end_x, endY: input.section.end_y, viewState: input.section.view_state },
    columns, regions: input.partition.regions,
    units: input.units.map(u => ({ formationId: u.id, name: u.name, colour: u.color, displayOrder: u.display_order })),
    levelMaxM, levelMinM,
    map: { basemapId: input.basemapId, points, legend },
    settings: input.settings,
  }
}

/** Returns ``null`` when the axis has nothing drawn (the dialog then disables Export). */
export function useSheetPayload(params: {
  axisModel: { id: string } | null; selectedSection: CrossSectionResponse | null; isGeotech: boolean
}): (settings: SheetSettings) => Promise<SheetPayload | null> {
  const inputs = useSectionExportInputs(params)
  return useCallback(async (settings: SheetSettings): Promise<SheetPayload | null> => {
    const { project } = inputs
    const selectedSection = params.selectedSection
    if (!project || !selectedSection || !params.axisModel) return null
    const partition = await buildSectionExportPartition({
      projectId: project.id, modelId: params.axisModel.id, section: selectedSection, investigations: inputs.investigations,
      layers: params.isGeotech ? inputs.geotechLayers : inputs.lithoLayers, viewState: project.view_state, logLabel: 'section-sheet',
      frameModelId: params.isGeotech ? (inputs.activeLithoModel?.id ?? null) : null,
      frameLayers: params.isGeotech ? inputs.lithoLayers : undefined,
      packingClassOf: params.isGeotech ? inputs.packingClassOf : undefined,
    })
    if (!partition || partition.regions.length === 0) return null
    const ids = new Set(partition.columns.map(c => c.investigation_id))
    const cptIds = inputs.visibleCpts.filter(c => ids.has(c.id)).map(c => c.id)
    const bhIds = inputs.visibleBoreholes.filter(b => ids.has(b.id)).map(b => b.id)
    const logs = await fetchSectionLogs(project.id, cptIds, bhIds)
    const investigations: SheetInvestigation[] = [
      ...inputs.visibleCpts.map(c => ({ id: c.id, kind: 'cpt' as const, name: c.name, location_x: c.location_x, location_y: c.location_y, elevation_m: c.elevation_m, total_depth_m: c.max_depth_m, cpt_type: c.cpt_type })),
      ...inputs.visibleBoreholes.map(b => ({ id: b.id, kind: 'borehole' as const, name: b.name, location_x: b.location_x, location_y: b.location_y, elevation_m: b.elevation_m, total_depth_m: b.total_depth_m, cpt_type: null })),
    ]
    return assembleSheetPayload({
      language: getLanguage(), section: selectedSection, partition, investigations,
      cptPlots: logs.cptPlots, boreholeDetails: logs.boreholeDetails, units: inputs.axisFormations, basemapId: readBasemapId(), settings,
    })
  }, [inputs, params.axisModel, params.selectedSection, params.isGeotech])
}
```

`getLanguage()` (`i18n/languageSelect.ts`) returns the app language; an async builder cannot use the `useT` hook, so the plain getter is right here. Match `useSectionExportInputs`'s parameter shape to what `useDseriesExportItems` already receives (`axisModel`, `selectedSection`, `isGeotech`). The map's investigation set is every visible CPT + borehole of the project; the map extent (Task 5) only fits the on-profile ones, so a far-away test simply falls outside the box.

- [ ] **Step 6: GREEN.** Expected: 2 passed, and `npx vitest run src/renderer/src/components/sections src/renderer/src/shell/stages/sections` still green.
- [ ] **Step 7: Report** (6 files).

---

### Task 13: Main-process print pipeline

**Files:**
- Create: `desktop/src/main/sheetPdf.ts`
- Modify: `desktop/src/main/index.ts` (call `registerSheetPdfIpc(log)` next to the `export:*` handlers, ~line 1065)

- [ ] **Step 1: Implement**

```ts
// desktop/src/main/sheetPdf.ts
/**
 * ``sheet:print-pdf``: render sheet.html in a hidden window with the given
 * payload and print it through Chromium (spec "Print pipeline"). The renderer
 * keeps the save dialog + atomic write; this only returns bytes.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

const PRINT_TIMEOUT_MS = 30_000
const MM_PER_INCH = 25.4

type Log = (level: 'info' | 'warn' | 'error', msg: string) => void

interface ReadyMessage { type: 'sheet:ready'; paperWidthMm: number; paperHeightMm: number; offline: boolean }

function sheetTarget(): { kind: 'url'; url: string } | { kind: 'file'; path: string } {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev
    ? { kind: 'url', url: `${dev.replace(/\/$/, '')}/sheet.html` }
    : { kind: 'file', path: join(__dirname, '../renderer/sheet.html') }
}

export async function printSheetToPdf(payload: unknown, log: Log): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false, width: 1600, height: 1200,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false },
  })
  const wc = win.webContents
  try {
    const ready = new Promise<ReadyMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('sheet:ready', onReady)
        reject(new Error(`sheet did not become ready within ${PRINT_TIMEOUT_MS} ms`))
      }, PRINT_TIMEOUT_MS)
      const onReady = (event: Electron.IpcMainEvent, msg: ReadyMessage): void => {
        if (event.sender.id !== wc.id) return
        clearTimeout(timer)
        ipcMain.removeListener('sheet:ready', onReady)
        resolve(msg)
      }
      ipcMain.on('sheet:ready', onReady)
    })
    wc.once('did-finish-load', () => { wc.send('sheet:payload', payload) })
    const target = sheetTarget()
    if (target.kind === 'url') await win.loadURL(target.url)
    else await win.loadFile(target.path)
    const msg = await ready
    log('info', `sheet ready ${msg.paperWidthMm}×${msg.paperHeightMm} mm offline=${msg.offline}`)
    const pdf = await wc.printToPDF({
      pageSize: { width: msg.paperWidthMm / MM_PER_INCH, height: msg.paperHeightMm / MM_PER_INCH },
      printBackground: true,
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: false,
    })
    log('info', `sheet pdf ${pdf.byteLength} bytes`)
    return pdf
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export function registerSheetPdfIpc(log: Log): void {
  ipcMain.handle('sheet:print-pdf', async (_event, payload: unknown): Promise<ArrayBuffer> => {
    const buf = await printSheetToPdf(payload, log)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
}
```

Use the main process's existing logger for `log` (the same function the other IPC handlers call — `grep -n "^const log\|function log" desktop/src/main/index.ts`). Electron 42's `printToPDF` `pageSize` object takes inches (`Electron.PrintToPDFOptions`); if tsc rejects the shape, read `node_modules/electron/electron.d.ts` for `PrintToPDFOptions.pageSize` and adapt — never drop the custom size.

- [ ] **Step 2: Register** in `index.ts` beside the `export:*` handlers: `registerSheetPdfIpc(log)`.
- [ ] **Step 3: Type-check node.** Run: `cd desktop && npx tsc --noEmit -p tsconfig.node.json`. Expected: 0 errors.
- [ ] **Step 4: Report** (2 files).

---

### Task 14: Preview dialog and wiring

**Files:**
- Create: `desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts:131-161` (replace the metadata dialog state with `sheetDialogOpen`)
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbarDialogs.tsx:116-121` (mount `SheetPreviewDialog` instead of `ReportMetadataDialog`)
- Modify: `desktop/src/renderer/src/shell/stages/sections/sectionsTailToolbarItems.tsx:183-186` (item opens the sheet dialog; label `sections.export.sectionPdf` stays)
- Modify: `desktop/src/renderer/src/api/clients/section.ts:226-238` (delete `exportPdf`)
- Modify: `desktop/src/renderer/src/App.tsx:1009-1049` (delete `handleExportSectionPdf` and its prop threading, `:1306`)
- Delete: `desktop/src/renderer/src/components/ReportMetadataDialog.tsx` (+ its test if present)

- [ ] **Step 1: The dialog**

```tsx
// desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx
/**
 * Preview + controls for the cross-section PDF sheet (spec "Preview dialog").
 * The sheet itself renders in an iframe on sheet.html; every control change
 * posts a fresh payload, so the preview IS the print.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../api'
import type { CrossSectionResponse } from '../../../api/clients/section'
import { useT } from '../../../i18n/translate'
import { PX_PER_MM } from '../../../sheet/sheetConstants'
import { sheetGeometryOf } from '../../../sheet/SectionSheet'
import type { SheetPayload, SheetSettings } from '../../../sheet/sheetPayload'
import { defaultSheetSettings, readSheetSettings, writeSheetSettings } from '../../../sheet/sheetSettings'
import { log } from '../../../utils/log'
import { useShell } from '../../ShellContext'
import { useSheetPayload } from './useSheetPayload'

export interface SheetPreviewDialogProps {
  open: boolean
  onClose: () => void
  section: CrossSectionResponse | null
  axisModel: { id: string } | null
  isGeotech: boolean
  hasGeotechModel: boolean
}

export function SheetPreviewDialog(p: SheetPreviewDialogProps): JSX.Element | null {
  const t = useT()
  const { project, toasts: { toast } } = useShell()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState<SheetSettings | null>(null)
  const [payload, setPayload] = useState<SheetPayload | null>(null)
  const [busy, setBusy] = useState<'build' | 'print' | null>(null)
  const [noFill, setNoFill] = useState(false)
  const [zoom, setZoom] = useState(0.5)
  const build = useSheetPayload({ axisModel: p.axisModel, selectedSection: p.section, isGeotech: p.isGeotech })

  // Seed settings from the section on open.
  useEffect(() => {
    if (!p.open || !p.section || !project) { setSettings(null); setPayload(null); return }
    const spacingRaw = p.section.view_state?.column_spacing
    const fallback = defaultSheetSettings({
      fill: p.isGeotech ? 'geotech' : 'litho',
      vex: p.section.vertical_exaggeration,
      spacing: typeof spacingRaw === 'number' ? spacingRaw : 1,
      projectName: project.name, sectionName: p.section.name, today: new Date().toISOString().slice(0, 10),
      labels: { project: t('sheet.field.project'), profile: t('sheet.field.profile'), client: t('sheet.field.client'), dateAuthor: t('sheet.field.dateAuthor') },
    })
    setSettings(readSheetSettings(p.section.view_state, fallback))
    // reason: ``t`` is stable per language; re-seeding on a language switch
    // mid-dialog would discard the engineer's typed fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, p.section?.id, project?.id])

  // Rebuild the payload when the fill axis changes (the only setting that changes geometry).
  const fill = settings?.fill ?? null
  useEffect(() => {
    if (!settings || fill === null) return
    let cancelled = false
    setBusy('build')
    build(settings)
      .then(pl => { if (!cancelled) { setNoFill(pl === null); setPayload(pl) } })
      .catch(err => { if (!cancelled) { log.error('sheet', 'payload build failed', err); toast('error', err instanceof Error ? err.message : t('sheet.exportFailed')) } })
      .finally(() => { if (!cancelled) setBusy(null) })
    return () => { cancelled = true }
    // reason: only the axis changes what is drawn; every other setting is
    // applied by re-posting the same payload below, without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill, build])

  // The live payload = built geometry + current settings; posted into the iframe on every change.
  const live = useMemo<SheetPayload | null>(() => (payload && settings ? { ...payload, settings } : null), [payload, settings])
  const post = useCallback((): void => {
    const w = iframeRef.current?.contentWindow
    if (w && live) w.postMessage({ type: 'sheet:payload', payload: live }, '*')
  }, [live])
  useEffect(post, [post])
  const geometry = live ? sheetGeometryOf(live) : null

  // Fit the sheet into the left pane.
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || !geometry) return
    const fit = (): void => {
      const w = geometry.paperWidthMm * PX_PER_MM, h = geometry.paperHeightMm * PX_PER_MM
      setZoom(Math.min((pane.clientWidth - 32) / w, (pane.clientHeight - 32) / h, 1))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(pane)
    return () => ro.disconnect()
  }, [geometry?.paperWidthMm, geometry?.paperHeightMm])

  const persist = useCallback(async (): Promise<void> => {
    if (!settings || !p.section || !project) return
    await api.section.update(project.id, p.section.id, { view_state: writeSheetSettings(p.section.view_state, settings) })
  }, [settings, p.section, project])

  const close = useCallback((): void => { void persist(); p.onClose() }, [persist, p])

  const exportPdf = useCallback(async (): Promise<void> => {
    if (!live || !p.section || busy) return
    setBusy('print')
    try {
      await persist()
      const safe = p.section.name.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'section'
      const path = await window.electron.showExportSaveDialog(`${safe} – ${t('sheet.fileSuffix')}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
      if (path === null) return
      const bytes = await window.electron.printSheetPdf(live)
      await window.electron.writeExportFile(path, bytes)
      log.success('sheet', `pdf ok section=${p.section.id} bytes=${bytes.byteLength} path=${path}`)
      toast('success', t('sheet.exported'))
    } catch (err) {
      log.error('sheet', 'pdf export failed', err)
      toast('error', err instanceof Error ? err.message : t('sheet.exportFailed'))
    } finally { setBusy(null) }
  }, [live, p.section, busy, persist, t, toast])

  useEffect(() => {
    if (!p.open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.open, close])

  if (!p.open || !settings) return null
  const set = (patch: Partial<SheetSettings>): void => setSettings(s => (s ? { ...s, ...patch } : s))
  const setField = (i: number, patch: Partial<{ label: string; value: string }>): void =>
    setSettings(s => {
      if (!s) return s
      const fields = [...s.fields] as SheetSettings['fields']
      fields[i] = { ...fields[i], ...patch }
      return { ...s, fields }
    })
  const overCap = geometry?.overCap ?? false
  const exportDisabled = busy !== null || noFill || overCap || !live
  const sheetSrc = new URL('sheet.html', window.location.href).toString()

  return (
    <div role="dialog" aria-modal="true" aria-label={t('sheet.title')} data-testid="sheet-preview-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[92vh] w-[95vw] overflow-hidden rounded-md bg-white shadow-xl dark:bg-neutral-900">
        <div className="flex min-w-0 flex-1 flex-col bg-neutral-200 dark:bg-neutral-800">
          <div ref={paneRef} className="relative min-h-0 flex-1 overflow-hidden">
            <iframe
              ref={iframeRef}
              title={t('sheet.title')}
              src={sheetSrc}
              onLoad={post}
              data-testid="sheet-preview-frame"
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: geometry ? `${geometry.paperWidthMm}mm` : '420mm',
                height: geometry ? `${geometry.paperHeightMm}mm` : '297mm',
                border: 0, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.3)',
                transform: `translate(-50%, -50%) scale(${zoom})`, transformOrigin: 'center',
              }}
            />
          </div>
          <div data-testid="sheet-paper-size" className={`px-4 py-2 text-sm ${overCap ? 'text-amber-700' : 'text-neutral-600 dark:text-neutral-300'}`}>
            {geometry ? t('sheet.paperSize', { w: geometry.paperWidthMm, h: geometry.paperHeightMm }) : ''}
            {overCap && geometry ? ` — ${t('sheet.tooWide', { w: geometry.paperWidthMm })}` : ''}
            {noFill ? ` — ${t('sheet.noFill')}` : ''}
          </div>
        </div>
        <aside className="flex w-80 flex-none flex-col gap-4 overflow-y-auto border-l border-neutral-200 p-4 text-sm dark:border-neutral-700">
          <h2 className="text-base font-semibold">{t('sheet.title')}</h2>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t('sheet.fill')}</legend>
            <label><input type="radio" name="sheet-fill" checked={settings.fill === 'litho'} onChange={() => set({ fill: 'litho' })} /> {t('sheet.fill.litho')}</label>
            <label><input type="radio" name="sheet-fill" checked={settings.fill === 'geotech'} disabled={!p.hasGeotechModel} onChange={() => set({ fill: 'geotech' })} /> {t('sheet.fill.geotech')}</label>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t('sheet.scaleMode')}</legend>
            <label><input type="radio" name="sheet-scale" checked={settings.scaleMode === 'fit'} onChange={() => set({ scaleMode: 'fit' })} /> {t('sheet.scaleMode.fit')}</label>
            <label>
              <input type="radio" name="sheet-scale" checked={settings.scaleMode === 'explicit'} onChange={() => set({ scaleMode: 'explicit', hScale: settings.hScale ?? geometry?.printedH ?? 1000, vScale: settings.vScale ?? geometry?.printedV ?? 200 })} /> {t('sheet.scaleMode.explicit')}
            </label>
            {settings.scaleMode === 'explicit' && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label>{t('sheet.hScale')} <input type="number" min={1} value={settings.hScale ?? ''} onChange={e => set({ hScale: Number(e.target.value) || null })} className="w-full" data-testid="sheet-h-scale" /></label>
                <label>{t('sheet.vScale')} <input type="number" min={1} value={settings.vScale ?? ''} onChange={e => set({ vScale: Number(e.target.value) || null })} className="w-full" data-testid="sheet-v-scale" /></label>
              </div>
            )}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span>{t('sheet.vex')} <b>{settings.scaleMode === 'explicit' && geometry ? Math.round(geometry.vexEffective * 10) / 10 : settings.vex}×</b></span>
            <input type="range" min={1} max={20} step={0.5} value={settings.vex} disabled={settings.scaleMode === 'explicit'} onChange={e => set({ vex: Number(e.target.value) })} data-testid="sheet-vex" />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t('sheet.spacing')}</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.spacing} onChange={e => set({ spacing: Number(e.target.value) })} data-testid="sheet-spacing" />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{t('sheet.fields')}</legend>
            {settings.fields.map((f, i) => (
              <div key={i} className="grid grid-cols-[6rem_1fr] gap-1">
                <input value={f.label} onChange={e => setField(i, { label: e.target.value })} className="min-w-0 text-xs uppercase tracking-wide" aria-label={`label ${i + 1}`} />
                <input value={f.value} onChange={e => setField(i, { value: e.target.value })} className="min-w-0" aria-label={f.label} data-testid={`sheet-field-${i}`} />
              </div>
            ))}
          </fieldset>
          <div className="mt-auto flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded border px-3 py-1.5">{t('sheet.close')}</button>
            <button type="button" onClick={() => void exportPdf()} disabled={exportDisabled} data-testid="sheet-export" className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">
              {busy === 'print' ? t('sheet.exporting') : t('sheet.export')}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
```

Use the repo's existing dialog chrome if one exists (`grep -rln 'role="dialog"' desktop/src/renderer/src/components | head`) for backdrop, focus trap and Esc, keeping the body above; button and range classes must match the sibling dialogs' Tailwind vocabulary. The two `// reason:` lines above are mandatory (project rule). The ready message the iframe posts back is not consumed by the preview.

- [ ] **Step 2: Wire the verbs.** In `useSectionExportVerbs.ts` replace `pdfDialogOpen / exportingPdf / pdfDefaultTitle / handleExportPdf` with `const [sheetDialogOpen, setSheetDialogOpen] = useState(false)` and export both; `sectionsTailToolbarItems.tsx:183-186` calls `setSheetDialogOpen(true)` (label unchanged, `testid: 'export-section-pdf'` unchanged, `disabled: !hasSection || !hasModel`); `SectionsToolbarDialogs.tsx` mounts `<SheetPreviewDialog open={sheetDialogOpen} onClose={() => setSheetDialogOpen(false)} section={selectedSection} axisModel={axisModel} isGeotech={isGeotech} hasGeotechModel={…} />` with the same `axisModel` / `isGeotech` derivation `useDseriesExportItems` receives.

- [ ] **Step 3: Remove the old path.** Delete `api.section.exportPdf`, `handleExportSectionPdf` in `App.tsx` and its prop on the section stage (`App.tsx:1306`), `ReportMetadataDialog.tsx` and its test, and the now-unused key `sections.export.generatingPdf` (keep `sections.export.sectionPdf`). Grep: `grep -rn "exportPdf\|ReportMetadataDialog\|handleExportSectionPdf\|generatingPdf" desktop/src` must return nothing.

- [ ] **Step 4: Gates.** `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npx vitest run --reporter=dot 2>&1 | tail -4` and the hook-order check on `SheetPreviewDialog.tsx` (`ls desktop/scripts | grep -i hook` for the script name). Expected: all green.

- [ ] **Step 5: Report** (dialog + 5 modified + 1–2 deleted).

---

### Task 15: Playwright flow

**Files:**
- Create: `desktop/tests/e2e/flow_export_section_pdf.spec.ts`

Pattern: `flow_export_stage_ui.spec.ts` for opening the seeded project, the Sections stage and its Export menu (copy its helper imports and testids verbatim); `flow_boot_open.spec.ts:52` for `app.evaluate`. The save dialog is stubbed in the main process through `app.evaluate` so the flow never blocks on a native dialog.

- [ ] **Step 1: Write the spec**

```ts
// desktop/tests/e2e/flow_export_section_pdf.spec.ts
/**
 * The cross-section PDF sheet: open the preview, move a slider, export, and
 * prove the file is a PDF whose page box equals the size the preview showed.
 * Offline by construction — the basemap falls back to the offline caption.
 */
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeApp, launchApp } from './helpers/electron_launch'

test.describe('flow_export_section_pdf', () => {
  test('preview → slider → export → a PDF whose page matches the preview', async () => {
    const { app, page } = await launchApp()
    try {
      // Open the seeded project, the Sections stage and select the seeded
      // section exactly as flow_export_stage_ui.spec.ts does (same helpers).
      await page.getByTestId('export-section-pdf').click()
      await expect(page.getByTestId('sheet-preview-dialog')).toBeVisible()
      const size = page.getByTestId('sheet-paper-size')
      await expect(size).toContainText('mm', { timeout: 20_000 })
      const before = (await size.textContent()) ?? ''

      const vex = page.getByTestId('sheet-vex')
      await vex.focus()
      for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft')
      await expect(size).not.toHaveText(before, { timeout: 10_000 })
      const after = (await size.textContent()) ?? ''
      const m = after.match(/(\d+) × (\d+) mm/)
      expect(m).not.toBeNull()
      const wMm = Number(m![1])
      const hMm = Number(m![2])

      const dir = mkdtempSync(join(tmpdir(), 'strix-sheet-'))
      const target = join(dir, 'sheet.pdf')
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
      }, target)
      await page.getByTestId('sheet-export').click()
      await expect(page.getByText(/PDF (exported|geëxporteerd)/)).toBeVisible({ timeout: 60_000 })

      const bytes = readFileSync(target)
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      const text = bytes.toString('latin1')
      const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)
      expect(box).not.toBeNull()
      const ptPerMm = 72 / 25.4
      expect(Number(box![1])).toBeCloseTo(wMm * ptPerMm, 0)
      expect(Number(box![2])).toBeCloseTo(hMm * ptPerMm, 0)
    } finally {
      await closeApp(app)
    }
  })
})
```

The `authorisePath` guard in `export:save-dialog` (`main/index.ts:1065-1089`) runs on the path the stubbed dialog returns, so the temp path is authorised like a real pick. Chromium writes page dictionaries uncompressed, so `/MediaBox` is greppable; if it ever is not, keep the `%PDF-` and size-label assertions and say so in the spec comment.

- [ ] **Step 2: Run it** (session main only — needs `:8765` free):

Run: `.\scripts\run-e2e.ps1 flow_export_section_pdf` from the repo root.
Expected: 1 passed.

- [ ] **Step 3: Report.**

---

### Task 16: Backend retirement and docs

**Files:**
- Delete: `src/groundmodel/infrastructure/exporters/section_pdf_report_exporter.py`, `pdf_layout.py`, `section_pdf_report_exporter_constants.py`
- Delete: `tests/unit/infrastructure/exporters/test_pdf_layout.py`, `test_section_pdf_report_axis_label.py`, `test_section_pdf_report_injection.py`, `tests/integration/exporters/test_section_pdf_report_exporter.py`
- Modify: `src/groundmodel/api/routers/cross_section.py:528-599` (remove the route + its imports)
- Modify: `tests/integration/_litho_builders.py` (drop the PDF helper it carries — `grep -n pdf tests/integration/_litho_builders.py`)
- Modify: `pyproject.toml:62-70` (remove `reportlab`, `matplotlib`), then `uv lock`
- Modify: the compile manifest (`grep -rn "section_pdf_report\|pdf_layout" scripts/` — remove the entries if listed)
- Modify: `docs/exports.md` (PDF section → the sheet, one paragraph + pointer to the spec), `docs/debt.md` (#52 slice 1: superseded by the client sheet; B/C/D reuse the print path)

- [ ] **Step 1: Prove nothing else imports them**

Run: `grep -rn "reportlab\|matplotlib" src tests scripts --include=*.py --include=*.ps1 | grep -v "section_pdf_report\|pdf_layout"`
Expected: no output. If something else imports matplotlib, stop and report — the dependency stays.

- [ ] **Step 2: Delete + edit**, then:

Run: `uv lock && uv run ruff check src tests && uv run pytest tests/unit -q 2>&1 | tail -3`
Expected: lint clean; unit suite green with 3 fewer files collected.

- [ ] **Step 3: Integration** (session main only): `.\scripts\run-integration-tests.ps1 tests/integration/api/test_cross_section.py -q` — green.

- [ ] **Step 4: Report** (one commit per deleted/modified file; `uv.lock` its own `chore(deps): drop reportlab + matplotlib`).

---

### Task 17: Verification against the ask (session main, owner's project)

- [ ] Open CS1 on the litho axis, Export ▸ PDF. In the preview: fill continuous across the columns, no white masks, seams only where the screen has seams (open the same section on screen beside it and compare every boundary by eye — this is the "no crossing lines" check).
- [ ] Move the exaggeration and spacing sliders: the sheet re-lays instantly; the size label changes; nothing refetches (Network tab quiet).
- [ ] Switch to geotech: the fill changes to the packing classes; the unit legend follows.
- [ ] Explicit mode H 1:1000, V 1:200: the label shows the derived exaggeration 5×; typing V 1:20 grows the sheet height past 297.
- [ ] Map: basemap tiles present online; A at the start, A′ at the end; every on-profile test a solid dot with its code; other tests faded; scale bar and N; legend rows one per project in first-appearance order.
- [ ] Export → open the PDF in a viewer: vector (zoom in, edges stay crisp), page size equals the label, fonts embedded (File ▸ Properties ▸ Fonts).
- [ ] Reopen the dialog: the four fields and the scale mode are back (persisted in `view_state.pdf_sheet`).
- [ ] Airplane mode → preview shows the offline caption; export still succeeds.

Record the outcome in the landing report; the owner dogfeeds after ("i'll check if we need editing after you build").
