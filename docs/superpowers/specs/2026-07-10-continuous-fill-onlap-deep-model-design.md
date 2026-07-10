# Continuous-fill deep model — onlap/pinch/bridge, no interpolation

**Date:** 2026-07-10
**Component:** `desktop/src/renderer/src/utils/partitionFill.ts` (`computeSectionFill`)
**Status:** approved (owner brainstorm, real CS1 S11·S8·S10 walkthrough)

## Problem

Below a shallow test's TD the 2D section partition is not continuously filled. Two
symptoms on the real `test.strix` Cross-section 1:

1. **Voids** — the deep space below a shallow column (e.g. under S8) has holes,
   because a correlated band that *should* continue across the shallow column stops
   short. The clearest case: the deep SILT correlates S10↔S11 (top-tie @6.48/5.96),
   so it should be **one continuous body under S8**, but the engine draws it only on
   the S10 side (gap 8) and drops it on the S11 side (gap 7) → a void.

2. **Wrong lithology ("clay spilling over the correlation band")** — a previous
   attempt filled the deep voids with a **tie-blind deep-to-deep substrate** (geometric
   interpolation). That floods clay into space where the geology says a unit pinches
   out and the sand matrix onlaps. This was reverted; interpolation is the wrong
   mechanism.

## The model (owner rule, confirmed)

**The 2/1/0 correlation count decides every unit's fate — everywhere, including below
shallow TDs — and continuous fill comes ONLY from real correlations, never from
interpolation.**

For a unit, per facing side:

- **2 correlated contacts (or a bridging non-adjacent edge) → BAND.** The unit is one
  continuous body that spans across every intervening shallow column. Its tied contacts
  interpolate **smoothly by along-distance** from the deep column on one side to the deep
  column on the other, so the band passes *under* the shallow column with **no kink or
  shift at the shallow column** (the S8 continuity requirement).
- **1 correlated contact → ONLAP.** The unit's tied contact follows the correlation to
  the reaching column; its untied contact tapers, so the unit thins/thickens to meet the
  tie. (Example: below the deep silt, the S11 clay is tied only at its top → it pinches
  and the sand below onlaps *up* to meet the silt base.)
- **0 correlated contacts → PINCH OUT.** The unit tapers to a point toward the
  uncorrelated side. The **matrix** — the bridging band above/below it — closes over the
  vacated space. Nothing is invented; the neighbouring correlated bands simply meet.

There is **no substrate / no interpolation**. Every filled point is a real observed
lithology placed where a real correlation (or its onlap taper) puts it. Where no
correlation reaches, a unit pinches and the correlated matrix connects.

### Worked example — CS1 S11 · S8 · S10 (gaps 7 & 8)

Below S8's TD (9.29 m), from real edges:

- **deep SILT** bands S10↔S11 (top-tie @6.48/5.96, base = the S10.ZAND-top ↔ S11.KLEI-top
  line @2.51/5.01) → one continuous silt body under S8.
- the **S11 upper-middle KLEI** (5.01→1.25) has only its top cross-tied (to the sand top)
  → it **pinches out** toward S10.
- the **ZAND (sand)** bands S10↔S11 (top-tie @2.51/1.25) and **onlaps up** (its top rises
  1.25→2.51) to fill the wedge the pinching clay left.
- the **deep KLEI** bands S10↔S11 (top-tie + base-tie) → continuous.

Result: continuous fill under S8, all real lithologies, no voids, no clay spilling.

## Scope

**In scope**
- Make every correlated band bridge **continuously** across intervening shallow columns
  (fixes the deep-silt void). The bridge interpolates the tied contacts by along-distance
  → geometrically continuous, no shift at the shallow column.
- Apply onlap (1-tie) and pinch (0-tie) below shallow TDs so the matrix connects and the
  section fills with no voids.
- Keep the cross-litho **tie-line clip** already shipped (the mid-clay fix): real data is
  kept above a sloping cross-litho tie; nothing crosses a correlation surface.

**Out of scope / removed**
- The deep-to-deep **substrate** (`computeBracketSubstrate`) as a fill source under
  rewriteB — reverted; it is interpolation and must not return.
- Any invented lithology to plug a void. A residual void means a missing correlation, not
  a fill bug — surface it, don't interpolate over it.

## Invariants (validated by the real-CS1 gates)

- **`cs1void` = 0** interior voids (continuous fill).
- **`cs1frozen` = 0** overlaps; **`cs1tiecross`** clean (no region crosses a cross-litho
  tie — no clay spilling).
- **Lithology correctness**: below a shallow TD the fill is the lithology a real
  correlation places there (the deep neighbour's banded lithology), never an interpolated
  guess.
- **Band continuity**: a bridging band's contacts are continuous (no kink) across the
  intervening shallow column.

## Open implementation questions (for the plan)

- The current `computeSpanningBands` already emits non-adjacent bridging bands but
  under-covers (drops the deep silt on one side). Determine whether to complete it or
  fold bridging into the per-gap emit path so bands and their onlap tapers are produced
  in one place.
- How onlap tapers compose when several 0/1-tie units stack between two bridging bands
  (cascade order), so the matrix connects without overlap.

## Validation

Real CS1 gates (`REWRITE_B=1 CS1_GATE=1` / `CS1_TIECROSS=1`) must all pass, AND the owner
dogfeeds the live render — the render is the final arbiter (the gates are necessary, not
sufficient). Specifically confirm on the app: the deep silt is one continuous band under
S8, no clay below the correlation lines, no voids on zoom.
