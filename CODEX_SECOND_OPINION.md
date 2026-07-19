# Second opinion — StrixGeo partition engine v2: app integration + owner dogfeed findings
# Branch `wip-v2-tiler-rewrite` @ `4302a265d`

Context: an external audit's 10-item simplification was just executed (sessions 33-38,
`REWRITE_STATE.md` §38-§43; ground rules in `AUDIT_PROMPT.md` — read both first). The
owner then dogfed the ACTUAL APP for the first time and immediately hit a class of bug
the entire test battery missed: **the app's "Partition engine v2" Settings toggle
selected the v2 engine but never set the internal sweep flag** (`partitionFillV2/
tileFlags.ts` `TWO_SIDED_TERMINATIONS`, default false, previously set only by tests) —
so the app rendered the flag-OFF seam engine while every gate and render validated the
flag-ON terminations-first engine. Fixed in `4302a265d` (`partitionEngineSelect.ts`
wraps the v2 calls in `setTwoSidedTerminations(true)` try/finally). Your job: second
opinion on this integration seam and on the owner's four dogfeed findings.

## 1. Audit the app→engine integration end-to-end (the bug class that just bit)

Trace EVERY production render path to the engine call it actually executes, in both
toggle states:
- the 2D section overlay (`PartitionFillOverlay` + whatever memoizes the fill),
- the 3D voxel build request (`buildVoxelRequest.ts`),
- the fence builder (`buildProjectFence.ts`),
- any other renderer code importing `computeSectionFill`, `computeSectionFillV2`, or
  `computeSectionFillActive*`.
Find: (a) any path that reaches `computeSectionFillV2` WITHOUT going through the fixed
selector (it would still run the seam engine); (b) any path still calling v1's
`computeSectionFill` directly where the selector was intended; (c) memoization that
caches regions across a toggle flip without invalidating (the selector has a
`useSyncExternalStore` hook — check every consumer includes the flag in its deps);
(d) concurrency/reentrancy holes in the try/finally flag wrap (the compute is
synchronous — verify nothing async happens inside it, including in the conflicts
variant).
Also judge: is the two-flag design (engine-select localStorage flag + internal sweep
flag) still warranted, or should the sweep flag now be flipped default-ON inside v2
(with the flag-OFF seam engine reachable only by the frozen gates)? Recommend the
cleanest cutover-consistent shape.

## 2. Re-derive the owner's four dogfeed findings on the CORRECT (flag-ON) engine

The owner observed these on the WRONG engine (pre-fix app), so each must be
re-derived against the flag-ON output before it counts as a bug. Real input:
`scripts/diag_allsections_input.json` (14 sections). Force flag-ON in a scratch
vitest: `import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'`,
set-true/try/finally around `computeSectionFillV2(columns, edges, undefined, alongM)`.
For each finding, report: reproduces on flag-ON? if yes — file:line root cause; if
no — what the flag-OFF seam engine did to produce the owner's observation.
- (a) **Lens reach**: lenses render visibly shorter than 0.45×gap. Enumerate EVERY
  code path that yields a lens apex below 0.45 (see `lensReach.ts`: the base
  fraction, the ~2×unit-thickness cap, `fitLensReach` tie-conflict halving;
  `drawTermination`/`emitCorr0Termination` call sites; any boundary-lens variant).
  The owner's stated expectation: "lenses at 0.45 — only shorter if there is a
  collision with a tie". Table the shortening conditions with file:line so he can
  rule on the thickness cap with facts.
- (b) **GEO-10/170-S7**: the top KLEI quad on its LEFT gap runs full-width to S12 —
  owner expects a lens like any other. Identify the unit, its literal corr on that
  side, and which face/label produces the full-width run.
- (c) **GEO-10/170-S8**: the top SILT does not lens to the LEFT; and a ZAND lens to
  the left visually continues INTO a SILT lens (two different-litho lens shapes
  reading as one connected form). Corr + emission trace for both units.
- (d) **23/126-B3**: adjacent same-litho SILT regions do not merge into one body.
  Check against the NEW exact-geometry merge (`mergeTouchingBodies.ts`, session 37)
  — do the silt regions genuinely share a boundary point/segment or column-edge
  interval? If they touch and don't merge, that's a regression in the exact
  predicate; if they don't touch, say what separates them.

## 3. Ground rules (do not re-litigate; deviations from these are findings)

The owner's rule stack is design §8 in `docs/design/partition-engine-v2.md` (rulings
8a-8n(b)), summarised as audit criteria in `AUDIT_PROMPT.md`. Core: per unit-side
literal corr — 0 → lens ALWAYS, 1 → follow the actual tie (TieRef), same matched
litho → no flank / different → one flank, 2 → no termination; the fill is the
face-fill of the line art ("stay inside the lines"); bodies = exact-touch
same-litho components ("there can't be holes by design"). Known accepted walls (do
not report): CS2-g17 20 holes, `literalCorr` (c)/(d) skips, `convergingStack (a)`,
the 8-of-436 mixed-enclosure fallback.

## 4. Verification recipes

From `desktop/` (Node 22): `npx tsc --noEmit -p tsconfig.web.json`;
`npx vitest run src/renderer/src/utils/` → expect 1 failed (`convergingStack (a)`) /
799 passed; gates via env prefixes `SHAPE_AUDIT=1` / `HOLES_DIAG=1` / `CS1_GATE=1`
(the holes/lens/conformance diags are now hard gates in both flag states). Measure
before you assert; report file:line + a concrete failing scenario per finding;
design disagreements go in a separate clearly-marked section.
