# Lithology Gradient Correlation Ribbon (#131-c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the point-to-point correlation edge line with a lithology-coloured "seam ribbon" — a fixed-height band straddling the correlated boundary, split into the lithology colour above and below the contact, gradient-blended across the gap when the lithology differs (a lens).

**Architecture:** Frontend-only, entirely inside `CorrelationEdgesOverlay.tsx`. A new pure helper derives the above/below lithology colour per contact from the existing `contacts` + `formations` props. The render block reads it per edge and emits two gradient-filled `<polygon>` stripes. Approved edges get a near-black seam line; pending edges get a faded fill + dashed amber outline + the existing drag handles.

**Tech Stack:** React + TypeScript, SVG (`<linearGradient userSpaceOnUse>`), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-28-litho-gradient-ribbon-design.md`

---

## File Structure

- **Modify** `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
  - Add module-level pure helper `contactStripeColors` (exported for tests).
  - Add three render constants (`RIBBON_HALF_HEIGHT_PX`, `RIBBON_APPROVED_OPACITY`, `RIBBON_PENDING_OPACITY`) + `RIBBON_SEAM_COLOR`.
  - Add a `stripeColorsByContactId` memo.
  - Replace the existing `contactEdges` line-render block with the ribbon block (keep the grab-handle sub-block).
- **Modify** `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`
  - New `describe('contactStripeColors')` unit block.
  - Rework `CC8`/`CC9` (line → ribbon) and add ribbon-render tests.
- **Modify** `docs/debt.md` — mark #131-c shipped.

The component already provides everything the ribbon needs: `contacts`, `formations`, `contactEdges`, `formationById` (memo, ~line 656), and `contactScreenMap` (memo, ~line 664, gives `contactId → { x, topY }`). The existing module helper `anchorId(c)` (~line 221) returns `c.cpt_id ?? c.borehole_id ?? null` and is reused by the new helper.

---

## Task 1: `contactStripeColors` pure helper

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx` (add exported helper after `buildContactScreenMap`, ~line 381)
- Test: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `CorrelationEdgesOverlay.test.tsx` (after the existing `buildBandMap` describe block, ~line 583). It reuses the file's `makeFormation` / `makeContact` factories. Note `makeFormation(id, name, ordinal)` defaults `color: '#4ade80'`; override colour via spread.

```tsx
// ---------------------------------------------------------------------------
// contactStripeColors — above/below lithology colour per contact (#131-c)
// ---------------------------------------------------------------------------
describe('contactStripeColors', () => {
  function fmt(id: string, color: string): GeologicalFormationResponse {
    return { ...makeFormation(id, id, null), color, litho_main_soil_code: 'ZAND' }
  }
  function byId(...fs: GeologicalFormationResponse[]) {
    return new Map(fs.map(f => [f.id, f]))
  }

  it('SC1: below = own formation colour, above = next-shallower formation colour', () => {
    // inv-1: ZAND (yellow) at 0 m over KLEI (grey) at 2 m.
    const contacts = [
      makeContact('c-zand', 'f-zand', 'inv-1', 'cpt', 0),
      makeContact('c-klei', 'f-klei', 'inv-1', 'cpt', 2),
    ]
    const formationById = byId(fmt('f-zand', '#fbbf24'), fmt('f-klei', '#6b7280'))
    const result = contactStripeColors(contacts, formationById)
    expect(result.get('c-klei')).toEqual({ above: '#fbbf24', below: '#6b7280' })
  })

  it('SC2: topmost contact has no above (null)', () => {
    const contacts = [
      makeContact('c-zand', 'f-zand', 'inv-1', 'cpt', 0),
      makeContact('c-klei', 'f-klei', 'inv-1', 'cpt', 2),
    ]
    const formationById = byId(fmt('f-zand', '#fbbf24'), fmt('f-klei', '#6b7280'))
    const result = contactStripeColors(contacts, formationById)
    expect(result.get('c-zand')).toEqual({ above: null, below: '#fbbf24' })
  })

  it('SC3: investigations do not bleed into each other ordering', () => {
    // inv-2 has only one (topmost) contact; its above must be null even
    // though inv-1 has a shallower contact.
    const contacts = [
      makeContact('c1', 'f-zand', 'inv-1', 'cpt', 0),
      makeContact('c2', 'f-klei', 'inv-1', 'cpt', 2),
      makeContact('c3', 'f-silt', 'inv-2', 'cpt', 3),
    ]
    const formationById = byId(
      fmt('f-zand', '#fbbf24'),
      fmt('f-klei', '#6b7280'),
      fmt('f-silt', '#84cc16'),
    )
    const result = contactStripeColors(contacts, formationById)
    expect(result.get('c3')).toEqual({ above: null, below: '#84cc16' })
  })

  it('SC4: contact whose formation is unknown is skipped', () => {
    const contacts = [makeContact('c-missing', 'f-gone', 'inv-1', 'cpt', 0)]
    const result = contactStripeColors(contacts, new Map())
    expect(result.has('c-missing')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx -t contactStripeColors`
Expected: FAIL — `contactStripeColors is not exported` / `is not a function`.

- [ ] **Step 3: Implement the helper**

In `CorrelationEdgesOverlay.tsx`, add immediately after the `buildContactScreenMap` function (~line 381):

```tsx
/**
 * Resolve the lithology colour above and below each contact, for the
 * gradient correlation ribbon (#131-c).
 *
 * A contact marks the TOP of its formation, so the colour BELOW the
 * contact is its own formation's colour, and the colour ABOVE is the
 * next-shallower contact's formation colour on the same investigation
 * (``null`` when the contact is the topmost — only the ground surface is
 * above it).  Contacts grouped by investigation and sorted shallow-first.
 *
 * Parameters
 * ----------
 * contacts
 *     Section-filtered litho contacts.
 * formationById
 *     Formation lookup (id → formation), for the ``color`` field.
 *
 * Returns
 * -------
 * Map<string, { above: string | null; below: string }>
 *     Keyed by contact id.  Contacts whose formation is missing from
 *     ``formationById`` are omitted.
 */
export function contactStripeColors(
  contacts: readonly FormationContactResponse[],
  formationById: ReadonlyMap<string, GeologicalFormationResponse>,
): Map<string, { above: string | null; below: string }> {
  const byInvest = new Map<string, FormationContactResponse[]>()
  for (const c of contacts) {
    const inv = anchorId(c)
    if (inv === null) continue
    const bucket = byInvest.get(inv)
    if (bucket) bucket.push(c)
    else byInvest.set(inv, [c])
  }
  const result = new Map<string, { above: string | null; below: string }>()
  for (const [, list] of byInvest) {
    const sorted = [...list].sort((a, b) => a.depth_top_m - b.depth_top_m)
    for (let i = 0; i < sorted.length; i += 1) {
      const c = sorted[i]
      const below = formationById.get(c.formation_id)?.color
      if (below === undefined) continue
      const prev = i > 0 ? sorted[i - 1] : null
      const above = prev ? (formationById.get(prev.formation_id)?.color ?? null) : null
      result.set(c.id, { above, below })
    }
  }
  return result
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx -t contactStripeColors`
Expected: PASS (SC1–SC4).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx
git commit -m "$(cat <<'EOF'
feat(sections): contactStripeColors helper for the litho ribbon (#131-c)

Derives the lithology colour above/below each contact (below = own
formation, above = next-shallower, null when topmost) from the existing
contacts + formations props.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Ribbon render block (replaces the edge line)

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx` (constants near line 57; memo near the other memos ~line 667; replace the `contactEdges` block ~lines 863–933)
- Test: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`

- [ ] **Step 1: Rework CC8/CC9 and add ribbon tests (failing)**

In `CorrelationEdgesOverlay.test.tsx`, **replace** the existing `CC8` and `CC9` tests (~lines 403–462) with the block below. CC8/CC9 now assert the ribbon group's `data-approved` + the approved seam / pending outline; the new SR* tests pin the stripes and gradients.

```tsx
  // CC8: approved contact edge renders a ribbon group with data-approved="true"
  // and a near-black seam line.
  it('CC8: approved contact edge renders ribbon with data-approved="true"', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e1', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('ribbon-e1').getAttribute('data-approved')).toBe('true')
    expect(screen.getByTestId('ribbon-seam-e1')).not.toBeNull()
    expect(screen.queryByTestId('ribbon-outline-e1')).toBeNull()
  })

  // CC9: unapproved contact edge renders a faded ribbon with a dashed amber
  // outline and data-approved="false".
  it('CC9: unapproved contact edge renders ribbon with data-approved="false"', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e2', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'auto', user_approved: false, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('ribbon-e2').getAttribute('data-approved')).toBe('false')
    const outline = screen.getByTestId('ribbon-outline-e2')
    expect(outline.getAttribute('stroke')).toBe('#f59e0b')
    expect(outline.getAttribute('stroke-dasharray')).toBe('4 4')
    expect(screen.queryByTestId('ribbon-seam-e2')).toBeNull()
  })

  // SR1: topmost-contact edge omits the above stripe (only below renders).
  it('SR1: topmost contacts omit the above stripe', () => {
    const fA = { ...makeFormation('f-a', 'Zand', 1), color: '#fbbf24' }
    // ca and cb are each the ONLY (hence topmost) contact on their column.
    const contacts = [
      makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e3', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fA],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.queryByTestId('ribbon-above-e3')).toBeNull()
    expect(screen.getByTestId('ribbon-below-e3')).not.toBeNull()
  })

  // SR2: a lens (below lithology differs across ends) yields different
  // below-gradient stops; the above gradient (same ZAND both ends) is equal.
  it('SR2: lens edge has differing below-gradient stops, equal above stops', () => {
    const fZand = { ...makeFormation('f-zand', 'Zand', null), color: '#fbbf24' }
    const fKlei = { ...makeFormation('f-klei', 'Klei', null), color: '#6b7280' }
    const fSilt = { ...makeFormation('f-silt', 'Silt', null), color: '#84cc16' }
    // inv-A: ZAND over KLEI; inv-B: ZAND over SILT. Correlate the lower contacts.
    const contacts = [
      makeContact('za', 'f-zand', 'inv-A', 'cpt', 0),
      makeContact('ka', 'f-klei', 'inv-A', 'cpt', 2),
      makeContact('zb', 'f-zand', 'inv-B', 'cpt', 0),
      makeContact('sb', 'f-silt', 'inv-B', 'cpt', 2),
    ]
    const edge = {
      id: 'e4', contact_a_id: 'ka', contact_b_id: 'sb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    const { container } = renderOverlay({
      contacts, formations: [fZand, fKlei, fSilt],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    const belowStops = container.querySelectorAll('#ribbon-below-grad-e4 stop')
    expect(belowStops[0].getAttribute('stop-color')).toBe('#6b7280') // KLEI (A)
    expect(belowStops[1].getAttribute('stop-color')).toBe('#84cc16') // SILT (B)
    const aboveStops = container.querySelectorAll('#ribbon-above-grad-e4 stop')
    expect(aboveStops[0].getAttribute('stop-color')).toBe('#fbbf24') // ZAND
    expect(aboveStops[1].getAttribute('stop-color')).toBe('#fbbf24') // ZAND
  })
```

- [ ] **Step 2: Run the reworked tests to verify they fail**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx -t "CC8|CC9|SR1|SR2"`
Expected: FAIL — `Unable to find an element by: [data-testid="ribbon-e1"]` (and friends); the old `contact-edge-*` testids no longer exist after Step 3/4.

- [ ] **Step 3: Add the ribbon constants**

In `CorrelationEdgesOverlay.tsx`, add after the `UNAPPROVED_EDGE_COLOR` / `UNAPPROVED_EDGE_DASH` constants (~line 59):

```tsx
/** Half-height (px) of the seam ribbon above and below the boundary line
 *  (#131-c). Fixed regardless of zoom so the ribbon reads consistently. */
const RIBBON_HALF_HEIGHT_PX = 12
/** Fill opacity for an approved (accepted) correlation ribbon. */
const RIBBON_APPROVED_OPACITY = 0.9
/** Fill opacity for a pending (unaccepted) correlation ribbon — faded so a
 *  section full of auto-proposed edges stays readable. */
const RIBBON_PENDING_OPACITY = 0.32
/** Near-black seam line through an approved ribbon (matches the #143 litho
 *  contact line so the boundary reads against the lithology fills). */
const RIBBON_SEAM_COLOR = '#0f172a'
```

- [ ] **Step 4: Add the memo and replace the edge-line render block**

(4a) Add the memo next to the other `useMemo`s, right after the `contactScreenMap` memo (~line 667):

```tsx
  // Above/below lithology colour per contact, for the gradient ribbon
  // (#131-c). Re-derived only when the contacts or the formation lookup
  // change.
  const stripeColorsByContactId = useMemo(
    () => contactStripeColors(contacts, formationById),
    [contacts, formationById],
  )
```

(4b) **Replace** the entire existing `contactEdges` render block — the JSX comment beginning `{/* Contact-level correlation edges (#133 Phase 1).` through the closing `)}` of that `contactEdges && contactEdges.length > 0` expression (~lines 863–933) — with:

```tsx
      {/* Contact-level correlation ribbons (#131-c). Each edge renders a
          seam ribbon straddling the correlated boundary: a top stripe in
          the lithology ABOVE the contact and a bottom stripe in the
          lithology BELOW, each a horizontal gradient from contact A's
          colour to contact B's (so a lens reads as a colour fade). The
          above stripe is omitted when either end is the topmost contact
          (no lithology above). Approved → solid + near-black seam line;
          pending → faded + dashed amber outline + drag handles. */}
      {contactEdges && contactEdges.length > 0 && (
        <g data-testid="contact-edges-overlay">
          {contactEdges.map(ce => {
            const ptA = contactScreenMap.get(ce.contact_a_id)
            const ptB = contactScreenMap.get(ce.contact_b_id)
            if (!ptA || !ptB) return null
            const approved = ce.user_approved
            const hs = DRAG_HANDLE_SIZE
            const H = RIBBON_HALF_HEIGHT_PX
            const stripesA = stripeColorsByContactId.get(ce.contact_a_id)
            const stripesB = stripeColorsByContactId.get(ce.contact_b_id)
            const aboveA = stripesA?.above ?? null
            const aboveB = stripesB?.above ?? null
            const belowA = stripesA?.below ?? null
            const belowB = stripesB?.below ?? null
            // Above stripe only when BOTH ends have a lithology above —
            // a one-sided gradient that fades into nothing is omitted.
            const showAbove = aboveA !== null && aboveB !== null
            const showBelow = belowA !== null && belowB !== null
            const fillOpacity = approved ? RIBBON_APPROVED_OPACITY : RIBBON_PENDING_OPACITY
            // Perimeter for the pending dashed outline — wraps whichever
            // stripes are present (top edge sits at −H only when the above
            // stripe shows, otherwise at the seam line).
            const topY_A = showAbove ? ptA.topY - H : ptA.topY
            const topY_B = showAbove ? ptB.topY - H : ptB.topY
            const botY_A = showBelow ? ptA.topY + H : ptA.topY
            const botY_B = showBelow ? ptB.topY + H : ptB.topY
            return (
              <g
                key={`ribbon-${ce.id}`}
                data-testid={`ribbon-${ce.id}`}
                data-approved={approved ? 'true' : 'false'}
                pointerEvents="none"
              >
                <defs>
                  {showAbove && (
                    <linearGradient
                      id={`ribbon-above-grad-${ce.id}`}
                      gradientUnits="userSpaceOnUse"
                      x1={ptA.x} y1={0} x2={ptB.x} y2={0}
                    >
                      <stop offset="0" stopColor={aboveA as string} />
                      <stop offset="1" stopColor={aboveB as string} />
                    </linearGradient>
                  )}
                  {showBelow && (
                    <linearGradient
                      id={`ribbon-below-grad-${ce.id}`}
                      gradientUnits="userSpaceOnUse"
                      x1={ptA.x} y1={0} x2={ptB.x} y2={0}
                    >
                      <stop offset="0" stopColor={belowA as string} />
                      <stop offset="1" stopColor={belowB as string} />
                    </linearGradient>
                  )}
                </defs>
                {showAbove && (
                  <polygon
                    data-testid={`ribbon-above-${ce.id}`}
                    points={`${ptA.x},${ptA.topY - H} ${ptB.x},${ptB.topY - H} ${ptB.x},${ptB.topY} ${ptA.x},${ptA.topY}`}
                    fill={`url(#ribbon-above-grad-${ce.id})`}
                    fillOpacity={fillOpacity}
                  />
                )}
                {showBelow && (
                  <polygon
                    data-testid={`ribbon-below-${ce.id}`}
                    points={`${ptA.x},${ptA.topY} ${ptB.x},${ptB.topY} ${ptB.x},${ptB.topY + H} ${ptA.x},${ptA.topY + H}`}
                    fill={`url(#ribbon-below-grad-${ce.id})`}
                    fillOpacity={fillOpacity}
                  />
                )}
                {approved ? (
                  <line
                    data-testid={`ribbon-seam-${ce.id}`}
                    x1={ptA.x} y1={ptA.topY} x2={ptB.x} y2={ptB.topY}
                    stroke={RIBBON_SEAM_COLOR}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                ) : (
                  <polygon
                    data-testid={`ribbon-outline-${ce.id}`}
                    points={`${ptA.x},${topY_A} ${ptB.x},${topY_B} ${ptB.x},${botY_B} ${ptA.x},${botY_A}`}
                    fill="none"
                    stroke={UNAPPROVED_EDGE_COLOR}
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    pointerEvents="none"
                  />
                )}
                {/* Grab handles — only on pending edges, interactive so the
                    user can drag an endpoint to a different contact. */}
                {!approved && onUnapprovedDragStart && (
                  <>
                    <rect
                      data-testid={`unapproved-handle-a-${ce.id}`}
                      x={ptA.x - hs / 2}
                      y={ptA.topY - hs / 2}
                      width={hs}
                      height={hs}
                      rx={2}
                      fill={UNAPPROVED_EDGE_COLOR}
                      opacity={0.85}
                      style={{ cursor: 'grab', pointerEvents: 'auto' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        onUnapprovedDragStart(e, ce, 'a')
                      }}
                    />
                    <rect
                      data-testid={`unapproved-handle-b-${ce.id}`}
                      x={ptB.x - hs / 2}
                      y={ptB.topY - hs / 2}
                      width={hs}
                      height={hs}
                      rx={2}
                      fill={UNAPPROVED_EDGE_COLOR}
                      opacity={0.85}
                      style={{ cursor: 'grab', pointerEvents: 'auto' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        onUnapprovedDragStart(e, ce, 'b')
                      }}
                    />
                  </>
                )}
              </g>
            )
          })}
        </g>
      )}
```

Note: the old constants `CONTACT_EDGE_COLOR`, `CONTACT_EDGE_WIDTH`, `CONTACT_EDGE_DASH`, `CONTACT_EDGE_OPACITY` are now unused. Remove them (~lines 43–53) — leaving them trips the `no-unused-vars` lint. `UNAPPROVED_EDGE_COLOR` and `UNAPPROVED_EDGE_DASH` stay (still used by the outline + the drag-ghost line below). Verify with the lint run in Step 6.

- [ ] **Step 5: Run the ribbon tests to verify they pass**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`
Expected: PASS — all CC*, CE*, SR*, SC*, and buildBandMap tests green.

- [ ] **Step 6: Type-check + lint + full vitest**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
Expected: exit 0 (no errors).

Run: `cd desktop && npx eslint src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
Expected: clean (confirms no unused-constant warnings after the removal in Step 4).

Run: `cd desktop && npx vitest run`
Expected: all suites pass (no regression in SectionPanel / SectionsCanvas tests that mount the overlay).

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx
git commit -m "$(cat <<'EOF'
feat(sections): lithology gradient correlation ribbon (#131-c)

Replaces the point-to-point edge line with a seam ribbon split into the
lithology colour above/below the contact, gradient-blended across the gap
for lenses. Approved = solid + near-black seam; pending = faded + dashed
amber outline + drag handles. Above stripe omitted on topmost contacts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Manual verification + docs

**Files:**
- Modify: `docs/debt.md`

- [ ] **Step 1: Manual dogfeed check (real app)**

Start the app (`cd desktop && npm run dev` with the backend running) and open a section with litho correlations. Confirm:
- An approved correlation renders as a two-stripe ribbon (above/below lithology colours) with a dark seam line.
- A lens (a correlation where the unit below differs across the two investigations) shows the bottom stripe fading from one colour to the other.
- A pending (auto-proposed, not yet accepted) correlation renders faded with a dashed amber outline and draggable endpoint handles.
- A correlation on the topmost units shows only the lower stripe.

If any check fails, return to Task 2 before continuing.

- [ ] **Step 2: Mark #131-c shipped in docs/debt.md**

In `docs/debt.md`, in the `## 131.` entry, update the "Owner ribbon-colour spec" / "#131-c" wording to mark the gradient-fill ribbon **SHIPPED 2026-05-28** (keep #131-a lens_id-FK opacity/dash variant and #131-b pinch-out terminus open). Also update the `* **#150**` priority-list line to note the ribbon shipped via #131-c. Follow the existing RESOLVED-note style used by #143/#145/#146.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/debt.md
git commit -m "$(cat <<'EOF'
docs(debt): mark #131-c (litho gradient ribbon) shipped

#131-a (lens_id-FK opacity/dash) and #131-b (pinch-out terminus) stay open.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review notes

- **Spec coverage:** helper (Task 1) ↔ "Data derivation"; ribbon geometry + states + gradients + omit-above + off-section skip (Task 2) ↔ "Ribbon geometry"/"State styling"/"Edge cases"; reworked edge-line tests + new pins (Task 2 Step 1) ↔ "Testing"; manual dogfeed (Task 3) ↔ verification gates. The "rendering approach" (linearGradient per stripe) is realised in Task 2 Step 4.
- **Type consistency:** `contactStripeColors` returns `{ above: string | null; below: string }` and is consumed in Task 2 as `stripesA?.above ?? null` / `stripesA?.below ?? null`; gradient ids `ribbon-above-grad-${id}` / `ribbon-below-grad-${id}` and testids `ribbon-${id}` / `ribbon-above-${id}` / `ribbon-below-${id}` / `ribbon-seam-${id}` / `ribbon-outline-${id}` are used identically in tests and implementation.
- **No placeholders:** every code step shows complete code; the only prose-described step is the docs edit (Task 3 Step 2), which follows an existing documented style.
