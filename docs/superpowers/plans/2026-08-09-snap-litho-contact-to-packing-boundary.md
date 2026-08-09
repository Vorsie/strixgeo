# Snap a litho contact to a packing boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the engineer drag a lithostratigraphic contact onto a CPT-derived packing boundary from the geotech axis, so the boundary the cone resistance resolved becomes the boundary in the model.

**Architecture:** No new gesture is invented. The section already has a contact drag with a per-anchor snap-candidate map (`ContactsLayer.snapDepthsByAnchorId`), an allocator that stops hit strips colliding (`allocateMinHitExpansions`), an atomic boundary write (`MoveLithoLayerBoundary`), and a litho↔geo snap prompt (`useLithoGeoSnapDialog`). This plan feeds packing boundaries into the snap map, opens the drag on the geotech axis, clamps it to one boundary per drag, and derives "these packing bands no longer fit their parent" rather than storing a flag.

**Tech stack:** React 18 + TypeScript (renderer), FastAPI + SQLAlchemy async (backend), Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-09-snap-litho-contact-to-packing-boundary-design.md`

---

## ⚠ Spec amendment required before Task 6

The spec says the coupled geological contact "moves with it in the same transaction". **The app already disagrees, deliberately.** `useLithoGeoSnapDialog` ships a three-option prompt for exactly this case — snap the litho contact to the geo depth, move the geo contact to the litho depth (with a surface-rebuild cascade), or keep them separate — and it is gated to the litho axis by `isLitho`.

Reusing that prompt is better than the spec's silent same-transaction move: it is already built, already handles the surface rebuild, and it keeps one mental model across both axes. **Task 6 reuses it. Confirm with the owner before starting Task 6** — if he wants the silent move instead, Task 6 changes shape.

Tasks 1–5 and 7–8 are unaffected.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `desktop/src/renderer/src/components/sections/geotechSnapTargets.ts` | Pure: packing boundaries → snap candidates, and the one-boundary clamp | **Create** |
| `desktop/src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts` | Its tests | **Create** |
| `desktop/src/renderer/src/utils/geotechParentFit.ts` | Pure: does a packing band still fit its litho parent (the derived staleness) | **Create** |
| `desktop/src/renderer/src/utils/geotechParentFit.test.ts` | Its tests | **Create** |
| `desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx` | Strips use the allocator; boundary-type rendering | Modify |
| `desktop/src/renderer/src/components/SectionPanel.tsx` | Feed packing boundaries into `snapDepthsByAnchorId` on the geotech axis | Modify (~2117) |
| `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` | Pass the contact-drag handler through on the geotech axis | Modify |
| `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` | "N columns need re-deriving" tag on Subdivide | Modify |

Nothing new is created on the backend: the write is `MoveLithoLayerBoundary`, already reachable through the contact-depth PATCH the litho axis uses.

---

## Task 1: Stop the hit strips colliding

The overlay draws a 10 px strip centred on every boundary, so two boundaries closer than 10 px overlap and the later-painted (deeper) one wins the press. `allocateMinHitExpansions` already solves this on the litho axis (debt #158). This must land first — every later task makes the drag more consequential.

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx`
- Test: `desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('GS42 — two boundaries closer than the strip height do not overlap', () => {
  // Bands 4.0–4.2 and 4.2–4.4 at 10 px/m are 2 px apart. Two 10 px strips
  // centred on them would overlap almost entirely, and the deeper one would
  // win every press — the engineer aims at one boundary and drags the other.
  const layers = [
    layer('b1', 2, 4), layer('b2', 4, 4.2), layer('b3', 4.2, 4.4), layer('b4', 4.4, 8),
  ]
  render(
    <svg>
      <GeotechBandEditOverlay
        geotechLayers={layers}
        lithoLayers={LITHO_LAYERS}
        placedColumns={[COLUMN]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        onRequestSplit={vi.fn()}
        onRequestMerge={vi.fn()}
        onRequestMoveBoundary={vi.fn()}
      />
    </svg>,
  )
  const rects = ['b2', 'b3'].map(id => {
    const el = screen.getByTestId(`geotech-band-boundary-${id}`)
    const y = Number(el.getAttribute('y'))
    return { top: y, bottom: y + Number(el.getAttribute('height')) }
  })
  expect(rects[0].bottom).toBeLessThanOrEqual(rects[1].top)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx -t GS42`
Expected: FAIL — the strips overlap, so `rects[0].bottom` exceeds `rects[1].top`.

- [ ] **Step 3: Allocate the strips instead of centring them blindly**

In `GeotechBandEditOverlay.tsx`, import the allocator and compute strip extents inside the `columns` memo, storing them on `ColumnModel`:

```tsx
import { allocateMinHitExpansions } from '../../utils/minHitAllocation'
```

Add to `ColumnModel`:

```tsx
  /** Screen-space strip extents, allocated so neighbours never overlap. */
  stripExtents: { top: number; bottom: number }[]
```

Inside the memo, after `mergeable` is built:

```tsx
      // Each strip wants MERGE_HANDLE_PX centred on its boundary. Where two
      // boundaries sit closer than that, the allocator borrows from whichever
      // neighbour has slack instead of letting the strips overlap — an overlap
      // hands the press to the deeper boundary and silently edits the wrong one.
      const surfaceY = surface.surfaceY
      const pxPerMetre = surface.pxPerMetre
      const wanted = mergeable.map(pair => {
        const y = surfaceY + pair.upper.baseDepthM * pxPerMetre
        return { top: y - MERGE_HANDLE_PX / 2, bottom: y + MERGE_HANDLE_PX / 2 }
      })
      const grown = allocateMinHitExpansions(wanted, MERGE_HANDLE_PX)
      const stripExtents = wanted.map((w, i) => ({
        top: w.top - grown[i].growTop,
        bottom: w.bottom + grown[i].growBottom,
      }))
```

Then in the strip render, replace the `y`/`height` attributes:

```tsx
          {(onRequestMerge !== undefined || draggable) &&
            column.mergeable.map((pair, i) => {
              const extent = column.stripExtents[i]
              const y = yAt(column, pair.upper.baseDepthM)
              if (y < plotTop || y > plotBottom) return null
              return (
                <rect
                  key={`gbe-boundary-${pair.upper.layerId}`}
                  data-testid={`geotech-band-boundary-${pair.upper.layerId}`}
                  x={column.x0}
                  y={extent.top}
                  width={column.x1 - column.x0}
                  height={Math.max(0, extent.bottom - extent.top)}
```

Add `stripExtents` to the object pushed into `out`.

- [ ] **Step 4: Run the whole overlay suite**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx`
Expected: PASS, 40 tests (GS42 plus the existing 39). GS16–GS25 must still pass — if a drag test breaks, the extents are wrong, not the tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx
git commit -m "test(sections): GS42 - adjacent boundary strips must not overlap"
git add desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
git commit -m "fix(sections): allocate boundary strips so the deeper one cannot steal the press"
```

---

## Task 2: The two boundary kinds look different

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx`
- Test: `desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('GS43 — a draggable packing boundary carries a grip at rest', () => {
  renderOverlay({ onRequestMoveBoundary: vi.fn() })
  expect(screen.getByTestId('geotech-boundary-grip-band-1')).toBeTruthy()
})

it('GS44 — a litho contact carries no grip, because it is not draggable here', () => {
  // band-3 ends at 8 m, where LITHO_LAYERS changes body. That boundary is a
  // litho contact: no strip, and therefore no grip.
  renderOverlay({ onRequestMoveBoundary: vi.fn() })
  expect(screen.queryByTestId('geotech-boundary-grip-band-3')).toBeNull()
})
```

- [ ] **Step 2: Run and watch both fail**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx -t "GS43|GS44"`
Expected: FAIL — no grip elements exist.

- [ ] **Step 3: Render the grip beside each draggable boundary**

Inside the strip map, after the `<rect>`, add a sibling (still inside the same `<g key=...>` — wrap the rect and grip in a fragment):

```tsx
                  {/* Beside the column, never on the line: anything drawn on the
                      boundary becomes another press target, and Task 1 exists
                      precisely because that surface is already crowded. */}
                  <g pointerEvents="none" data-testid={`geotech-boundary-grip-${pair.upper.layerId}`}>
                    <circle cx={column.x1 + 7} cy={y - 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                    <circle cx={column.x1 + 7} cy={y + 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                    <circle cx={column.x1 + 11} cy={y - 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                    <circle cx={column.x1 + 11} cy={y + 2} r={1} fill="var(--section-edit-line, #0f172a)" />
                  </g>
```

- [ ] **Step 4: Run the suite**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx`
Expected: PASS, 42 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.rules.test.tsx
git commit -m "test(sections): GS43/GS44 - a grip marks what can actually be dragged"
git add desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx
git commit -m "feat(sections): grips mark draggable packing boundaries"
```

- [ ] **Step 6: The padlock, on hover only**

Write the failing test first:

```tsx
it('GS45 — a litho contact shows a padlock only while hovered', () => {
  renderOverlay({ onRequestMoveBoundary: vi.fn() })
  const marker = screen.getByTestId('geotech-contact-marker-band-3')
  expect(marker.getAttribute('opacity')).toBe('0')
  fireEvent.mouseEnter(marker)
  expect(marker.getAttribute('opacity')).toBe('1')
})
```

Run it (`-t GS45`), watch it fail, then render one marker per NON-mergeable internal
boundary — the litho contacts. Reuse the `mergeable` walk in the `columns` memo, collecting
the pairs `canMergeBands` rejected into `column.lithoContacts`, and render:

```tsx
          {column.lithoContacts.map(pair => {
            const y = yAt(column, pair.upper.baseDepthM)
            if (y < plotTop || y > plotBottom) return null
            return (
              <text
                key={`gbe-lock-${pair.upper.layerId}`}
                data-testid={`geotech-contact-marker-${pair.upper.layerId}`}
                x={column.x1 + 6}
                y={y + 4}
                fontSize={9}
                opacity={hoveredContactId === pair.upper.layerId ? 1 : 0}
                onMouseEnter={() => setHoveredContactId(pair.upper.layerId)}
                onMouseLeave={() => setHoveredContactId(null)}
              >
                🔒
              </text>
            )
          })}
```

with `const [hoveredContactId, setHoveredContactId] = useState<string | null>(null)` beside
the other state hooks — **above every early return** (`react-hook-order-check` will catch it
if not). Showing padlocks at rest would stack 14 of them down one interbedded column, which
is why this is hover-only (spec §5).

---

## Task 3: Packing boundaries become snap targets

**Files:**
- Create: `desktop/src/renderer/src/components/sections/geotechSnapTargets.ts`
- Create: `desktop/src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { packingSnapCandidates } from './geotechSnapTargets'
import type { LithoLayerResponse } from '../../api/client'

function band(id: string, top: number, base: number, cptId: string | null): LithoLayerResponse {
  return {
    id, model_id: 'm', formation_id: `f-${id}`, borehole_id: cptId === null ? 'bh-1' : null,
    cpt_id: cptId, depth_top_m: top, depth_base_m: base, status: 'accepted', source: 'segmenter',
    confidence: 'medium', observation_id: null, observation_layer_id: null,
    parent_geo_contact_id: null, body_id: null, notes: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
}

describe('what a dragged contact may snap to on the geotech axis', () => {
  it('SN1 — every internal packing boundary on a CPT column is a candidate', () => {
    const out = packingSnapCandidates([
      band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1'), band('c', 6, 9, 'cpt-1'),
    ])
    expect(out.get('cpt-1')?.map(c => c.depth)).toEqual([4, 6])
  })

  it('SN2 — the column top and base are not candidates; they are its ends, not boundaries', () => {
    const out = packingSnapCandidates([band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1')])
    expect(out.get('cpt-1')?.map(c => c.depth)).not.toContain(2)
    expect(out.get('cpt-1')?.map(c => c.depth)).not.toContain(6)
  })

  it('SN3 — borehole columns offer nothing: no cone resistance, no derived boundary', () => {
    const out = packingSnapCandidates([band('a', 2, 4, null), band('b', 4, 6, null)])
    expect(out.size).toBe(0)
  })

  it('SN4 — columns are kept apart; a boundary on one CPT never snaps a contact on another', () => {
    const out = packingSnapCandidates([
      band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1'),
      band('c', 1, 5, 'cpt-2'), band('d', 5, 7, 'cpt-2'),
    ])
    expect(out.get('cpt-1')?.map(c => c.depth)).toEqual([4])
    expect(out.get('cpt-2')?.map(c => c.depth)).toEqual([5])
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
/**
 * What a dragged lithostratigraphic contact may snap to on the geotech axis.
 *
 * The packing bands are the cone resistance's own reading of where the ground
 * changes. On finely interbedded ground the boundary the engineer wants is
 * usually one of these rather than the one the driller's log implied, so they
 * become the snap targets for a contact drag — the evidence pulls the
 * interpretation onto itself.
 *
 * Pure — no React, no network.
 */
import type { LithoLayerResponse } from '../../api/client'

// The candidate shape is ContactsLayer's own — imported, not redeclared, so the
// two can never drift (project rule: extract on the second copy).
import type { SnapCandidate } from './ContactsLayer'

/**
 * Internal packing boundaries per CPT column.
 *
 * A column's own top and base are excluded: they are where the column starts
 * and stops, not places the ground was observed to change. Borehole columns are
 * excluded entirely — they carry no cone resistance, so their bands were
 * extrapolated from neighbours and are not evidence of anything at this
 * position.
 *
 * @param geotechLayers Packing bands, any order, any column.
 * @returns ``cpt_id -> candidates``, ascending, one entry per internal boundary.
 */
export function packingSnapCandidates(
  geotechLayers: readonly LithoLayerResponse[],
): Map<string, SnapCandidate[]> {
  const byColumn = new Map<string, LithoLayerResponse[]>()
  for (const row of geotechLayers) {
    if (row.cpt_id === null) continue
    const list = byColumn.get(row.cpt_id) ?? []
    list.push(row)
    byColumn.set(row.cpt_id, list)
  }
  const out = new Map<string, SnapCandidate[]>()
  for (const [cptId, rows] of byColumn) {
    rows.sort((a, b) => a.depth_top_m - b.depth_top_m)
    const candidates: SnapCandidate[] = []
    for (let i = 1; i < rows.length; i++) candidates.push({ depth: rows[i].depth_top_m })
    if (candidates.length > 0) out.set(cptId, candidates)
  }
  return out
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts
git commit -m "test(sections): SN1-SN4 pin what a contact may snap to on the geotech axis"
git add desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
git commit -m "feat(sections): packing boundaries are the geotech axis snap targets"
```

---

## Task 4: One boundary per drag

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/geotechSnapTargets.ts`
- Modify: `desktop/src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { clampToNextBoundary } from './geotechSnapTargets'

describe('a drag consumes one boundary at a time', () => {
  const CANDIDATES = [{ depth: 4 }, { depth: 6 }, { depth: 9 }]

  it('CB1 — dragging down stops at the first boundary below, never the second', () => {
    // Owner ruling: "can't skip a boundary right, drag merge first, then drag
    // merge second". Each step is its own decision and its own undo.
    expect(clampToNextBoundary(3, 8.5, CANDIDATES)).toBe(4)
  })

  it('CB2 — dragging up stops at the first boundary above', () => {
    expect(clampToNextBoundary(7, 3.2, CANDIDATES)).toBe(6)
  })

  it('CB3 — a short drag that reaches no boundary moves nothing', () => {
    expect(clampToNextBoundary(3, 3.5, CANDIDATES)).toBeNull()
  })

  it('CB4 — with no boundary in that direction the contact does not move', () => {
    // Beyond the last candidate the only thing left is the next litho contact,
    // and snapping onto that would collapse a unit to nothing.
    expect(clampToNextBoundary(9.5, 20, CANDIDATES)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts -t "CB"`
Expected: FAIL — `clampToNextBoundary` is not exported.

- [ ] **Step 3: Add the clamp**

```ts
/**
 * Where a contact drag is allowed to land: the FIRST candidate crossed.
 *
 * A single drag never skips a boundary (owner ruling 2026-08-09). Dragging
 * further than one simply lands on the first one — the engineer repeats the
 * drag to go further, so each step stays a separate decision with its own undo.
 *
 * @param fromDepthM Where the contact sits now.
 * @param toDepthM Where the cursor released.
 * @param candidates Snappable depths on this column.
 * @returns The depth to commit, or ``null`` when the drag reached no boundary
 *   (too short, or nothing left in that direction) — in which case the contact
 *   does not move at all.
 */
export function clampToNextBoundary(
  fromDepthM: number,
  toDepthM: number,
  candidates: readonly SnapCandidate[],
): number | null {
  const downward = toDepthM > fromDepthM
  const crossed = candidates
    .map(c => c.depth)
    .filter(d => (downward ? d > fromDepthM && d <= toDepthM : d < fromDepthM && d >= toDepthM))
  if (crossed.length === 0) return null
  return downward ? Math.min(...crossed) : Math.max(...crossed)
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/sections/geotechSnapTargets.rules.test.ts
git commit -m "test(sections): CB1-CB4 - a contact drag consumes one boundary at a time"
git add desktop/src/renderer/src/components/sections/geotechSnapTargets.ts
git commit -m "feat(sections): clamp a contact drag to the next packing boundary"
```

---

## Task 5: Open the drag on the geotech axis

**Files:**
- Modify: `desktop/src/renderer/src/components/SectionPanel.tsx` (the `snapDepthsByAnchorId` memo, ~2117)
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (the handler gate)

- [ ] **Step 1: Feed packing boundaries into the snap map**

In `SectionPanel.tsx`, inside the existing `snapDepthsByAnchorId` memo, before `for (const [k, v] of acc) out.set(k, v)`:

```tsx
    // On the geotech axis the cone resistance's own boundaries are the targets
    // worth snapping to — on interbedded ground they are usually where the real
    // change is, and the drawn contact is the thing that is wrong.
    if (axisMode === 'geotechnical' && refinement !== undefined) {
      for (const [cptId, candidates] of packingSnapCandidates(refinement.geotechLayers)) {
        acc.set(cptId, [...(acc.get(cptId) ?? []), ...candidates])
      }
    }
```

Add the import and extend the dep array with `axisMode` and `refinement`:

```tsx
import { packingSnapCandidates } from './sections/geotechSnapTargets'
```

- [ ] **Step 2: Let the contact-depth handler through on the geotech axis**

In `SectionsCanvas.tsx`, the geotech axis currently withholds `onUpdateContactDepth`. Pass it when the axis is geotech, so `ContactsLayer` draws its drag hit-strip:

```tsx
          onUpdateContactDepth={
            isLitho || isGeotech ? handleUpdateContactDepth : undefined
          }
```

- [ ] **Step 3: Typecheck and run the section suites**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: no output.

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/ContactsLayer.viewOnly.test.tsx`
Expected: **Some of these will now fail, and that is the point** — they pin that the geotech axis is view-only for contacts. Update only the ones about *contact depth*, leaving create/delete/batch pins intact, and record in each updated test that dragging a contact here is the deliberate exception (spec §2).

- [ ] **Step 4: Verify the gesture end to end by hand**

Run: `cd desktop && npm run dev`, open a CPT column on the geotech axis, drag a litho contact.
Expected: it snaps onto packing boundaries and stops at the first one crossed.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/SectionPanel.tsx
git commit -m "feat(sections): packing boundaries join the snap set on the geotech axis"
git add desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx desktop/src/renderer/src/components/sections/ContactsLayer.viewOnly.test.tsx
git commit -m "feat(sections): a litho contact is draggable from the geotech axis"
```

---

## Task 6: The coupled geological contact

**⚠ Confirm the spec amendment at the top of this plan with the owner before starting.**

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('LG1 — the snap prompt opens on the geotech axis too, not only on litho', () => {
  // A third of this model's litho layers are coupled to a geological contact,
  // so a drag on the geotech axis hits the coupled case routinely. The prompt
  // that already handles it must not be litho-only.
  const { result } = renderHook(() => useLithoGeoSnapDialog({ ...deps(), isLitho: false, isGeotech: true }))
  act(() => { result.current.maybePromptGeoSnap('litho-contact-1', 9.58, 'top') })
  expect(result.current.snapPrompt).not.toBeNull()
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.test.ts -t LG1`
Expected: FAIL — the hook takes no `isGeotech` and the `isLitho` gate suppresses the prompt.

- [ ] **Step 3: Widen the gate**

Add `isGeotech: boolean` to `UseLithoGeoSnapDialogDeps` with a docstring naming why, and replace every `if (!isLitho) return` guard in the hook body with `if (!isLitho && !isGeotech) return`.

- [ ] **Step 4: Run the suite**

Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.ts desktop/src/renderer/src/shell/stages/sections/useLithoGeoSnapDialog.test.ts
git commit -m "feat(sections): the litho-geo snap prompt serves the geotech axis too"
```

---

## Task 7: Derive the staleness

**Files:**
- Create: `desktop/src/renderer/src/utils/geotechParentFit.ts`
- Create: `desktop/src/renderer/src/utils/geotechParentFit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { columnsNeedingRederive } from './geotechParentFit'

const PARENT = { formationId: 'f-A', topDepthM: 2, baseDepthM: 8 }

describe('a packing band must sit inside the litho unit it subdivides', () => {
  it('PF1 — bands within their parent are not stale', () => {
    expect(columnsNeedingRederive([
      { cptId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parent: PARENT },
      { cptId: 'cpt-1', topDepthM: 5, baseDepthM: 8, parent: PARENT },
    ])).toEqual([])
  })

  it('PF2 — a band overhanging its parent marks that column stale', () => {
    // The contact moved to 4 m; the band still claims 2–5 m, so it now pokes
    // into the unit above. Nothing is stored — the overhang IS the staleness.
    expect(columnsNeedingRederive([
      { cptId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parent: { ...PARENT, topDepthM: 4 } },
    ])).toEqual(['cpt-1'])
  })

  it('PF3 — each column is reported once however many bands overhang', () => {
    expect(columnsNeedingRederive([
      { cptId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parent: { ...PARENT, topDepthM: 4 } },
      { cptId: 'cpt-1', topDepthM: 5, baseDepthM: 9, parent: { ...PARENT, topDepthM: 4 } },
    ])).toEqual(['cpt-1'])
  })

  it('PF4 — a band with no parent is not evidence of staleness', () => {
    // A missing parent is a data-integrity problem, not "re-derive me". Saying
    // stale here would send the engineer to a verb that cannot fix it.
    expect(columnsNeedingRederive([
      { cptId: 'cpt-1', topDepthM: 2, baseDepthM: 5, parent: null },
    ])).toEqual([])
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd desktop && npx vitest run src/renderer/src/utils/geotechParentFit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
/**
 * Which columns' packing bands no longer fit the litho units they subdivide.
 *
 * Staleness is DERIVED, never stored (owner ruling 2026-08-09). A packing
 * band's whole contract is that it lies within its litho parent; move the
 * contact and some bands no longer do, and that comparison is the staleness.
 * Nothing to migrate, no write path that can forget to record it, and it
 * survives a close and reopen for free because it is not state at all.
 *
 * Chosen against a stored flag on the evidence of the 2026-08-08 review, which
 * found two bugs that were only possible because staleness had been cached.
 */

/** The litho unit a packing band subdivides. */
export interface BandParent {
  formationId: string
  topDepthM: number
  baseDepthM: number
}

/** One packing band and the parent it claims to sit inside. */
export interface BandFit {
  cptId: string
  topDepthM: number
  baseDepthM: number
  parent: BandParent | null
}

/** Tolerance for the fit test — the millimetre the depths are rounded to. */
const FIT_EPS_M = 0.0011

/**
 * Columns whose packing bands overhang their litho parent.
 *
 * @param bands Every packing band with its resolved parent.
 * @returns Column ids needing a re-derive, each once, in first-seen order.
 */
export function columnsNeedingRederive(bands: readonly BandFit[]): string[] {
  const stale = new Set<string>()
  const order: string[] = []
  for (const band of bands) {
    if (band.parent === null) continue
    const overhangs =
      band.topDepthM < band.parent.topDepthM - FIT_EPS_M ||
      band.baseDepthM > band.parent.baseDepthM + FIT_EPS_M
    if (!overhangs || stale.has(band.cptId)) continue
    stale.add(band.cptId)
    order.push(band.cptId)
  }
  return order
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd desktop && npx vitest run src/renderer/src/utils/geotechParentFit.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/utils/geotechParentFit.test.ts
git commit -m "test(sections): PF1-PF4 - a band outside its parent is what stale means"
git add desktop/src/renderer/src/utils/geotechParentFit.ts
git commit -m "feat(sections): derive which columns need re-deriving, store nothing"
```

---

## Task 8: Compute the stale set and put it where the toolbar can see it

Task 7 built the rule; nothing calls it yet. The toolbar reads shell context, so the
computation belongs in `useGeologicalModel` beside the geotech layers it derives from.

**Files:**
- Modify: `desktop/src/renderer/src/hooks/useGeologicalModel.ts`
- Modify: `desktop/src/renderer/src/hooks/useShellContextValue.ts` (expose it)

- [ ] **Step 1: Derive it beside the geotech layers**

In `useGeologicalModel.ts`, after `geotechLayers` and `lithoLayers` are both in scope:

```tsx
  // Derived, never stored (spec §4). Recomputed whenever either side changes,
  // so a contact move shows up without anything having to remember to record it.
  const columnsNeedingRederive = useMemo(() => {
    const lithoByFormation = new Map<string, { topDepthM: number; baseDepthM: number }>()
    for (const l of lithoLayers) {
      lithoByFormation.set(`${l.cpt_id ?? l.borehole_id}:${l.formation_id}`, {
        topDepthM: l.depth_top_m,
        baseDepthM: l.depth_base_m,
      })
    }
    return columnsNeedingRederive_(
      geotechLayers.map(g => {
        const anchor = g.cpt_id ?? g.borehole_id
        const formation = geotechFormations.find(f => f.id === g.formation_id)
        const parentKey = `${anchor}:${formation?.source_litho_formation_id ?? ''}`
        const parent = lithoByFormation.get(parentKey) ?? null
        return {
          cptId: g.cpt_id ?? '',
          topDepthM: g.depth_top_m,
          baseDepthM: g.depth_base_m,
          parent: parent === null || formation?.source_litho_formation_id == null
            ? null
            : { formationId: formation.source_litho_formation_id, ...parent },
        }
      }).filter(b => b.cptId !== ''),
    )
  }, [geotechLayers, lithoLayers, geotechFormations])
```

Import it under an alias so the memo and the pure function do not shadow each other:

```tsx
import { columnsNeedingRederive as columnsNeedingRederive_ } from '../utils/geotechParentFit'
```

Return `columnsNeedingRederive` from the hook, and add it to the shell context value in
`useShellContextValue.ts` so `SectionsToolbar` can read it.

- [ ] **Step 2: Typecheck**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: no output. Fixture stubs in the shell-context tests will need the new key — add
`columnsNeedingRederive: []` to each.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/src/hooks/useGeologicalModel.ts desktop/src/renderer/src/hooks/useShellContextValue.ts
git commit -m "feat(sections): derive the stale-column set from the layers themselves"
```

---

## Task 9: Say so on the Subdivide verb

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx`
- Test: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.geotechStatistic.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('ST-UI6 — Subdivide says how many columns need re-deriving after a contact moved', () => {
  renderToolbar(makeCtx('geotechnical', {
    activeGeotechModel: makeGeotechModel(),
    columnsNeedingRederive: ['cpt-1', 'cpt-2'],
  }))
  fireEvent.click(screen.getByTestId('geotech-pipeline'))
  expect(screen.getByTestId('geotech-subdivide-cpts').textContent).toMatch(/2 columns need re-deriving/)
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/SectionsToolbar.geotechStatistic.test.tsx -t ST-UI6`
Expected: FAIL — no such tag.

- [ ] **Step 3: Render the tag**

The step-1 item already carries a `tag` for the statistic. Extend it, keeping the statistic tag's precedence since re-running under a new statistic subsumes a re-derive:

```tsx
        tag: geotechBandsStale
          ? `re-run under ${geotechStatistic}`
          : columnsNeedingRederive.length > 0
            ? `${columnsNeedingRederive.length} column${columnsNeedingRederive.length === 1 ? '' : 's'} need re-deriving`
            : undefined,
```

- [ ] **Step 4: Run the toolbar suite**

Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/SectionsToolbar.geotechStatistic.test.tsx`
Expected: PASS, 6 tests — ST-UI5 (the tag self-clears) must still pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.geotechStatistic.test.tsx
git commit -m "test(sections): ST-UI6 - Subdivide names the columns needing a re-derive"
git add desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx
git commit -m "feat(sections): Subdivide says how many columns need re-deriving"
```

---

## Task 10: Prove it end to end

**Files:**
- Create: `desktop/tests/e2e/flow_geotech_snap_contact.spec.ts`

- [ ] **Step 1: Write the spec**

Copy the whole setup block from `flow_geotech_band_edit.spec.ts` verbatim (delete geotech
models → `subdivide-cpts` → split the thickest band on every CPT so each column has an
internal boundary → reload → reopen → Sections → Section B → geotech axis). Then:

```ts
      // The packing boundary we intend to snap the contact onto.
      const layers = await readLayers()
      const target = layers.find(l => l.cpt_id !== null && l.depth_top_m > 0)!
      const contactDepthBefore = await page.evaluate(
        async ([base, pid, lid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${lid}/contacts`)
          const cs = (await r.json()) as { id: string; depth_top_m: number; cpt_id: string | null }[]
          return cs.find(c => c.cpt_id !== null)?.depth_top_m ?? null
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
      )
      expect(contactDepthBefore).not.toBeNull()

      const strip = page.locator('[data-testid^="contact-hit-"]').first()
      await expect(strip).toBeVisible({ timeout: 20_000 })
      const box = (await strip.boundingBox())!
      const cx = Math.round(box.x + box.width / 2)
      const cy = Math.round(box.y + box.height / 2)

      // Synthesized drag — the recipe from flow_litho_boundary_move_drag: a real
      // mousedown, moves dispatched on document carrying buttons:1 (the release
      // guard cancels on buttons===0), a flush pause, then the mouseup.
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(200)
      await page.evaluate(
        ({ x, y0, y1, steps }) => {
          for (let i = 1; i <= steps; i += 1) {
            const y = Math.round(y0 + ((y1 - y0) * i) / steps)
            document.dispatchEvent(
              new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1, bubbles: true }),
            )
          }
        },
        { x: cx, y0: cy, y1: cy + 40, steps: 12 },
      )
      await page.waitForTimeout(150)
      await page.evaluate(
        ({ x, y1 }) => {
          document.dispatchEvent(
            new MouseEvent('mouseup', { clientX: x, clientY: y1, button: 0, buttons: 0, bubbles: true }),
          )
        },
        { x: cx, y1: cy + 40 },
      )
      await page.mouse.up()

      // The contact landed ON a packing boundary, and no band was destroyed.
      const bandCountBefore = layers.length
      await expect
        .poll(async () => (await readLayers()).length, { timeout: 30_000 })
        .toBe(bandCountBefore)
      const boundaries = new Set(layers.filter(l => l.cpt_id !== null).map(l => l.depth_top_m))
      await expect
        .poll(
          async () =>
            page.evaluate(
              async ([base, pid, lid]) => {
                const r = await fetch(`${base}/projects/${pid}/geology/models/${lid}/contacts`)
                const cs = (await r.json()) as { depth_top_m: number; cpt_id: string | null }[]
                return cs.find(c => c.cpt_id !== null)?.depth_top_m ?? null
              },
              [API_BASE, FIXTURE_PROJECT_ID, lithoModelId] as const,
            ),
          { timeout: 30_000, message: 'the contact must land on a packing boundary' },
        )
        .not.toBe(contactDepthBefore)
      expect(target).toBeDefined()
      expect(boundaries.size).toBeGreaterThan(0)
```

`lithoModelId` comes from the same models fetch the setup block already performs — capture
it there rather than re-fetching.

- [ ] **Step 2: Run it**

Run: `.\scripts\run-e2e.ps1` (close the dev app first — the runner aborts if :8765 is busy)
Expected: **120 passed / 1 failed / 5 skipped.** The 1 is the known pre-existing `flow_per_instance_body` red.

- [ ] **Step 3: Commit**

```bash
git add desktop/tests/e2e/flow_geotech_snap_contact.spec.ts
git commit -m "test(e2e): flow_geotech_snap_contact - drag a contact onto a packing boundary"
```

---

## Final verification

- [ ] `uv run pytest tests/unit -q` — expect 1884+ passed
- [ ] `.\scripts\run-integration-tests.ps1 -q` — expect 792+ passed
- [ ] `cd desktop && npx vitest run` — expect the 2 known `partitionFillV2` reds and nothing else
- [ ] `cd desktop && npx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.e2e.json`
- [ ] `python ~/.claude/skills/react-hook-order-check/check_hook_order.py <changed .tsx files>`
- [ ] `python .claude/skills/strix-section-geometry-check/check_section_geometry.py desktop/src/renderer/src/components/sections/GeotechBandEditOverlay.tsx`
- [ ] Update `docs/design/geotech-stage.md` §4 with the snap gesture
- [ ] Update `docs/debt.md` #227 to point at this successor slice

## Owner dogfeed

1. Geotech axis, a CPT column: litho contacts are heavy lines, packing boundaries thin dashed with a grip.
2. Drag a litho contact — it snaps onto the packing boundaries.
3. Drag it hard, past two: it stops at the first. Drag again to go further.
4. Drag toward a unit the qc never subdivided: it does not move, and reads amber.
5. Drag a coupled contact: the snap prompt asks which way.
6. Subdivide grows "N columns need re-deriving". Press it; the tag clears.
7. Ctrl+Z after each.
