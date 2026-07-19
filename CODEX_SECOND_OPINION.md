# Codex audit — the LINE-DRAWING STAGE of partition-engine-v2 (flag-ON termination emission)
# Branch `wip-v2-tiler-rewrite`. ANALYSIS + FULL INVENTORY — no fixes.

## Context
The owner's doctrine (design §8, rulings 8a-8r — read 8q/8r/8p first): the engine draws the
literal termination linework (lens lines both sides, onlap lines both sides, per the 2/1/0 rule
on the RAW picked units — ruling 8r: lines BEFORE any merge), alongside the picked columns and
approved ties; the connected line network then closes every region and a seeded paint bucket
fills. The seed/paint layer is being landed separately (SEED_FILL_MANDATE.md, Steps 2-3 done);
**the owner's hand-painting dogfeed just showed the LINE STAGE itself is defective.** He asks:
is the line network complete and literal? Your job: the definitive line-stage conformance
inventory.

## Verified owner findings so far (CS1, from `scripts/diag_cs1_flip_walkthrough.json` curves)
- **Phantom curves**: col3 (1411-GEO-23/126-B4) `lens6-9` at el [4.70..4.06] — NO picked contact
  exists there (the raw sand spans 0.665..7.13 unbroken). Fabricated geometry.
- **Misrooted flanks**: col3 `term3/4` roots at 0.61/0.23 vs the real contacts 0.665/0.232.
- **Dangling apex**: col23 (GEO-10/170-S11) `oflanksubtdo3` ends at el −7.12 in free space —
  not landing on the tie/band line art it must ride (owner: "it isn't touching the band below").
- **Per-side missing**: col20 (GEO-23/125-S5A) top clay onlaps RIGHT only (left missing); its
  second sand + col19 (23/125-S6) second clay + col6 (GEO-10/170-S7) top sand + a 10/170-S6 top
  sand: no termination curves at all on the named sides.
- **Half-lens**: col8 (GEO-10/170-S8) silt emits ONE flank (`term11`) — the old boundary-lens
  construction whose second leg rode a synthetic floor scaffold.
- **Duplicates**: col18 `term25-28`(R) AND `subtdlens2-5`(L) — verify whether the L/R pairs are
  legitimate per-side emissions or double-emission of one side.
- **Suppressed by pre-merge (ruling 8r violation)**: col18 middle clay [6.03..6.65] has no lines
  because `extractEnclosedLenses` merges it away BEFORE emission.

## THE TASK — the full line-stage conformance inventory (all 14 sections)

**Ground truth**: `scripts/diag_allsections_input.json` (RAW picked columns + approved edges).
For every (gap, side, unit) of the RAW units compute the literal corr per the rulings: a
contact is tied iff a real approved tie sits ON that physical shared surface (8a), including
resolved jump bridges; corr = count of the unit's own tied contacts on that side (8l); 0 → a
lens line pair (both flanks rooted EXACTLY at the unit's two contacts, apex at 0.45 of the gap
per 8b-rev unless tie-collision shortening); 1 → ONE onlap line riding the actual tie to the
0.5 apex ON the tie (8i(d)), suppressed only when the matched facing litho is identical (8m);
2 → no termination (the ties/band lines are the art).

**Engine output**: run the flag-ON emission (`setTwoSidedTerminations(true)` try/finally around
`emitCurves`/`computeSectionFillV2` — see `partitionFillV2.cs1flip_walkthrough.diag.test.ts`
for the capture recipe) and DIFF against the ground truth. Classify every discrepancy by
identity (section/column-name/unit/side/elevations/curve ids):
1. **MISSING** — a required lens/onlap line not emitted (state the corr and why required);
2. **PHANTOM** — an emitted termination at elevations matching no raw contact;
3. **MISROOTED** — a flank whose root deviates from its contact beyond the 1mm snap;
4. **DANGLING** — an onlap apex not ON its tie line / a flank endpoint not on line art;
5. **DUPLICATE** — the same termination emitted twice;
6. **MERGED-AWAY** — required lines absent because the unit was pre-merged (8r violations);
7. **WRONG-SIDE** — emitted on one side where both sides require it;
8. **COLLAPSED** — a lens whose reach collapsed to (near) the 1mm snap floor so the flank sits
   ON the column with no lateral extent (owner: "drawn on the column, not extending into the
   void" — e.g. col3's term3/4). Identify what collision the 8b-rev shortener
   (`lensReach.ts` `interiorLensReachToTies` / `fitLensReach` halving-to-floor) claims at each
   collapsed instance — the prime suspect is the unit's OWN contact ties / root line art being
   mis-detected as a collision, which would make the shortener self-defeating. For every
   collapsed lens: the claimed colliding curve id, its geometry, and whether a 0.45 (or
   legitimately shortened) reach would actually cross anything.
Also verify each of the owner findings above and extend the list model-wide.

**Root causes**: for each class, name the emission path responsible (file:line) —
`emitTerminationSweep`/`drawTermination`/`emitCorr0Termination`, `emitSubTdLenses`,
`emitBoundaryLens`, `emitLenses`/`emitEnclosedLensCurves`, `sectionGeom.extractEnclosedLenses`
(the 8r pre-merge), `terminationPlan` (is the PLAN wrong or is the EXECUTION wrong? — separate
these: plan-vs-ground-truth diff first, then emission-vs-plan).

**Caveat to respect**: some "missing" sides may be corr-2 via 8a-derived shared-contact or
bridge ties the owner did draw — for each such case show the tie that classifies it (the owner
rules whether the derivation over-reaches); do not mark those MISSING.

## Recipes
From `desktop/` (Node 22): `cd .../desktop && npx vitest run <one file> --disableConsoleIntercept`;
env prefixes SHAPE_AUDIT=1 / HOLES_DIAG=1 / CS1_GATE=1 only; `npx tsc --noEmit -p
tsconfig.web.json`. Baseline: full utils 1 failed (`convergingStack (a)`) / ~815 passed.
Known walls (context, not findings): CS1-g3/CS2-g17 holes, the seed-gate defect ratchet
(151 zero-seed / 9 multi-seed), `literalCorr` (c)/(d).

## Deliverable
The complete per-identity discrepancy inventory (the 7 classes) with per-section counts; the
plan-vs-truth and emission-vs-plan split; root causes by file:line; the owner-finding
verifications; the corr-2-derived "not actually missing" list with each classifying tie.
Measured evidence only. This inventory becomes the Step-4 repair queue — completeness beats
speed.
