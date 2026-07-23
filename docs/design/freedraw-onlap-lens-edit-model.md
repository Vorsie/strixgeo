# Free-draw edit model — onlap vs lens (LOCKED spec, owner 2026-07-23)

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
- **Diagonal handle** — grab the sloping segment to re-angle the wedge slope,
  independently of the apex.
- Overlap / collision with a neighbour → **invalid placement**, rejected
  (the existing red-handle + snapback).

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
- An invalid (overlapping) placement is never persisted: red handle + snapback.
- Persist routes the node by KIND (onlap → contact/tied path; lens → lens
  path) — see §85 `detectPersistedLensBodies`; a persisted node must rebuild
  through the SAME routable mechanism the live drag used (no snapback).

## Build order (after the S86 press-to-grab gesture lands + is dogfed)

1. Onlap: apex-constrained-to-band + diagonal handle; band-pull creates onlap;
   fix the `934a78` shatter (single bent contact, not fragmented).
2. Right-click Decouple → lens, with the dominant-lithology flood-beneath rule.
3. Lens: free 2-D apex + two side handles.
