# Litho 3D — Phase 1: Auto-Tie Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Strix auto-propose a tidy, non-crossing "ladder" of thin tie-sections across the parallel cross-sections — shown as ghosts on the map that the user accepts/rejects — so the parallel sections become a connected fence ready for 3D (Phase 2).

**Architecture:** A pure TypeScript matcher (`tieAutoSuggest.ts`) turns investigation coordinates + existing sections into proposed tie lines using a monotonic strike-ordered sweep that provably never crosses. A Leaflet ghost overlay renders the proposals; accepting one creates a real cross-section through the existing `POST /projects/{id}/sections` API (mirroring the current map-draw create path). A new per-project pref controls the matcher's strike-spread tolerance.

**Tech Stack:** React + react-leaflet (renderer), Vitest (unit), Playwright (e2e), existing `sectionProjection.ts` / `useWgs84.ts` / `sectionDefaults.ts` utilities.

**Spec:** `docs/superpowers/specs/2026-06-09-litho-3d-model-design.md` (§5.1.1, decision 5b, §2.1 validation).

---

## File Structure

**Create:**
- `desktop/src/renderer/src/utils/tieAutoSuggest.ts` — pure matcher (algorithm + types). One responsibility: coordinates → non-crossing tie proposals.
- `desktop/src/renderer/src/utils/tieAutoSuggest.test.ts` — Vitest unit tests for the matcher.
- `desktop/src/renderer/src/components/TieSuggestionOverlay.tsx` — Leaflet ghost overlay (ghost lines + accept/reject), thin React wrapper over a pure geometry helper.
- `desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx` — test for the pure `tieToLatLngLine` helper.
- `desktop/tests/e2e/flow_auto_tie.spec.ts` — Playwright happy-path.

**Modify:**
- `desktop/src/renderer/src/utils/sectionDefaults.ts` — add `tieStrikeToleranceM` to the pref bag (read/write/bounds).
- `desktop/src/renderer/src/hooks/useSections.ts` — add `suggestedTies` state + `handleSuggestTies` / `handleAcceptTie` / `handleRejectTie` / `handleClearTieSuggestions`.
- `desktop/src/renderer/src/components/MapView.tsx` — mount `TieSuggestionOverlay` when suggestions exist.
- `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` — add a "Suggest tie-sections" button.
- `desktop/src/renderer/src/components/SettingsDialog.tsx` — add a tie-tolerance NumericInput row to the `sections` tab.

---

## Task 1: Pure tie-section matcher

The algorithmic heart. Pure function, fully TDD'd. Validated on test.strix in spec §2.1 (29 ties, 0 crossings).

**Files:**
- Create: `desktop/src/renderer/src/utils/tieAutoSuggest.ts`
- Test: `desktop/src/renderer/src/utils/tieAutoSuggest.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// desktop/src/renderer/src/utils/tieAutoSuggest.test.ts
import { describe, expect, it } from 'vitest'
import { suggestTieSections, type ParallelSection, type TieInvestigation } from './tieAutoSuggest'

// Two parallel walls running due East (along +x), offset 80 m in +y.
// Wall A at y=0, wall B at y=80. Buffer ±35 m so each test joins exactly one wall.
const wallA: ParallelSection = {
  id: 'A', start_x: 0, start_y: 0, end_x: 300, end_y: 0, projection_buffer_m: 35,
}
const wallB: ParallelSection = {
  id: 'B', start_x: 0, start_y: 80, end_x: 300, end_y: 80, projection_buffer_m: 35,
}
const inv = (id: string, x: number, y: number): TieInvestigation => ({ id, location_x: x, location_y: y })

describe('suggestTieSections', () => {
  it('pairs aligned tests across two walls into one tie per rung (the rule: same strike position → one tie)', () => {
    const cpts = [inv('a1', 50, 0), inv('a2', 150, 0), inv('b1', 50, 80), inv('b2', 150, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    expect(ties).toHaveLength(2)
    expect(ties[0].members.map(m => m.investigationId).sort()).toEqual(['a1', 'b1'])
    expect(ties[1].members.map(m => m.investigationId).sort()).toEqual(['a2', 'b2'])
  })

  it('never proposes crossing ties (the rule: ties are strike-ordered, no lateral swaps)', () => {
    // a-tests at strike 50,150 ; b-tests at strike 150,50 — a naive nearest match would cross.
    const cpts = [inv('a_lo', 50, 0), inv('a_hi', 150, 0), inv('b_lo', 50, 80), inv('b_hi', 150, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    // For each wall, the member strikes in tie order must be non-decreasing → zero crossings.
    for (const wallId of ['A', 'B']) {
      const strikes = ties
        .map(t => t.members.find(m => m.sectionId === wallId))
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map(m => m.x) // walls run along +x so strike == x here
      const sorted = [...strikes].sort((p, q) => p - q)
      expect(strikes).toEqual(sorted)
    }
  })

  it('puts at most one test per wall in a tie (the rule: ~1 test per section per tie)', () => {
    const cpts = [inv('a1', 50, 0), inv('a2', 60, 0), inv('b1', 55, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    for (const t of ties) {
      const perWall = new Map<string, number>()
      for (const m of t.members) perWall.set(m.sectionId, (perWall.get(m.sectionId) ?? 0) + 1)
      for (const count of perWall.values()) expect(count).toBeLessThanOrEqual(1)
    }
  })

  it('leaves an out-of-tolerance test untied rather than forcing a fat tie', () => {
    // b-test is 200 m along-strike from the a-test — far beyond tolerance 45.
    const cpts = [inv('a1', 50, 0), inv('b_far', 250, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    const tied = new Set(ties.flatMap(t => t.members.map(m => m.investigationId)))
    expect(tied.has('a1')).toBe(false) // no 2-wall rung formed
    expect(tied.has('b_far')).toBe(false)
  })

  it('returns nothing with fewer than two sections', () => {
    expect(suggestTieSections([wallA], [inv('a1', 50, 0)], [], 45)).toEqual([])
  })

  it('forms a 3-wall triplet where all three walls have an aligned test', () => {
    const wallC: ParallelSection = { id: 'C', start_x: 0, start_y: 180, end_x: 300, end_y: 180, projection_buffer_m: 65 }
    const cpts = [inv('a1', 100, 0), inv('b1', 100, 80), inv('c1', 100, 180)]
    const ties = suggestTieSections([wallA, wallB, wallC], cpts, [], 45)
    expect(ties).toHaveLength(1)
    expect(ties[0].members).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop && npx vitest run src/renderer/src/utils/tieAutoSuggest.test.ts`
Expected: FAIL — `Cannot find module './tieAutoSuggest'` / `suggestTieSections is not a function`.

- [ ] **Step 3: Implement the matcher**

```typescript
// desktop/src/renderer/src/utils/tieAutoSuggest.ts
//
// Auto-propose non-crossing "tie-sections" across a set of (assumed
// roughly parallel) cross-sections. The match is a monotonic
// strike-ordered sweep: pointers into each wall's strike-sorted test
// list only ever advance, so the resulting rungs are strike-ordered
// and the proposed ties can never cross one another (a crossing would
// imply a geologically impossible lateral swap). See spec §5.1.1.
import { projectPointOntoLine, type SectionEndpoints } from './sectionProjection'

/** An investigation (CPT or borehole) with its map-projected location. */
export interface TieInvestigation {
  id: string
  location_x: number
  location_y: number
}

/** An existing cross-section the ties will cross, with its corridor. */
export interface ParallelSection extends SectionEndpoints {
  id: string
  projection_buffer_m: number
  excluded_cpt_ids?: readonly string[]
  excluded_borehole_ids?: readonly string[]
}

/** One member test of a proposed tie (one per wall it connects). */
export interface TieMember {
  sectionId: string
  investigationId: string
  x: number
  y: number
}

/** A single proposed tie-section. */
export interface SuggestedTie {
  /** Member tests, ordered by strike (one per wall). */
  members: TieMember[]
  /** Projected endpoints of the straight tie line (through the extreme members). */
  start: { x: number; y: number }
  end: { x: number; y: number }
  /** Max along-strike spread among members (m) — collinearity quality. */
  strikeSpread: number
  /** Thinnest buffer that still catches every member (m). */
  bufferM: number
}

/** Perpendicular distance from point (px,py) to the line through a→b. */
function perpDistanceToLine(
  ax: number, ay: number, bx: number, by: number, px: number, py: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return Math.hypot(px - ax, py - ay)
  return Math.abs((px - ax) * dy - (py - ay) * dx) / len
}

/**
 * Propose a non-crossing ladder of tie-sections.
 *
 * @param sections - Existing (parallel) cross-sections. The first one's
 *   direction defines the strike axis; pass them in a stable order.
 * @param cpts - All CPT investigations as projectable points.
 * @param boreholes - All borehole investigations as projectable points.
 * @param strikeToleranceM - Max along-strike spread allowed within one tie.
 * @returns Proposed ties in sweep (strike) order; empty if <2 sections.
 */
export function suggestTieSections(
  sections: readonly ParallelSection[],
  cpts: readonly TieInvestigation[],
  boreholes: readonly TieInvestigation[],
  strikeToleranceM: number,
): SuggestedTie[] {
  if (sections.length < 2) return []

  // Strike axis = unit vector of the first section's direction.
  const base = sections[0]
  const ax = base.end_x - base.start_x
  const ay = base.end_y - base.start_y
  const axisLen = Math.hypot(ax, ay)
  if (axisLen < 1e-9) return []
  const ux = ax / axisLen
  const uy = ay / axisLen
  const strikeOf = (x: number, y: number): number =>
    (x - base.start_x) * ux + (y - base.start_y) * uy

  // Assign each investigation to the section whose corridor it sits in
  // with the smallest |offset| (handles rare corridor overlap).
  interface Placed { inv: TieInvestigation; wall: number; s: number }
  const placed: Placed[] = []
  const all = [...cpts, ...boreholes]
  for (const item of all) {
    let bestWall = -1
    let bestOffset = Infinity
    sections.forEach((sec, wallIdx) => {
      const excluded =
        (sec.excluded_cpt_ids?.includes(item.id) ?? false) ||
        (sec.excluded_borehole_ids?.includes(item.id) ?? false)
      if (excluded) return
      const proj = projectPointOntoLine(sec, item.location_x, item.location_y)
      if (!proj) return
      const secLen = Math.hypot(sec.end_x - sec.start_x, sec.end_y - sec.start_y)
      if (proj.along < 0 || proj.along > secLen) return
      const absOffset = Math.abs(proj.offset)
      if (absOffset <= sec.projection_buffer_m && absOffset < bestOffset) {
        bestOffset = absOffset
        bestWall = wallIdx
      }
    })
    if (bestWall >= 0) {
      placed.push({ inv: item, wall: bestWall, s: strikeOf(item.location_x, item.location_y) })
    }
  }

  // Per-wall, strike-sorted lists.
  const walls: Placed[][] = sections.map(() => [])
  for (const p of placed) walls[p.wall].push(p)
  for (const w of walls) w.sort((a, b) => a.s - b.s)

  // Monotonic sweep: advance a pointer per wall; each step forms a rung
  // from frontier tests within tolerance of the current minimum strike.
  const ptr = sections.map(() => 0)
  const ties: SuggestedTie[] = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const frontier = walls
      .map((w, i) => (ptr[i] < w.length ? { wall: i, p: w[ptr[i]] } : null))
      .filter((f): f is { wall: number; p: Placed } => f !== null)
    if (frontier.length === 0) break
    const sMin = Math.min(...frontier.map(f => f.p.s))
    const rung = frontier.filter(f => f.p.s - sMin <= strikeToleranceM)
    for (const f of rung) ptr[f.wall] += 1

    if (rung.length < 2) continue // single-wall rung is not a tie

    const members: TieMember[] = rung
      .map(f => ({
        sectionId: sections[f.wall].id,
        investigationId: f.p.inv.id,
        x: f.p.inv.location_x,
        y: f.p.inv.location_y,
      }))
      .sort((a, b) => strikeOf(a.x, a.y) - strikeOf(b.x, b.y))

    const first = members[0]
    const last = members[members.length - 1]
    const ss = rung.map(f => f.p.s)
    const buffer =
      Math.max(
        5,
        ...members.map(m => perpDistanceToLine(first.x, first.y, last.x, last.y, m.x, m.y)),
      ) + 2
    ties.push({
      members,
      start: { x: first.x, y: first.y },
      end: { x: last.x, y: last.y },
      strikeSpread: Math.max(...ss) - Math.min(...ss),
      bufferM: buffer,
    })
  }
  return ties
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop && npx vitest run src/renderer/src/utils/tieAutoSuggest.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check the new file**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors referencing `tieAutoSuggest.ts`.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/src/utils/tieAutoSuggest.ts desktop/src/renderer/src/utils/tieAutoSuggest.test.ts
git commit -m "feat(sections): non-crossing tie-section matcher"
```

---

## Task 2: Strike-tolerance project preference

Add a per-project tie tolerance to the existing `section_defaults` view_state bag.

**Files:**
- Modify: `desktop/src/renderer/src/utils/sectionDefaults.ts`
- Test: `desktop/src/renderer/src/utils/sectionDefaults.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// append to desktop/src/renderer/src/utils/sectionDefaults.test.ts
import { describe, expect, it } from 'vitest'
import { readSectionDefaults, buildSectionDefaultsPatch, SECTION_DEFAULTS } from './sectionDefaults'

describe('tieStrikeToleranceM pref', () => {
  it('falls back to the default when absent', () => {
    expect(readSectionDefaults(null).tieStrikeToleranceM).toBe(SECTION_DEFAULTS.tieStrikeToleranceM)
  })
  it('reads a valid stored value', () => {
    const vs = { section_defaults: { tie_strike_tolerance_m: 30 } }
    expect(readSectionDefaults(vs).tieStrikeToleranceM).toBe(30)
  })
  it('rejects out-of-bounds values, falling back to default', () => {
    const vs = { section_defaults: { tie_strike_tolerance_m: 99999 } }
    expect(readSectionDefaults(vs).tieStrikeToleranceM).toBe(SECTION_DEFAULTS.tieStrikeToleranceM)
  })
  it('round-trips through the patch builder', () => {
    const patch = buildSectionDefaultsPatch({ ...SECTION_DEFAULTS, tieStrikeToleranceM: 25 })
    expect((patch.section_defaults as Record<string, unknown>).tie_strike_tolerance_m).toBe(25)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/sectionDefaults.test.ts`
Expected: FAIL — `tieStrikeToleranceM` is `undefined`.

- [ ] **Step 3: Extend the pref bag**

In `desktop/src/renderer/src/utils/sectionDefaults.ts`:

1. Add the field to the interface:
```typescript
export interface SectionDefaults {
  bufferM: number
  verticalExaggeration: number
  /** Max along-strike spread (m) allowed within one auto-proposed
   *  tie-section. Wider = more ties but less clean; default 45 m. */
  tieStrikeToleranceM: number
}
```
2. Add the default + bounds:
```typescript
export const SECTION_DEFAULTS: SectionDefaults = {
  bufferM: 50.0,
  verticalExaggeration: 1.0,
  tieStrikeToleranceM: 45.0,
}

export const SECTION_DEFAULTS_BOUNDS = {
  bufferM: { min: 1.0, max: 1000.0 },
  verticalExaggeration: { min: 0.1, max: 50.0 },
  tieStrikeToleranceM: { min: 1.0, max: 500.0 },
} as const
```
3. In `readSectionDefaults`, read it (mirror the existing `readBoundedNumber` calls):
```typescript
    tieStrikeToleranceM: readBoundedNumber(
      raw.tie_strike_tolerance_m,
      SECTION_DEFAULTS_BOUNDS.tieStrikeToleranceM,
      SECTION_DEFAULTS.tieStrikeToleranceM,
    ),
```
4. In `buildSectionDefaultsPatch`, write it:
```typescript
    section_defaults: {
      buffer_m: defaults.bufferM,
      vertical_exaggeration: defaults.verticalExaggeration,
      tie_strike_tolerance_m: defaults.tieStrikeToleranceM,
    },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd desktop && npx vitest run src/renderer/src/utils/sectionDefaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/utils/sectionDefaults.ts desktop/src/renderer/src/utils/sectionDefaults.test.ts
git commit -m "feat(sections): tie strike-tolerance project pref"
```

---

## Task 3: Ghost-overlay geometry helper + Leaflet component

The pure helper (tie → lat/lng polyline) is unit-tested; the React/Leaflet wrapper is thin.

**Files:**
- Create: `desktop/src/renderer/src/components/TieSuggestionOverlay.tsx`
- Test: `desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx`

- [ ] **Step 1: Write the failing test for the geometry helper**

```typescript
// desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx
import { describe, expect, it } from 'vitest'
import { tieToLatLngLine } from './TieSuggestionOverlay'
import type { SuggestedTie } from '../utils/tieAutoSuggest'

describe('tieToLatLngLine', () => {
  it('converts a tie\'s projected endpoints to [lat,lng] pairs in EPSG 31370', () => {
    const tie: SuggestedTie = {
      members: [], strikeSpread: 0, bufferM: 5,
      start: { x: 88018, y: 164330 },
      end: { x: 88438, y: 165023 },
    }
    const line = tieToLatLngLine(tie, 31370)
    expect(line).toHaveLength(2)
    // Belgium Lambert72 → WGS84 lands near lat ~51, lng ~4-5.
    expect(line[0][0]).toBeGreaterThan(50)
    expect(line[0][0]).toBeLessThan(52)
    expect(line[0][1]).toBeGreaterThan(3)
    expect(line[0][1]).toBeLessThan(6)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/components/TieSuggestionOverlay.test.tsx`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Implement the helper + overlay**

```tsx
// desktop/src/renderer/src/components/TieSuggestionOverlay.tsx
import { Polyline, CircleMarker } from 'react-leaflet'
import { projectedToWgs84 } from '../hooks/useWgs84'
import type { SuggestedTie } from '../utils/tieAutoSuggest'

/** Convert a tie's projected endpoints into a Leaflet [[lat,lng],[lat,lng]] line. */
export function tieToLatLngLine(tie: SuggestedTie, epsg: number): [number, number][] {
  return [
    projectedToWgs84(tie.start.x, tie.start.y, epsg),
    projectedToWgs84(tie.end.x, tie.end.y, epsg),
  ]
}

export interface TieSuggestionOverlayProps {
  ties: readonly SuggestedTie[]
  epsg: number
  /** Stable key per tie (index) → accept / reject handlers. */
  onAccept: (index: number) => void
  onReject: (index: number) => void
}

/**
 * Render auto-proposed tie-sections as green dashed ghost lines on the
 * map. Click the line to accept (creates the section); click the small
 * end dot to reject. Mirrors the SectionLineDrawer rendering pattern.
 */
export function TieSuggestionOverlay({
  ties, epsg, onAccept, onReject,
}: TieSuggestionOverlayProps): JSX.Element {
  return (
    <>
      {ties.map((tie, i) => {
        const line = tieToLatLngLine(tie, epsg)
        return (
          <Polyline
            key={`tie-ghost-${i}`}
            positions={line}
            pane="section-overlays"
            pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.75, dashArray: '7 5' }}
            eventHandlers={{ click: () => onAccept(i) }}
          >
            <CircleMarker
              center={line[1]}
              radius={5}
              pane="section-overlays"
              pathOptions={{ color: '#ef4444', fillOpacity: 0.9 }}
              eventHandlers={{ click: () => onReject(i) }}
            />
          </Polyline>
        )
      })}
    </>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd desktop && npx vitest run src/renderer/src/components/TieSuggestionOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors in the new file.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/src/components/TieSuggestionOverlay.tsx desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx
git commit -m "feat(sections): tie-suggestion ghost overlay component"
```

---

## Task 4: Wire suggestions into useSections

Add state + handlers. `handleAcceptTie` mirrors the existing `handleSectionLineDrawn` create path (already verified at `useSections.ts:492-549`) but skips the WGS84 round-trip — tie endpoints are already projected.

**Files:**
- Modify: `desktop/src/renderer/src/hooks/useSections.ts`

- [ ] **Step 1: Add suggestion state**

Near the other `useState` declarations in `useSections`:
```typescript
const [suggestedTies, setSuggestedTies] = useState<SuggestedTie[]>([])
```
Add the import at the top:
```typescript
import { suggestTieSections, type SuggestedTie } from '../utils/tieAutoSuggest'
```

- [ ] **Step 2: Add the suggest handler**

`cpts` and `boreholes` are passed into `useSections` or available via its existing inputs — confirm the hook's parameter list; if they are not already inputs, add them as parameters (the call site in the shell has them from `useInvestigationData`). Then:
```typescript
const handleSuggestTies = useCallback(
  (cpts: TieInvestigation[], boreholes: TieInvestigation[]) => {
    if (!project) return
    const tol = readSectionDefaults(project.view_state ?? null).tieStrikeToleranceM
    const parallels = visibleSections.map(s => ({
      id: s.id,
      start_x: s.start_x, start_y: s.start_y, end_x: s.end_x, end_y: s.end_y,
      projection_buffer_m: s.projection_buffer_m,
      excluded_cpt_ids: s.excluded_cpt_ids ?? [],
      excluded_borehole_ids: s.excluded_borehole_ids ?? [],
    }))
    const ties = suggestTieSections(parallels, cpts, boreholes, tol)
    setSuggestedTies(ties)
    if (ties.length === 0) toast('info', 'No clean tie-sections found — try widening the tolerance in Settings.')
    else log.info('section', `proposed ${ties.length} tie-section(s)`)
  },
  [project, visibleSections],
)
```
Add the import: `import type { TieInvestigation } from '../utils/tieAutoSuggest'`.

- [ ] **Step 3: Add accept / reject / clear handlers**

```typescript
const handleRejectTie = useCallback((index: number) => {
  setSuggestedTies(prev => prev.filter((_, i) => i !== index))
}, [])

const handleClearTieSuggestions = useCallback(() => setSuggestedTies([]), [])

const handleAcceptTie = useCallback(
  async (index: number) => {
    if (!project) return
    const epsg = effectiveHorizontalEpsg
    if (epsg == null) return
    const tie = suggestedTies[index]
    if (!tie) return
    const ordinal = visibleSections.length + 1
    const createPayload = {
      name: `Tie-section ${ordinal}`,
      epsg,
      start_x: tie.start.x,
      start_y: tie.start.y,
      end_x: tie.end.x,
      end_y: tie.end.y,
      projection_buffer_m: tie.bufferM,
      vertical_exaggeration: readSectionDefaults(project.view_state ?? null).verticalExaggeration,
    }
    const created = await api.section.create(project.id, createPayload)
    setSections(prev => [...prev, created])
    setSelectedSectionId(created.id)
    handleSectionCreated(created.id)
    setSuggestedTies(prev => prev.filter((_, i) => i !== index))
    log.success('section', `accepted tie ${created.name}`)
  },
  [project, effectiveHorizontalEpsg, suggestedTies, visibleSections, handleSectionCreated],
)
```

- [ ] **Step 4: Export the new values from the hook**

Add `suggestedTies`, `handleSuggestTies`, `handleAcceptTie`, `handleRejectTie`, `handleClearTieSuggestions` to the object the hook returns (find the existing `return { ... }` and append them).

- [ ] **Step 5: Type-check**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors. (If `cpts`/`boreholes` are not yet hook inputs, the error will point you to the call site — thread them through there.)

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/src/hooks/useSections.ts
git commit -m "feat(sections): tie-suggestion state + accept/reject/suggest handlers"
```

---

## Task 5: Expose handlers through the shell + render the overlay + toolbar button

**Files:**
- Modify: `desktop/src/renderer/src/components/MapView.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx`
- (Verify) the shell context value file that aggregates `useSections` output (e.g. `hooks/useShellContextValue.ts`).

- [ ] **Step 1: Confirm the shell context exposes the new fields**

Open the file that builds the shell context value (search: `grep -rn "handleSectionLineDrawn" desktop/src/renderer/src/hooks/useShellContextValue.ts`). Confirm `useSections` output is spread/forwarded; if fields are forwarded explicitly, add `suggestedTies`, `handleSuggestTies`, `handleAcceptTie`, `handleRejectTie`, `handleClearTieSuggestions`, plus the existing `cpts`/`boreholes` (from `useInvestigationData`) if not already present.

- [ ] **Step 2: Mount the overlay in MapView**

In `MapView.tsx`, where `SectionOverlays` / `SectionLineDrawer` are rendered, add (reading the props the map already receives — `suggestedTies`, `effectiveHorizontalEpsg`/project epsg, and the accept/reject handlers, threaded the same way existing section props arrive):
```tsx
{suggestedTies.length > 0 && epsg != null && (
  <TieSuggestionOverlay
    ties={suggestedTies}
    epsg={epsg}
    onAccept={handleAcceptTie}
    onReject={handleRejectTie}
  />
)}
```
Add the import: `import { TieSuggestionOverlay } from './TieSuggestionOverlay'`.

- [ ] **Step 3: Add the toolbar button**

In `SectionsToolbar.tsx`, read `cpts`, `boreholes`, `handleSuggestTies`, `suggestedTies`, `handleClearTieSuggestions` from `useShell()`, and add a button next to "New cross-section":
```tsx
<ToolbarButton
  onClick={() =>
    suggestedTies.length > 0 ? handleClearTieSuggestions() : handleSuggestTies(cpts, boreholes)
  }
  disabled={sections.length < 2}
  title={sections.length < 2 ? 'Need at least 2 sections to tie together' : undefined}
>
  {suggestedTies.length > 0 ? 'Clear tie suggestions' : 'Suggest tie-sections'}
</ToolbarButton>
```
(Match the existing button primitive used in this file — `ToolbarButton` vs `PrimaryToolbarButton`.)

- [ ] **Step 4: Type-check + run the full renderer test suite**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npm test`
Expected: tsc clean; existing Vitest suite still green plus the new tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/MapView.tsx desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx desktop/src/renderer/src/hooks/useShellContextValue.ts
git commit -m "feat(sections): wire tie-suggestion overlay + toolbar action"
```

---

## Task 6: Settings row for the tie tolerance

**Files:**
- Modify: `desktop/src/renderer/src/components/SettingsDialog.tsx`

- [ ] **Step 1: Add the NumericInput row**

In the `'sections'` tab body (alongside the existing buffer + vertical-exaggeration rows), add a numeric row bound to `tieStrikeToleranceM`, persisting via the same `buildSectionDefaultsPatch` path the other section prefs use:
```tsx
<NumericInput
  label="Tie-section strike tolerance (m)"
  hint="How far apart along-strike two tests may be and still join the same auto-proposed tie. Wider = more ties, less clean."
  value={draft.tieStrikeToleranceM}
  min={SECTION_DEFAULTS_BOUNDS.tieStrikeToleranceM.min}
  max={SECTION_DEFAULTS_BOUNDS.tieStrikeToleranceM.max}
  onChange={v => setDraft(d => ({ ...d, tieStrikeToleranceM: v }))}
/>
```
(Match the exact prop names of the existing rows in this file — `label`/`hint`/`value`/`onChange` may differ; copy the buffer-m row and change the binding.)

- [ ] **Step 2: Type-check + test**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npm test`
Expected: clean + green.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/src/components/SettingsDialog.tsx
git commit -m "feat(sections): settings row for tie strike tolerance"
```

---

## Task 7: Playwright e2e — propose, accept, verify

**Files:**
- Create: `desktop/tests/e2e/flow_auto_tie.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Mirror an existing section-stage spec (e.g. `flow_auto_correlate`). The flow: open the seeded fixture (has ≥2 parallel sections), click "Suggest tie-sections", assert ≥1 green ghost line appears, click one to accept, assert a new section row named `Tie-section …` appears in the section list.
```typescript
// desktop/tests/e2e/flow_auto_tie.spec.ts
import { test, expect } from './fixtures' // match the existing e2e harness import
test('auto-tie: propose then accept creates a tie-section', async ({ page }) => {
  // ...navigate to the sections stage (copy setup from flow_auto_correlate.spec.ts)...
  await page.getByRole('button', { name: 'Suggest tie-sections' }).click()
  const ghosts = page.locator('path[stroke="#22c55e"]')
  await expect(ghosts.first()).toBeVisible()
  await ghosts.first().click()
  await expect(page.getByText(/Tie-section/)).toBeVisible()
})
```

- [ ] **Step 2: Run the e2e suite**

Run: `./scripts/run-e2e.ps1 flow_auto_tie`
Expected: PASS (offline, deterministic). Close the dev app first (port 8765).

- [ ] **Step 3: Commit**

```bash
git add desktop/tests/e2e/flow_auto_tie.spec.ts
git commit -m "test(sections): e2e auto-tie propose + accept"
```

---

## Self-Review

**Spec coverage (§5.1.1 + decision 5b + §2.1):**
- Non-crossing monotonic match → Task 1 ✓
- ~1 test per wall, spread-tolerance skip → Task 1 tests ✓
- Ghost propose + accept/reject (user-driven) → Tasks 3–5 ✓
- Tolerance pref (default ≈45 m) → Tasks 2, 6 ✓
- Reuses section create + correlation + resolver (no new correlation code) → Task 4 reuses `api.section.create`; correlation/resolver untouched ✓
- e2e → Task 7 ✓

**Out of scope (correctly deferred to Phase 2/3):** the solid builder, `litho_body_solid`, the litho-solids API, the Cesium render, per-body colour, lenses, drawn-shape fidelity. This plan stops at "the connected fence exists."

**Known integration verification points (not placeholders — real guards):**
- Task 4 Step 2 / Task 5 Step 1: confirm `cpts`/`boreholes` reach `useSections`/the toolbar via the shell; thread them if not.
- Task 5 Step 3 / Task 6 Step 1: match the exact toolbar-button and NumericInput prop names already used in those files.

**Type consistency:** `SuggestedTie`, `TieInvestigation`, `ParallelSection` defined in Task 1 are used unchanged in Tasks 3–5. `tieStrikeToleranceM` / `tie_strike_tolerance_m` naming consistent across Tasks 2 and 6.
