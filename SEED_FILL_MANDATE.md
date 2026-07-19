# IMPLEMENT AND LAND: flag-ON v2 seeded paint-bucket partitioning
# Owner doctrine is binding. No alternative labelling model.
# Work on the current `wip-v2-tiler-rewrite` tip. Preserve flag-OFF exactly.
# (Owner-delivered mandate, 2026-07-19. Verbatim. Rulings context: design §8 8a-8q.)

## The decision is already made

Do NOT ask whether a continuation/enclosure/facing-column label rule is preferable.
It is not.

The owner's final rule is:

> Draw the literal termination linework first: lenses on both sides, then onlaps on both
> sides, alongside the picked column faces and approved correlation/band/domain boundaries.
> Snap and split that one line network, trace its bounded faces, then paint each face as a
> paint bucket from the picked-unit column edge on that face's boundary.

This is a planar-topology problem. The line network decides containment. Picked column edges
decide lithology. A post-hoc label heuristic is forbidden because it invents geological
continuity after topology failed to express it.

## The one invariant the implementation must enforce

For every bounded face inside the fillable model domain, before slicing to gaps:

1. Inspect actual boundary edges originating from `col<ci>:u<ui>` curves. A vertex touch is
   not a seed; the face must own a non-zero-length column-edge segment.
2. Resolve those column edges to the picked units' `formationId`.
3. Deduplicate formation IDs.

The only legal result is exactly one formation ID.

| Seed state | Meaning | Required behaviour |
|---|---|---|
| exactly one formation | Valid geological face | Paint that formation |
| zero formations | Either explicit exterior/no-fill domain or missing topology | Never invent a lithology; classify explicitly and fail the gate if it lies in the fillable domain |
| two or more formations | Missing, open, crossed, or wrong separator line | Fail the gate; repair the linework, never vote/select a label |

Many column segments are allowed. Many body IDs are allowed. The invariant concerns distinct
FORMATION IDs only.

A face with a single seed formation must receive that formation even if:
- a longer boundary edge belongs to another unit elsewhere in a pre-slice aggregate;
- an enclosure walk says something else continues;
- the facing column says something else;
- a flood/lens/onlap helper carried a different synthetic label.

No exceptions.

## Architecture to implement

### A. Termination planning and emission

The existing termination plan is the only authority for corr outcome per unit-side:

- literal corr 0 -> lens geometry;
- literal corr 1 -> onlap geometry riding that unit-side's exact TieRef;
  same matched lithology means no extra onlap flank, not a guessed fill;
- literal corr 2 -> existing tied/band line art, no termination.

Run this for both left and right looks. Do not allow sub-TD routing, bridge handling,
same-lithology logic, formation overlap, or an old tiler path to silently erase a planned
corr-0/corr-1 outcome. If a planned outcome cannot form a valid face, surface that as topology
failure with the plan key and the missing boundary; do not convert it into a different outcome.

The final arrangement input consists only of:
- picked column faces;
- approved ties/bands/bridges;
- top/domain/floor boundaries that are genuinely part of the model domain;
- plan-emitted lens/onlap geometry.

All intersections must be snapped and split before face tracing. Any endpoint that should touch
a boundary must become the same DCEL vertex after the existing 1 mm rules.

### B. Flag-ON face painting

Add a distinct flag-ON face-labelling path. It must be structurally separate from flag-OFF.

Pseudo-code:

```ts
const seeds = formationIdsOfNonZeroColumnBoundaryEdges(face)

if (seeds.size === 1) {
  return { kind: 'filled', formationId: onlySeed, seedRefs }
}

if (isExplicitNoFillDomain(face)) {
  return { kind: 'void', reason: 'explicit-domain', seedRefs: [] }
}

return {
  kind: 'topology-defect',
  reason: seeds.size === 0 ? 'zero-seed' : 'multi-seed',
  seedRefs,
  boundaryCurveIds: face.boundingCurveIds,
  bounds: faceBounds(face),
}
```

`isExplicitNoFillDomain` must be narrow and geometric: exterior/unmodelled domain only.
It must not mean "the old code had no label for it" or "this is below TD, so guess/fill it."
A sub-TD region that is supposed to be geological fill must connect to a picked-unit column
seed through valid linework. Otherwise it is a defect or an explicitly unfilled void.

Keep seed references on the labelled face for diagnostics. Formation ownership and body ownership
are separate concerns: do not use `bodyId` to choose a formation. Preserve sufficient seed/body
provenance for the existing post-fill body merge.

### C. What must not remain as flag-ON lithology authority

Remove or bypass, on the flag-ON path only:

- length-weighted `resolveLabel` voting;
- `lensLabels` as a way to choose a face's formation;
- `lensEnclosure.ts` as a fill-label decision;
- `emitFloodWedge` label ownership;
- facing-column formation sampling;
- synthetic flood/substrate labels;
- any "dominant", "nearest", "continuing", or fallback formation selection.

Some of those values may still be needed temporarily to construct a geometric boundary. They may
not decide a completed face's lithology.

Flag-OFF must remain byte-identical. Do not refactor it opportunistically.

## Work in this exact order

### Step 1 — establish the measured seed gate before changing labelling

Create a temporary Vitest diagnostic using the real
`scripts/diag_allsections_input.json`, every section, with flag-ON forced in try/finally.

Run the actual pre-slice pipeline:

```
buildSectionInput
-> emitCurves
-> buildArrangement
-> traced faces
-> seed classifier
```

For every non-exterior face record:

- section;
- face index/stable diagnostic id;
- x/elevation bounds;
- boundary curve ids;
- resolved non-zero column-edge seed refs;
- distinct seed formations;
- classification: `single-seed`, `explicit-void`, `zero-seed-defect`,
  or `multi-seed-defect`;
- relevant termination-plan keys when a plan curve bounds the face.

Report per-section counts. The output must be deterministic and compact enough to pin in a
diagnostic fixture or test artefact.

Also compare every single-seed face with the current flag-ON painted formation. Every mismatch is
a concrete example of the old label layer being wrong.

Do not make any implementation change until this diagnostic proves which faces are valid and
which linework is incomplete.

### Step 2 — write red behavioural tests from the owner's words

Before replacing any label path, add narrow tests that say:

- "a face bounded by SILT picked-unit edges paints SILT, regardless of synthetic flood labels";
- "a zero-seed fillable face is reported as topology-defect, never painted";
- "a mixed KLEI/SILT seed face is reported as topology-defect, never length-voted";
- "flag-OFF output is unchanged";
- real-data regressions for B6/B4, B3, B2, and S11 where applicable.

Run them RED against the old flag-ON label behaviour. If a proposed test is green immediately,
either the behaviour already exists or the test is not checking the rule; investigate before
continuing.

### Step 3 — implement seed labelling only

Implement the flag-ON seed path in `labelFaces.ts` or a focused adjacent module.
Do not repair defects with label fallback. A topology-defect must be visible to the test/diagnostic.

At this stage, valid single-seed faces should paint correctly; zero/multi faces should turn into
explicit failures with full provenance. This is success, not a regression: it exposes linework
that prior heuristics hid.

### Step 4 — repair linework defect by defect

For each remaining zero/multi face inside the fillable domain:

1. Identify the missing/wrong physical boundary and the plan key that should own it.
2. Add a focused red regression test in owner language.
3. Make the minimal geometry/emission correction.
4. Re-run the seed diagnostic.
5. Confirm the face becomes exactly-one-seed; do not merely make it visually less obvious.

Never add a second heuristic in response to a new defect.

Known contexts must be classified, not rediscovered as vague new findings:

- CS1-g3 holes;
- CS2-g17 holes;
- `convergingStack (a)`;
- `literalCorr` (c)/(d).

For each, state whether it is an explicit void, a zero-seed defect, a multi-seed defect, or a
separately accepted/pinned limitation. If it is supposed to fill, it cannot remain unresolved.

## Real-data acceptance gates

The feature is NOT landed until all of these hold:

1. Every fillable pre-slice face on all real input sections has exactly one formation seed.
2. There are zero unresolved `zero-seed-defect` and `multi-seed-defect` faces.
3. Every explicit void is geometrically outside the fillable model domain and is listed with a reason.
4. No flag-ON painted face gets its formation from a vote, flood label, enclosure lookup, facing
   lookup, or fallback.
5. B6/B4 never receives a synthetic diagonal that crosses the SILT base tie.
6. B3's SILT termination is not continued by a CLAY-labelled synthetic wedge.
7. B2's SAND/CLAY separation is a real separator in the arrangement, not a label choice.
8. S11's sub-TD corr-1 plan either forms its onlap topology or reports the exact missing geometry;
   it is never silently dropped.
9. The rendered output has no overlaps, no holes inside the fillable domain, and no region crosses an
   approved tie/band boundary.
10. Flag-OFF is byte-identical.

## Required evidence at handoff

Provide:

- the per-section seed-count table;
- the complete final list of explicit void faces;
- an empty final list of unresolved zero/multi fillable faces;
- every old-label versus seed disagreement found and how it was removed;
- links to the red-first tests for every repaired topology class;
- actual real-input output evidence for B6/B4, B3, B2, and S11;
- test output for:

```powershell
npx vitest run src/renderer/src/utils --silent
npx tsc --noEmit -p tsconfig.web.json
```

Do not claim success based on green unit tests alone. Compare the actual rendered/region output to
the owner's stated geometry. The unit of done is: the final line network is a valid, uniquely seeded
paintable map — no geology is guessed after the fact.
