# Free-draw edit model — onlap vs lens (LOCKED spec, owner 2026-07-23)

## ANY BOUNDARY BENDS TO THE CURSOR (owner-decided 2026-07-24 — the reshape capability)

A drag on ANY two-band litho boundary moves the grabbed node to the CURSOR
position and bends the boundary through it — ONE clean bend, gap-free —
**whether or not the boundary is correlated.** Un-correlated boundaries are
NO LONGER read-only. This is the owner's core model ("i just want the boundary
i click to reshape to where i move my cursor") and it supersedes the v2
engine's tie-only reshape: today `contactOverride.collectContactBends` bends
ONLY a contact carrying an active correlation TIE, an `isApexShapeable` region
is hijacked to the LENS path whose mousemove clamps the node to the tip span
(`PartitionFillOverlay.tsx:507` → el snaps to the pinch span, not the cursor),
and an un-tied two-band base (e.g. CS1 clay `934a78` gap-5 base el 6.44) has no
bend mechanism at all (S100 diagnosis). The capability to build: a boundary
drag stores the RAW cursor `(along, elevation)` (gap-free-clamped only — cannot
cross the neighbour above/below), and the engine bends ANY two-band boundary
through it, no tie required, no lens clamp, one region set (no fragmentation).
Correlation ties still drive the AUTO fill; MANUAL reshape is unrestricted.
Edge cases handled/asked-not-invented: a true pinch tip (band → zero, no other
band) and a surface-bounded boundary (nothing above) have no two-band contact
to bend — resolve per case, do not guess.

## UNIFIED LITHO-EDGE HANDLE (owner-decided 2026-07-23 — the interaction surface)

There is exactly ONE grabbable thing: **a line between two litho fills.** Every
fill-to-fill boundary — a shared contact between two bodies OR the edge of a
lens/pinch-out — is the SAME grabbable litho-transition line, with the SAME
single handle (one colour), the SAME gesture: **left-press-drag to reshape**
(press-to-grab; stays gap-free), **right-click to remove.** A lens edge is NOT
special — the fills are built FROM the lines we drew, so a lens's sloping edge
is a litho-transition exactly like any contact, and keeps its handle.

This RETIRES the historical dual-handle system (born 2026-06-05: teal
`BOUNDARY_COLOR` contact handle `b73d44621` + orange `LENS_COLOR` lens-apex
handle `3d55885e3`, then buried under S67–S97 reworks). The two colours, the
`sharedBoundariesForRender` referee layer (which existed only to stop both
systems drawing "three dots"), the right-click-spawns-a-marker bug (mousedown
not gated to the left button), and the marker-doesn't-follow-snapback desync
all GO. Under the hood the correct override path still routes per edge (a
contact → contact-override, a lens edge → lens/apex-override), but the USER
sees one uniform handle. The per-kind CONSTRAINTS below (onlap apex pinned to
band, lens free apex) are a later refinement on top of this one surface — the
surface is unified first.

## Per-kind model (the constrained-handle refinement, on top of the unified surface)

Direct-manipulation handles over the existing 2/1/0 partition primitives
(`section-fill.md`: 2 correlations → BAND, 1 → ONLAP, 0 → LENS). Free-draw is
NOT one free-dragging dot — it is a small set of constrained handles whose
behaviour depends on whether the feature is tied to a correlation band.

This is the target model. The current engine mis-treats a correlation-band
pull as a free lens-tip reshape and shatters a full-width band (e.g. CS1
`019ea170-…-934a78` gap 5 fragmenting into 4–5 regions / a tall pinch). That
is the bug this spec replaces.

## Creating the feature — pull a correlation band

A correlation band renders as a straight line between its two tie points.
Grab it mid-span and pull → the LINE ITSELF BENDS into `tie → apex → next tie`
(two straight segments, no separate base edge). That bend IS an onlap.

```
before:   tie●━━━━━━━━━━━━━━━●tie          straight correlation band
pulled:   tie●━━━━━●━━━━━━━━━●tie          tie → apex → next tie (the line bends)
                  apex
```

A pull creates an ONLAP by default (apex pinned to the band). A lens is only
ever reached via right-click **Decouple** (below).

## ONLAP — tied (1 correlation)

- **Apex handle** — CONSTRAINED TO THE BAND. Dragging slides it ALONG the band
  only (1-D); it can never leave the band. Moving it changes WHERE along the
  band the wedge pinches out.
  - **Endpoint behaviour (owner-decided 2026-07-23, "for now"): CLAMP JUST
    SHORT.** The apex stops a hair before either tie (the engine's existing
    `clampApex` [0.02, 0.98] margin); the onlap never fully degenerates to
    zero width, and reaching a tie is a clamp — NOT a reject, NOT a vanish.
    Revisit only if dogfeed wants a true pinch-to-tie.
- **Diagonal handle** — grab the sloping segment to re-angle the wedge slope,
  independently of the apex. **DEFERRED past Stage 1** — Stage 1 ships the
  apex handle only; the wedge slope is whatever the default flood produces
  until the diagonal handle lands as a Stage-1 suffix.
- Overlap / collision with a neighbour → **invalid placement**, rejected
  (the existing red-handle + snapback). This REPLACES the engine's old
  "override opens a defect → flood to band → suppress handle" escape hatch.

## Right-click → "Decouple onlap" → LENS

Drops the correlation tie (onlap 1-tie → lens 0-tie). On decouple, the lens
detaches from the band and floats. To keep the partition GAP-FREE, the space
**beneath the now-free lens** is FLOODED by the **dominant lithology of the
band it had onlapped onto**:

- **Downward onlap** → dominant lithology **ABOVE** that band floods beneath
  the lens.
- **Upward onlap** → dominant lithology **BELOW** that band floods beneath the
  lens.

The lens then sits floating inside that flooded matrix — no gap where it used
to tie.

## LENS — untied (0 correlations)

- **Apex handle** — draggable in 2-D (off the band, anywhere).
- **Two side handles** — both diagonals independently draggable.
- Overlap / collision → **invalid placement**, rejected.

## Invariants (both feature kinds)

- The fill stays a true partition — no gaps, no overlaps — at every drag frame
  and on release (the v2 engine's HOLES_DIAG 0/0/0 gate).
- An invalid placement is never persisted: red handle + snapback.
- **Collapse → invalid (owner-approved 2026-07-23, the general rule).** A
  tip edit — ONLAP or LENS alike — that collapses its tip into a full-width
  band (destroying its own grab handle) is INVALID, even though a full band
  is a hole-free/overlap-free partition. Root cause of the recurring "it
  stopped working": flood-to-band passes the defect check (0 holes) →
  `classifyOverrideOutcome` returned `applied` → the flooded band persisted →
  the region went non-shapeable → the handle was suppressed.
  - **The discriminator (owner-decided 2026-07-23, "only over-reach snaps
    back"):** two ways a tip edit can erase the edited tip, and they are NOT
    the same. (①) **Tip vanishes WITHIN the gap** — dragged back so the tip's
    own litho dissolves and a neighbour fills its place, apex fraction still
    inside [0,1]. This is a VALID, intentional reshape → it APPLIES (the CS1
    `029c52@4/@5` cases; keeps `reshapeMap` UNMOVED). (②) **Over-reach past
    the far column** — apex dragged beyond a column edge (fraction outside
    [0,1]) AND the edited tip floods to a full-width band. This is INVALID →
    `rejected-collapse` → snap back to the last good shape, handle ALIVE (the
    CS1 `6bb744` gap-7 case). So the collapse rule = **over-reach past a
    column AND full-width flood**, NOT merely "tip vanished" — a pure geometry
    test (`!isApexShapeable`) alone over-rejects ① and is wrong.
  This is engine-agnostic — no onlap-vs-lens adjudication needed — and
  REPLACES the flood-to-band + handle-suppression escape hatch for the edited
  tip.
  - **SHIPPED S97 (worktree).** The over-reach signal is carried additively on
    the override as `LensApexOverride.rawApexFraction` (the RAW pre-clamp cursor
    reach, built in `apexOverrideWiring.setShape` only when THIS body is the live
    drag target; absent on the non-drag/persisted-render path). The classifier
    `classifyOverrideOutcome` (`computeSectionFillV2.ts`) returns a new
    `rejected-collapse` status when `isCollapseOverReach` finds an override whose
    `rawApexFraction` is outside [0,1] AND whose own body flooded to a full-width
    band in the candidate; it returns the BASE (last-safe) regions so the region
    OUTPUT that `reshapeMap`/`allSectionsReshape`/seed/holes read stays
    byte-identical (those gates call `computeSectionFillV2` directly, not the
    classifier — only the STATUS changed). The overlay treats `rejected-collapse`
    identically to `rejected-unsafe` (`unsafeDragUX.isDragRejected`/
    `shouldPersistDrag`) → red handle + snapback, handle ALIVE. Gate:
    `collapseSnapback.rules.test.ts` (CS1_GATE, un-skipped).
- Persist routes the node by KIND (onlap → contact/tied path; lens → lens
  path) — see §85 `detectPersistedLensBodies`; a persisted node must rebuild
  through the SAME routable mechanism the live drag used (no snapback).

## Build order (after the S86 press-to-grab gesture lands + is dogfed)

1. Onlap: apex-constrained-to-band + diagonal handle; band-pull creates onlap;
   fix the `934a78` shatter (single bent contact, not fragmented).
2. Right-click Decouple → lens, with the dominant-lithology flood-beneath rule.
3. Lens: free 2-D apex + two side handles.
