# Codex investigation — StrixGeo partition engine v2: five owner dogfeed defects on the flag-ON engine
# Branch `wip-v2-tiler-rewrite` @ `6429e0260` (or newer). DIAGNOSIS ONLY — do not write fixes.

The owner dogfed the REAL app running the flag-ON terminations-first engine (the
Settings-v2 wiring was fixed in `4302a265d` — app-v2 now wraps the compute in
`setTwoSidedTerminations(true)`; these findings are on the CORRECT engine, unlike the
prior round). His meta-question frames the whole investigation: **"Why are my simple
2/1/0 rules being broken?"** — per unit-side literal corr: 0 → lens always (reach
0.45 of the gap), 1 → onlap riding the actual tie (same matched litho → no flank),
2 → band bounded by the tie line art; the fill is the face-fill of the line art
("stay inside the lines"); a region's litho never crosses its own boundary line.
Full rule stack: `docs/design/partition-engine-v2.md` §8 (rulings 8a-8n(b)),
condensed in `AUDIT_PROMPT.md`. Campaign history: `REWRITE_STATE.md` §38-§43.

## The five findings (owner-observed in the app; locate by investigation NAME in the
## real input `scripts/diag_allsections_input.json` — columns carry names)

**F1 — Band quad geometry wrong between GEO-10/171-B6 and 1411-GEO-23/126-B4.**
The SILT tops are tied left↔right, and the CLAY-below tops are tied left↔right
(i.e. the silt's base surface carries a tie). Owner: the silt quad's TOP runs
silt-top-left → silt-top-right (correct), but its BOTTOM edge starts at the silt's
TOP contact on the left and runs down to the BOTTOM of the clay-below on the right —
a diagonal spanning two units — and the bottom clay then fills the mis-shaped
remainder "originating next to the silt litho". Expected: the silt quad's base rides
the clay-top tie (its own base surface). Find which construction produces the
diagonal (bracket pairing in the enclosing flood? face slicing? label spans?) —
file:line + the actual quad coordinates.

**F2 — Lens FILL stops short of its own flank lines (reach).**
The drawn lens constructor lines (the flank line art) reach ~0.45 of the gap, but
the filled lens wedge is visibly shorter — the fill does not reach the apex its own
line art defines. That is a direct 8n violation (fill not following the lines)
REGARDLESS of the reach rule. Separately, enumerate every code path that computes a
lens reach below 0.45×gap (`lensReach.ts` base fraction, the ~2×unit-thickness cap,
`fitLensReach` tie-conflict halving, any boundary variant) AND every place the flank
LINE reach and the fill WEDGE reach are computed independently (the mismatch root).
Owner's stated rule expectation to test against: "lenses fill to 0.45 like the
constructor lines indicate; we only need to shorten lenses that collide with a
sloping correlation."

**F3 — A SILT lens transitions into a CLAY lens.** Right of 1411-GEO-23/126-B3,
second SILT unit from the top: the lens shape east of the column reads silt near
the column but its outer portion is a CLAY wedge nested in/continuing the same lens
form. One lens, two lithos. Trace the faces + labels there (which curve bounds the
litho change mid-lens; is it a mislabelled face, a second overlapping construction,
or an enclosed-lens interaction).

**F4 — CLAY above a sand-top↔clay-bottom correlation band at 1411-GEO-23/126-B2.**
Below the big SAND, a band runs on a sand-top/clay-bottom tie pair; CLAY fill
appears ABOVE that band's top line where sand should be. A band litho crossing its
own boundary line (8n rule violation). Identify the face + its label source.

**F5 — Bottom SILT at GEO-10/170-S11 does not onlap to the RIGHT.** The thin silt
near the column base onlaps left but emits/fills nothing right. Compute its literal
corr on the right side (TieRef provenance — `effectiveCorr.ts`), check 8m
(follow-the-tie litho compare) and the sweep dispatch (`emitTerminationSweep.ts`),
and find where the right-side termination is lost (not emitted? emitted but
absorbed by a face? suppressed by a surviving check?).

## Method (measure, don't read)

`scripts/diag_allsections_input.json` was FRESHLY re-extracted from the owner's
latest saved model (2026-07-19, after his dogfeed correlation edits — CS1 111 edges,
CS2 172) — use it as-is; do not regenerate.

Scratch vitest from `desktop/` (Node 22): load `scripts/diag_allsections_input.json`,
find the section containing the named investigations, run
`computeSectionFillV2(columns, edges, undefined, alongM)` inside
`setTwoSidedTerminations(true)` try/finally (`./partitionFillV2/tileFlags`), and dump
regions + curves for the named gaps (fractions ↔ alongM via the gap's column x's).
Cross-check region shapes against what the owner describes before rooting the cause.
Env-gated gates for regression context: `SHAPE_AUDIT=1` / `HOLES_DIAG=1` /
`CS1_GATE=1`; full suite baseline = 1 failed (`convergingStack (a)`) / 799 passed.
Engine files: `emitTerminationSweep.ts`, `drawTermination.ts`, `emitCorr0Termination`
(in the sweep), `emitFloodWedge.ts`, `emitEnclosingFlood.ts`, `emitBoundaryLens.ts`,
`lensReach.ts`, `lensEnclosure.ts`, `effectiveCorr.ts`, `labelFaces.ts`, `slice.ts`,
`intersect.ts`, `mergeTouchingBodies.ts`, `sectionGeom.ts`, `tieContacts.ts`.

## Deliverable

Per finding: reproduced? (region/curve evidence at the named location) → root cause
chain with file:line → classification (emission / face topology / labelling / fill
geometry / render) → minimal fix DIRECTION (no code). Then the synthesis the owner
actually wants: across the five, what is the STRUCTURAL reason the literal 2/1/0
contract still leaks — which single subsystem (or seam between subsystems) do the
roots share, and what one structural change would close the class rather than the
instances. Known accepted walls (do not report): CS2-g17 20 holes, `literalCorr`
(c)/(d), `convergingStack (a)`, the 8-of-436 mixed-enclosure fallback. Design
disagreements with the §8 rulings: separate marked section, no severity.
