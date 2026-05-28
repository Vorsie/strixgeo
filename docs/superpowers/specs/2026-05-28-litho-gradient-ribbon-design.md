# Lithology gradient correlation ribbon (#131-c) — design

**Date:** 2026-05-28
**Debt item:** #131-c (folded in from #150; see `docs/debt.md`)
**Status:** design approved, spec under review

## Problem

A litho correlation edge joins a contact (a litho-unit boundary) on one
investigation to the matching contact on another. Today
`CorrelationEdgesOverlay` draws each edge as a point-to-point `<line>`
(emerald = approved, amber dashed = pending). The owner wants the
correlation to read as the geology it represents: a band straddling the
boundary, **split into the lithology colour above and the lithology colour
below**, with each side **fading from one investigation's colour to the
other's across the gap** when the lithology changes (a lens / facies
change). A contact bounds **exactly two** lithologies, so the split is
always two-way.

This is the lithology-coloured gradient ribbon — the substantive,
gradient-fill half of #131, distinct from the lens-aware opacity/dash
styling and the pinch-out taper described in the rest of the #131 entry.

## Scope

- **Frontend only.** No backend, no schema, no API change. The component
  already receives everything it needs:
  - `contacts` — the section's litho contacts (`correlateContacts`)
  - `formations` — each with `color` and `litho_main_soil_code`
  - `contactEdges` — the `LithoContactCorrelationEdge[]` (carries
    `contact_a_id`, `contact_b_id`, `user_approved`, `id`)
  - `buildBandMap` / `buildContactScreenMap` — already computed in the
    component (contact id → screen `{ x, topY }`).
- The ribbon **replaces** the current point-to-point edge `<line>`
  rendering (the block at roughly lines 870–933 of
  `CorrelationEdgesOverlay.tsx`). Body chips (`#N`), the gesture
  hit-rects, the success pulse, the context menu and the drag-retarget
  machinery are unchanged except where noted.
- **Out of scope (deferred):** the full inter-column fill ("paint the
  whole cross-section between boreholes") — that is the post-litho-model
  interfingering problem, parked by owner directive. Also out of scope:
  the lens_id-FK opacity/dash variant and the pinch-out terminus taper
  (the other two #131 slices).

## Decisions (from brainstorming)

1. **Geometry = seam ribbon.** A thin fixed-height band hugging the
   correlated boundary line, NOT a full inter-column fill.
2. **Both states are ribbons.** Pending edges render immediately as a
   faded ribbon; accepting them solidifies the same ribbon. No thin-line
   state remains.
3. **Omit the missing stripe.** When a correlated contact is the topmost
   on its investigation there is no lithology unit above it (only the
   ground surface) — the above stripe is simply not drawn. No fabricated
   colour.
4. **Always-on.** Ribbons render whenever `contactEdges` exist on the
   section, matching how the edge lines behaved.
5. **Fixed height ±12 px** around the seam line (≈24 px total), constant
   regardless of zoom.

## Data derivation — above/below colour per contact

A contact marks the **top** of its formation, so on a given investigation:

- **below colour** = the contact's own `formation.color` (always present).
- **above colour** = the `color` of the formation of the next-**shallower**
  contact on the same investigation; `null` when this contact is the
  topmost (→ above stripe omitted).

New pure helper (module-level, no logging, no state) in
`CorrelationEdgesOverlay.tsx`:

```ts
// contact id → { above: string | null; below: string }
function contactStripeColors(
  contacts: readonly FormationContactResponse[],
  formationById: ReadonlyMap<string, GeologicalFormationResponse>,
): Map<string, { above: string | null; below: string }>
```

Implementation: group `contacts` by investigation id (`cpt_id ?? borehole_id`),
sort each group ascending by `depth_top_m`, then for each contact set
`below = formationById.get(c.formation_id)!.color` and
`above = previous shallower contact's formation colour ?? null`. Pure and
unit-testable; mirrors the grouping already done in `buildBandMap`.

## Ribbon geometry (per edge)

For an edge A→B, read the two endpoints from the existing
`contactScreenMap`: `ptA = { x: xA, topY: yA }`, `ptB = { x: xB, topY: yB }`.
Skip the edge if either endpoint is absent (off-section) — current
behaviour.

Let `H = 12` (half-height). The seam line runs `(xA, yA) → (xB, yB)`.

- **Above stripe** (drawn only if BOTH ends have a non-null above colour):
  polygon `(xA, yA−H) (xB, yB−H) (xB, yB) (xA, yA)`, filled by a horizontal
  `linearGradient` (`gradientUnits="userSpaceOnUse"`, `x1=xA`, `x2=xB`)
  with stops `aboveA → aboveB`.
- **Below stripe** (always drawn): polygon
  `(xA, yA) (xB, yB) (xB, yB+H) (xA, yA+H)`, gradient stops
  `belowA → belowB`.

When both stops are equal (no lens) the gradient reads as a solid colour;
when they differ they blend through the middle — the requested fade.

Decision: if one end has an above colour and the other does not, omit the
above stripe entirely (treat as "no above" for the ribbon) — keeps the
two-ended gradient invariant simple and avoids a gradient that fades into
nothing.

## State styling

- **Approved** (`user_approved === true`): stripes at ~0.9 fill opacity +
  a near-black seam line (`#0f172a`, the #143 contact-line colour) drawn
  along `(xA,yA)→(xB,yB)`.
- **Pending** (`user_approved === false`): stripes at ~0.32 fill opacity +
  a dashed amber (`#f59e0b`, `4 4`) outline around the ribbon perimeter +
  the existing grab handles at both endpoints. The handles move off the
  old `<line>` onto the ribbon endpoint corners; `onUnapprovedDragStart`
  and the `unapprovedEdgeDrag` ghost are unchanged.

## Rendering approach

One `<linearGradient>` def per stripe per edge (≤2 per edge) inside the
overlay `<g>`, plus ≤2 `<polygon>`s. Gradient ids namespaced by edge id
(`ribbon-above-${edge.id}`, `ribbon-below-${edge.id}`).

Rejected alternative: slicing each stripe into many small solid-fill
sub-polygons to approximate the gradient — more DOM nodes for no benefit;
SVG gradients interpolate on the GPU. (This mirrors the per-segment vs
single-path choice already made for the #28 confidence fade, but here a
native gradient suffices because the blend is end-to-end linear, not
per-triangle.)

## Constants

```ts
const RIBBON_HALF_HEIGHT_PX = 12      // ±12 px around the seam line
const RIBBON_APPROVED_OPACITY = 0.9
const RIBBON_PENDING_OPACITY = 0.32
// reuse: LITHO seam line #0f172a (see #143), UNAPPROVED_EDGE_COLOR #f59e0b
```

## Interaction with existing overlay elements

- **Body chips** (`#N`): unchanged, still drawn after the ribbons so they
  paint on top.
- **Gesture hit-rects** (correlate mode): unchanged.
- **Success pulse**, **context menu**, **admixture editor**: unchanged.
- **Drag-to-retarget**: handles + ghost line unchanged in behaviour;
  handles are now positioned on the pending ribbon's endpoint corners.

## Testing

**Pure helper (`contactStripeColors`)**
- below = the contact's own formation colour.
- above = previous-shallower contact's formation colour.
- topmost contact → above is `null`.
- two investigations don't bleed into each other's ordering.

**Component (`CorrelationEdgesOverlay.test.tsx`)**
- Approved edge → two stripe polygons present, above-gradient stops =
  (aboveA, aboveB), below-gradient stops = (belowA, belowB), plus the
  near-black seam line.
- Pending edge → stripes at the faded opacity, dashed amber perimeter
  outline present, grab handles present.
- Topmost-contact edge → only the below stripe renders (no above stripe).
- Lens edge (below colour differs across ends) → below-gradient stop
  colours differ; no-lens edge → equal stops.
- Existing `contact-edge-${id}` line assertions are reworked to the new
  ribbon testids (`ribbon-${id}`, `ribbon-above-${id}`,
  `ribbon-below-${id}`, `ribbon-seam-${id}`).

**Verification gates:** filtered `tsc -p tsconfig.web.json` on the changed
renderer file; full `vitest run`; manual dogfeed in the section editor on
a real correlated section (approved + pending + a lens + a topmost
contact).

## Files touched

- `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
  — add `contactStripeColors` helper + ribbon render block; remove the
  edge-line block; move grab handles onto the ribbon.
- `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`
  — helper tests + reworked edge tests.
- `docs/debt.md` — mark #131-c shipped on completion.
