# Codex second opinion — the SEEDED PAINT-BUCKET fill (ruling 8q) vs label rules
# Branch `wip-v2-tiler-rewrite` @ S41.c `6e95a8705` (+ docs merge). ANALYSIS + MEASUREMENT — no fixes.

## Context
The Strix partition-engine-v2 rebuild is mid-way through its capstone (the termination-plan
architecture; stage records `REWRITE_STATE.md` §46; ruling stack `docs/design/partition-engine-v2.md`
§8, rulings 8a-8q — read 8q, 8p, 8o, 8n first, they are the owner's fill doctrine, newest at top).
Stages landed: S41.a plan layer (`terminationPlan.ts`), S41.b plan-driven emission + sub-TD corr-1
dispatch, S41.c `emitRuledBands` deleted. NEXT was the label layer, and two competing readings emerged:

1. **The orchestrator's interim (a)/(b) continuation rule** (never built): a hole fills with the
   litho that "continues across it" — (a) own-column enclosure whose faces extend past the wedge
   (8g detour) with priority over (b) the facing unit still flowing at that elevation.
2. **The owner's ruling 8q** (final, verbatim): "lens lines first left and right, onlap lines second
   left and right, then you have a connected set of lines and you don't have any gaps, you just need
   to fill like the fill tool in paint." I.e. **NO label rule exists**: after the termination sweep
   the line art closes every region, and each face is painted by the flood from the PICKED-UNIT
   COLUMN SEGMENT(S) on its own boundary — litho comes from the seed. A face with zero unit-column
   segments, or with segments of two different lithologies, is a LINE-ART DEFECT (missing/unclosed
   line), not a labelling question.

## Your job (measure on the real data, then judge)

**Q1 — Validate the seeded-flood model against the current arrangement.** The v2 engine builds a
planar arrangement (`snap.ts` 1mm grid → `intersect.ts` incl. near-T splitting → DCEL → `faces.ts`
walkLoops → `labelFaces.ts` → `slice.ts`). Column verticals are emitted per unit face (surface→TD),
so every arrangement face's boundary either does or does not carry unit-column segments. Write a
scratch vitest (from `desktop/`, Node 22: `cd .../desktop && npx vitest run <file>
--disableConsoleIntercept`; force flag-ON via `setTwoSidedTerminations(true)` from
`./partitionFillV2/tileFlags`, try/finally; real input `scripts/diag_allsections_input.json`, all 14
sections) that, per traced face BEFORE slicing: collects the distinct picked-unit lithologies of the
column segments on its boundary. Report per section: faces with exactly ONE seed litho (the paint
bucket works), ZERO seeds (unreachable face — per 8q a line-art defect; list identity:
section/gap/elevation-range/bounding curve ids), MULTIPLE distinct seed lithos (unclosed line
between two units — list identity). Compare the one-seed faces' seed litho against the CURRENTLY
painted litho (the S30/S31 label lookups) — every disagreement listed (these are the label bugs 8q
fixes for free).

**Q2 — The zero/multi lists vs the known walls.** The engine has 64 pinned flag-ON holes (CS1-g3 22
+ CS2-g17 42 — missing face AREA) and one pre-existing red (`convergingStack (a)`). Do the
zero-seed/multi-seed faces coincide with these walls (i.e. does 8q's defect-list REDISCOVER the
walls as line-art defects, unifying "hole" and "mislabel" into one diagnostic)? Say precisely which
line is missing/unclosed at each wall per the 8q reading (e.g. CS2-g17: the sloping enclosure's
band base line vs the straight bracket carrier; CS1-g3: the thin interbed's flank vs the fragmented
flood).

**Q3 — Judge the two models.** Is the (a)/(b) continuation rule ever DIFFERENT from seeded flood on
faces with exactly one seed? (Hypothesis: (a)/(b) was an approximation of seed connectivity through
the corr tables; where they disagree, seeded flood is the doctrine.) Name any face where seeded
flood gives an answer the owner's pinned expectations contradict (`faceLabel8n`: gap18 KLEI wrap,
gap1 SILT past-apex; the B3 one-silt-body and B2 one-sand-body pictures in REWRITE_STATE §46/§44).
If none — the label layer implementation is: face litho = its single seed, done.

**Q4 — Implementation path.** Given `labelFaces.ts` (currently: `resolveLabel` length-weighted vote
+ `lensLabels` stamps, runs BOTH flags — flag-OFF must stay byte-identical) and the existing
`col<ci>:u<ui>` curve id vocabulary: outline the minimal flag-ON implementation of seed-labelling
(and the counted defect-list for zero/multi faces), what dies (`lensEnclosure.ts`, the
`emitFloodWedge` label params, the vote on the flag-ON path), and any traps (faces below a TD have
no column verticals BY DESIGN — the sub-TD sand under B2 must reach the neighbours' sand segments;
verify it does in the arrangement, or say what blocks it).

## Ground rules
The §8 rulings are law; do not re-litigate. Known walls (don't rediscover as findings — Q2 ASKS
about them explicitly): CS1-g3/CS2-g17 holes, `convergingStack (a)`, `literalCorr` (c)/(d) skips.
Flag-OFF must remain byte-identical in any proposal. Verification recipes: env prefixes
HOLES_DIAG=1 / CS1_GATE=1 / SHAPE_AUDIT=1 (only these three); full utils baseline 1 failed / 813
passed / 25 skipped at `6e95a8705`; bare `npx tsc --noEmit -p tsconfig.web.json`.

## Deliverable
Per-section seed statistics (one/zero/multi) + the zero/multi identity lists + the
disagreement-with-current-paint list; the wall coincidence analysis (Q2); the model judgment (Q3)
with any counterexample face; the implementation sketch + traps (Q4). Measured evidence over
reading. Design disagreements with the rulings: separate marked section.
