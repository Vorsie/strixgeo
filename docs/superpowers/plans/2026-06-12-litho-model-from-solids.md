# Litho model from solids — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the Build-litho TIN-surface path; make the 2D cross-section fill a client-side render of the **actual built body solids** (default: columns sampled at each test's (x,y); toggle: section-plane slice), driven by one "Build model" button.

**Architecture:** Pure-TS geometry over the already-fetched `LithoBodySolidResponse` meshes (no schema/endpoint change). A new `sectionFromSolids.ts` util ray-samples / plane-slices the meshes; a `ModelFillOverlay` renders it on the litho axis; `LithologyStage` collapses the two build buttons into "Build model"; the litho TIN surfaces, `formationFillBands`, and the 3D "Surfaces" layer are removed.

**Tech Stack:** React + TypeScript (Vitest), Electron renderer. Run from `desktop/`: `npx tsc --noEmit -p tsconfig.web.json` + `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-06-12-litho-model-from-solids-design.md`.

**Base / branch:** off `develop@65d834e3`. New worktree per `superpowers:using-git-worktrees`. Do NOT push (`feedback_git_workflow`). Desktop pre-commit hook runs Vitest; run filtered `tsc` manually (`feedback_desktop_tsc_gap`). After any section-overlay edit run `strix-section-geometry-check` (overlays must use the warp/spacing transform).

---

## File structure

- **Modify** `desktop/.../utils/lithoSegmenterPrefs.ts` (+ `.test.ts`) — new `sectionFillAtSectionLine` boolean pref.
- **Create** `desktop/.../utils/sectionFromSolids.ts` (+ `.test.ts`) — ray-sample (mode A) + plane-slice (mode B) of solid meshes → section fill geometry. Pure, no React.
- **Create** `desktop/.../components/sections/ModelFillOverlay.tsx` (+ `.test.tsx`) — renders the geometry on the litho axis.
- **Modify** `desktop/.../components/sections/ContactsLayer.tsx` — remove `formationFillBands` + the litho slice-of-TIN surface lines + the `showFormationFill` prop.
- **Modify** `desktop/.../components/SectionPanel.tsx` — wire the built solids + the new overlay; gate on the setting + the repurposed toggle.
- **Modify** `desktop/.../shell/stages/sections/SectionsToolbar.tsx` — rename "Hide formation fill" → "Hide model fill" (now gates the solids fill).
- **Modify** `desktop/.../shell/stages/lithology/LithologyStage.tsx` — one "Build model" button; drop the surfaces build + stale-surface badge.
- **Modify** `desktop/.../shell/stages/lithology/{LithologyCanvas,Geology3DViewer}.tsx` — remove the "Surfaces" layer; fix the 3D-pane mount gate to "solids exist".
- **Modify** the Settings dialog (litho-segmenter section) — toggle row for the new pref.
- **Modify** `desktop/tests/e2e/flow_litho_solids.spec.ts` — build-button selector.

Order: **geometry util first** (the de-risking core), then overlay, then wiring, then build/3D cleanup.

---

### Task 1: New `sectionFillAtSectionLine` preference

**Files:** `utils/lithoSegmenterPrefs.ts`, `utils/lithoSegmenterPrefs.test.ts`

- [ ] **Step 1: Failing test** — append to `lithoSegmenterPrefs.test.ts`:

```ts
it('defaults sectionFillAtSectionLine to false (test locations)', () => {
  expect(readLithoSegmenterPrefs(null).sectionFillAtSectionLine).toBe(false)
})
it('reads explicit section_fill_at_section_line=true', () => {
  const vs = { litho_segmenter: { section_fill_at_section_line: true } }
  expect(readLithoSegmenterPrefs(vs).sectionFillAtSectionLine).toBe(true)
})
it('round-trips sectionFillAtSectionLine through the patch', () => {
  const prefs = { ...LITHO_SEGMENTER_DEFAULTS, sectionFillAtSectionLine: true }
  expect(buildLithoSegmenterPatch(prefs).litho_segmenter)
    .toMatchObject({ section_fill_at_section_line: true })
})
```
(ensure `LITHO_SEGMENTER_DEFAULTS` + `buildLithoSegmenterPatch` are imported in the test).

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/renderer/src/utils/lithoSegmenterPrefs.test.ts` → property missing.

- [ ] **Step 3: Implement** — in `lithoSegmenterPrefs.ts`:
  - Add to `LithoSegmenterPrefs`: `/** When true, the cross-section model fill is a section-plane slice of the body solids; when false (default) it is sampled at each test's (x,y). */ sectionFillAtSectionLine: boolean`.
  - Add to `LITHO_SEGMENTER_DEFAULTS`: `sectionFillAtSectionLine: false,`.
  - In `readLithoSegmenterPrefs` return object (mirror the `mergeSameLithology` boolean branch):
    ```ts
    sectionFillAtSectionLine:
      typeof dict.section_fill_at_section_line === 'boolean'
        ? dict.section_fill_at_section_line
        : LITHO_SEGMENTER_DEFAULTS.sectionFillAtSectionLine,
    ```
  - In `buildLithoSegmenterPatch` payload: `section_fill_at_section_line: prefs.sectionFillAtSectionLine,`.

- [ ] **Step 4: Run → PASS** — same vitest command.

- [ ] **Step 5: Commit** — `git add` both files; `feat(litho-3d): add sectionFillAtSectionLine pref`.

---

### Task 2: `sectionFromSolids` — ray-sample columns (mode A, default)

**Files:** `utils/sectionFromSolids.ts` (create), `utils/sectionFromSolids.test.ts` (create)

Reuse the section projection: a test's along-distance is its projection onto the section line (same as `sliceTin`'s `SectionLine2D`). The fill is anchored at the test's `alongM`.

- [ ] **Step 1: Failing test** — create `sectionFromSolids.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sampleSolidColumns, type SolidMesh } from './sectionFromSolids'

// A single SAND box body spanning x,y in [0,10], top z=0, base z=-4.
function box(bodyId: string, formationId: string, x0=0, x1=10, y0=0, y1=10, top=0, base=-4): SolidMesh {
  const v: [number, number, number][] = [
    [x0,y0,top],[x1,y0,top],[x1,y1,top],[x0,y1,top],
    [x0,y0,base],[x1,y0,base],[x1,y1,base],[x0,y1,base],
  ]
  const t: [number, number, number][] = [
    [0,1,2],[0,2,3],            // top
    [4,6,5],[4,7,6],            // base
    [0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0], // walls
  ]
  return { bodyId, formationId, color: '#fbbf24', vertices: v, triangles: t }
}

describe('sampleSolidColumns (mode A)', () => {
  it('samples a body top/base at a test inside its footprint', () => {
    const cols = sampleSolidColumns([box('b1','SAND')], [{ id: 't1', x: 5, y: 5, alongM: 100 }])
    expect(cols).toHaveLength(1)
    expect(cols[0].alongM).toBe(100)
    expect(cols[0].segments).toHaveLength(1)
    expect(cols[0].segments[0].topElev).toBeCloseTo(0, 6)
    expect(cols[0].segments[0].baseElev).toBeCloseTo(-4, 6)
    expect(cols[0].segments[0].bodyId).toBe('b1')
  })
  it('omits bodies whose footprint does not cover the test (body absent there)', () => {
    const cols = sampleSolidColumns([box('b1','SAND',0,4,0,10)], [{ id: 't1', x: 8, y: 5, alongM: 0 }])
    expect(cols[0].segments).toHaveLength(0)
  })
  it('stacks two bodies at one test, deepest last', () => {
    const sand = box('s','SAND',0,10,0,10,0,-4)
    const clay = box('c','CLAY',0,10,0,10,-4,-16)
    const cols = sampleSolidColumns([sand, clay], [{ id: 't1', x: 5, y: 5, alongM: 0 }])
    const elevs = cols[0].segments.map(s => s.baseElev)
    expect(elevs).toEqual([-4, -16])
  })
})
```

- [ ] **Step 2: Run → FAIL** — module missing.

- [ ] **Step 3: Implement** `sectionFromSolids.ts`:
  - Types: `SolidMesh { bodyId: string; formationId: string; color: string; vertices: [number,number,number][]; triangles: [number,number,number][] }`; `SectionTest { id: string; x: number; y: number; alongM: number }`; `ColumnSegment { bodyId: string; formationId: string; color: string; topElev: number; baseElev: number }`; `SolidColumn { testId: string; alongM: number; segments: ColumnSegment[] }`.
  - `sampleSolidColumns(meshes, tests)`: for each test, cast a **vertical ray** (direction (0,0,1)) at (x,y); for each mesh, collect z of every triangle the ray crosses (2D point-in-triangle on (x,y) → barycentric-interpolate z). Sort z's; pair them (closed manifold → even count) into `[base,top]` intervals; emit one `ColumnSegment` per interval (`topElev` = larger z, `baseElev` = smaller z). Skip a mesh with 0 crossings (body absent at the test). Order each column's segments by `topElev` descending (shallowest first). Provide a small `pointInTriangle2D` + `interpZ` helper.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(litho-3d): sampleSolidColumns — section columns from body solids`.

---

### Task 3: `sectionFromSolids` — plane-slice polygons (mode B, toggle)

**Files:** `utils/sectionFromSolids.ts` (extend), `utils/sectionFromSolids.test.ts` (extend)

- [ ] **Step 1: Failing test** — append:

```ts
import { sliceSolidsAtPlane } from './sectionFromSolids'

describe('sliceSolidsAtPlane (mode B)', () => {
  it('slices a box body along a line crossing it → a filled ring', () => {
    // section line y=5, from x=-5..15 → crosses the [0,10] box
    const line = { ax: -5, ay: 5, bx: 15, by: 5 }
    const polys = sliceSolidsAtPlane([box('b1','SAND',0,10,0,10,0,-4)], line)
    expect(polys).toHaveLength(1)
    // polygon spans alongM ~5..15 (box x 0..10 mapped onto the line origin -5), elev -4..0
    const elevs = polys[0].points.map(p => p.elev)
    expect(Math.min(...elevs)).toBeCloseTo(-4, 6)
    expect(Math.max(...elevs)).toBeCloseTo(0, 6)
  })
  it('returns nothing for a body the line misses', () => {
    const line = { ax: -5, ay: 50, bx: 15, by: 50 }
    expect(sliceSolidsAtPlane([box('b1','SAND',0,10,0,10)], line)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `sliceSolidsAtPlane(meshes, line)`:
  - `SectionPlaneLine { ax,ay,bx,by }`; `SectionPoly { bodyId; formationId; color; points: { alongM: number; elev: number }[] }`.
  - The vertical plane through the 2D line. For each mesh: for each triangle, compute each vertex's signed distance to the plane (2D cross-product of (vertex.xy − a) with the line direction); where an edge crosses (sign change), interpolate the crossing point's (x,y,z); project (x,y) → `alongM` (dot with the unit line direction). Each crossed triangle yields a segment (2 crossing points). Assemble the segments into one closed polygon per mesh (chain shared endpoints; the slice of a closed manifold is a closed loop). Skip meshes with no crossings.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(litho-3d): sliceSolidsAtPlane — section-plane slice of body solids`.

---

### Task 4: `ModelFillOverlay` — render mode A / mode B

**Files:** `components/sections/ModelFillOverlay.tsx` (create), `...test.tsx` (create)

- [ ] **Step 1: Failing test** — render with two mode-A columns (same body across two `alongM`) and assert one filled `<path>`/`<polygon>` per body band with the body colour and `data-testid="model-fill-<bodyId>"`; render with a mode-B poly and assert a `<path>`. Use the warp-aware `alongMToScreenX` + `levelToScreen` props (mirror `PartitionFillOverlay` prop shape — read it first). Assert `pointerEvents="none"`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — props: `{ columns?: SolidColumn[]; polys?: SectionPoly[]; alongMToScreenX: (m:number)=>number; levelToScreen:(z:number)=>number; opacity: number }`. Mode A: for each body, connect adjacent columns' same-body segments into a band polygon (top chain over, base chain under) — reuse the `buildFillBand` pattern from `ContactsLayer`/`utils`. Mode B: one `<path>` per `SectionPoly` (map points through `alongMToScreenX`/`levelToScreen`). Both `fill={color}` `fillOpacity={opacity}` `stroke="none"` `pointerEvents="none"`.

- [ ] **Step 4: Run → PASS.** Then run `strix-section-geometry-check` (confirm it uses the warp transform, not raw along).

- [ ] **Step 5: Commit** — `feat(litho-3d): ModelFillOverlay renders the solids-derived section fill`.

---

### Task 5: Share the built solids into the Sections stage

**Files:** `hooks/useGeologicalModel.ts` / shell context, `components/SectionPanel.tsx`

- [ ] **Step 1:** Confirm via the shell bus that `lithoSolids` (from `useLithoSolids`, already composed into `useGeologicalModel`) is reachable where `SectionPanel` is rendered. (It is — `LithologyToolbar` reads `geoModel.lithoSolids`.) Add a thin selector if needed.
- [ ] **Step 2:** In `SectionPanel`, build `SolidMesh[]` from `lithoSolids` (map `LithoBodySolidResponse` → `{bodyId, formationId, color: display_color ?? formationColor, vertices, triangles}`), filtered to non-flagged solids whose body appears among the section's investigations. Build `SectionTest[]` from the section's placed columns (`{id, x, y, alongM}` using the existing projection). Memoize both.
- [ ] **Step 3:** Compute `columns`/`polys` via `sampleSolidColumns` / `sliceSolidsAtPlane` based on `readLithoSegmenterPrefs(project?.view_state).sectionFillAtSectionLine`.
- [ ] **Step 4: Test** — a SectionPanel-level vitest (or extend an existing one) asserting the `ModelFillOverlay` receives non-empty `columns` when solids + tests are present on the litho axis, and nothing on the geological axis. Run + `tsc`.
- [ ] **Step 5: Commit** — `feat(litho-3d): feed built solids into the section model fill`.

---

### Task 6: Repurpose the toggle + retire `formationFillBands`

**Files:** `SectionsToolbar.tsx`, `SectionPanel.tsx`, `ContactsLayer.tsx`, `formationFillStore.ts` (rename usage)

- [ ] **Step 1:** Gate `ModelFillOverlay` in `SectionPanel` on `axisMode === 'lithostratigraphic' && useFormationFillVisible()` (the Issue-B store, now driving the model fill).
- [ ] **Step 2:** In `SectionsToolbar`, relabel the toggle to **"Hide model fill" / "Show model fill"** (testid stays `litho-toggle-formation-fill` to keep e2e stable, or rename + update e2e — pick rename for clarity and update the e2e in Task 9). Update the title copy ("the section fill sampled from the built 3-D solids").
- [ ] **Step 3:** Remove `formationFillBands` (+ `slicedPolylines` litho surface lines + the `showFormationFill` prop) from `ContactsLayer.tsx`, and the `showFormationFill` wiring in `SectionPanel`. Keep `perColumnBandsFromContacts`. Update/trim the ContactsLayer tests that asserted `formation-fill-*`.
- [ ] **Step 4:** Run the sections/components vitest + `tsc`. Confirm geological-axis fill (its own `formationFillBands`) is untouched — **NOTE:** `formationFillBands` is shared with the geological axis. Do NOT remove it outright; instead gate it `axisMode === 'geological'` (litho axis no longer paints it). Re-read ContactsLayer before editing.
- [ ] **Step 5: Commit** — `feat(litho-3d): model fill replaces formationFillBands on the litho axis`.

---

### Task 7: One "Build model" button

**Files:** `shell/stages/lithology/LithologyStage.tsx` (+ `LithologyStage.toolbar.test.tsx`)

- [ ] **Step 1: Failing test** — in `LithologyStage.toolbar.test.tsx`: a single button labelled "Build model" (testid `litho-build-model-button`) that on click calls `buildLithoSolids`; assert "Build litho" and "Build solids" buttons are **absent**. (Rework the existing BL/BuildSolids cases.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — replace the two `ToolbarButton`s with one "Build model" (Box icon) → `onClick={() => void buildLithoSolids()}`, `busy/disabled` on `lithoSolidsBuilding`, amber on `hasStaleLithoSolid`, gated on `lithoContacts.length > 0` with the existing no-contacts tooltip. Drop `handleRebuildLithoSurfaces`, `rebuilding`, `lithoStaleSurfaceCount` usage here.
- [ ] **Step 4: Run → PASS** + `tsc`.
- [ ] **Step 5: Commit** — `feat(litho-3d): single "Build model" button (retire Build litho)`.

---

### Task 8: Remove the 3D "Surfaces" layer + fix the mount gate

**Files:** `shell/stages/lithology/LithologyCanvas.tsx`, `Geology3DViewer.tsx`

- [ ] **Step 1:** Find the litho "Surfaces" legend/layer entry + the gate that mounts the 3D pane only when litho `formation_surface` rows exist (memory: "litho surfaces must exist for the 3D pane to mount"). 
- [ ] **Step 2:** Change the mount gate to "litho **solids** exist" (`hasLithoSolids`). Remove the "Surfaces" legend toggle + the surface-rendering path on the litho pane (geology pane keeps its surfaces).
- [ ] **Step 3: Test** — the existing LithologyCanvas tests: assert the pane mounts when solids exist and there's no "Surfaces" legend entry. Run vitest + `tsc`.
- [ ] **Step 4: Commit** — `feat(litho-3d): drop the litho Surfaces layer; mount the 3D pane on solids`.

---

### Task 9: Settings row, e2e, full suite

**Files:** Settings dialog (litho-segmenter section), `flow_litho_solids.spec.ts`

- [ ] **Step 1:** Add a toggle row in Settings → Litho segmenter for `sectionFillAtSectionLine` (mirror the existing `mergeSameLithology` boolean row: label "Section fill at section line", hint "Off = sample at each test (default); On = slice the solids at the section line", wired through `buildLithoSegmenterPatch`). Add/extend the Settings test.
- [ ] **Step 2:** Update `flow_litho_solids.spec.ts`: the build button selector → `litho-build-model-button`; if the toggle testid changed, update it. (e2e is owner-run — note it; don't run here if it conflicts with the dev app on :8765.)
- [ ] **Step 3:** Full gates from `desktop/`: `npx tsc --noEmit -p tsconfig.web.json` + `npx vitest run` (all green).
- [ ] **Step 4:** Manual dogfeed (owner) on `test.strix`: **Build model** → cross-section model fill matches the 3D solids, anchored at test locations; bottom is grey clay, not flooded yellow; toggle the section-line slice in Settings; the 3D pane has no "Surfaces" layer and the fence isolates.
- [ ] **Step 5: Commit** — `feat(litho-3d): settings row + e2e for the model-fill section view`.

---

## Self-review

**Spec coverage:** Build model button (T7) ✓; retire Build litho surfaces (T7) ✓; 2D fill from built solids — mode A sample (T2) + mode B slice (T3) + render (T4) + wiring (T5) ✓; default/toggle setting (T1, T9) ✓; repurpose toggle + retire formationFillBands on litho axis (T6) ✓; remove 3D Surfaces layer + mount gate (T8) ✓; keep per-column bands / Fill bands / correlations (untouched — T6 only removes the litho-axis formationFillBands) ✓; client-side, no schema change ✓; export out of scope ✓.

**Placeholder scan:** geometry impl steps (T2/T3/T4) give the algorithm + signatures + concrete failing tests (TDD — the test is the contract; the impl is written to pass). UI plumbing steps reference exact existing patterns (`mergeSameLithology` row, `PartitionFillOverlay` prop shape, `buildFillBand`) to copy — re-read those before editing. No "TBD".

**Type consistency:** `SolidMesh` / `SectionTest` / `SolidColumn` / `ColumnSegment` (T2) and `SectionPoly` / `SectionPlaneLine` (T3) are reused unchanged in T4/T5; `LithoBodySolidResponse.{vertices,triangles,formation_id,body_id,display_color,is_flagged}` (geology.ts:657) is the source mapped to `SolidMesh` in T5.

**Risk note:** T6 — `formationFillBands` is shared with the geological axis; gate it to geological, do NOT delete. T8 — the 3D-pane mount gate change is load-bearing (don't let the litho pane fail to mount when surfaces are gone). Both flagged in their tasks.
