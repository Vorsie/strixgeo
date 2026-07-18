# External audit — StrixGeo partition engine v2 (branch `wip-v2-tiler-rewrite` @ `43af41baa`)

You are auditing the rewritten 2D section-fill engine of a geotechnical ground-model
platform. The engine converts per-borehole lithology columns + user-drawn correlation
ties into a **true partition** of the cross-section plane (regions consumed by the 2D
overlay and the 3D voxel build). The rewrite is owner-directed rule-by-rule; your job
is to find where the CODE deviates from the RULES, plus genuine defects (correctness,
numerical robustness, maintainability). The rules below are LAW — do not propose
"improvements" that violate them, and do not re-litigate design decisions the owner
has ruled on.

## Scope — audit EXACTLY these files (everything else is out of scope)

Engine (flag-ON path is the product; 28 modules):
`desktop/src/renderer/src/utils/partitionFillV2/` — `computeSectionFillV2.ts`,
`emitCurves.ts`, `emitIntervals.ts`, `emitIntervalLenses.ts`, `emitTerminationSweep.ts`,
`drawTermination.ts`, `emitFloodWedge.ts`, `emitLenses.ts`, `emitBoundaryLens.ts`,
`emitEnclosingFlood.ts`, `emitRuledBands.ts`, `emitLoneStack.ts`, `emitSubstrate.ts`,
`emitSubTdLenses.ts`, `effectiveCorr.ts`, `tieContacts.ts`, `lensEnclosure.ts`,
`lensReach.ts`, `sectionGeom.ts`, `edgedLayers.ts`, `terminationRules.ts`,
`mergeTouchingBodies.ts`, `intersect.ts`, `snap.ts`, `tileFlags.ts`, `tileGap.ts`,
`tileCoherentStack.ts`, `tileCoherentStackTypes.ts`, `tileConvergingStack.ts`.

Verification layer (audit for gate-strength, not style): the sibling
`desktop/src/renderer/src/utils/partitionFillV2.*.test.ts` files — permanent gates
(`gap0HostSplit`, `faceLabel8n`, `edgedAnnulus`, `followTieOnlap`, `literalCorr`,
`mergeAfterFill`, `boundaryLens`, `lensReach`, `subTdLens`, `coherentStack`,
`convergingStack`, `coherentLoneStack`, `bidirSweep`, `edgedLayers`, `lensEdged`,
`enclosedLensDetour`) + env-gated diags (`cs1gates`, `conformance` (+`.classify.ts`),
`lensAudit`, `holes_overlaps`, `cs1flip_walkthrough`).

Context docs (read FIRST): `docs/design/partition-engine-v2.md` §8 (the ruling stack,
newest first) and `REWRITE_STATE.md` (sessions §19–§37 — constructions, measured
negatives, per-session records).

NOT in scope: `desktop/src/renderer/src/utils/partitionFill/` + `partitionFill.ts`
(the v1 engine — contractually READ-ONLY and byte-untouched this branch),
app components, backend, `scripts/`.

## The ground rules (owner rulings — the audit criteria)

1. **Corr is the LITERAL count (8l).** Per unit-side: corr = number of that unit's own
   contacts effectively tied. 0 → LENS, 1 → ONLAP, 2 → BAND. No band promotion:
   the band LOOK is emergent (two facing onlaps meet at the 0.5 apex + post-fill merge).
   corr-2 requires REAL own-contact ties (direct/shared-surface/bridge/top-band);
   a DERIVED band tie yields corr 1, never 2.
2. **Shared-contact ties (8a).** A tie ON a physical surface ties BOTH units sharing
   that surface (the unit above and below it, on each column).
3. **Follow-the-tie suppression (8m).** Before drawing a corr-1 onlap flank, follow the
   tie to the matched facing contact, compare litho: SAME → skip the flank (fill flows,
   merge welds); DIFFERENT → draw. Corr-1 only; lenses never suppressed.
4. **An onlap is ONE extra line (8i(d)).** The tie is existing line art; only the
   closing flank is drawn.
5. **Everything must lens (8i(e)).** Every corr-0 unit-side emits its lens flank —
   no thresholds, no narrow-gap guards. The `lensAudit` gate (MISSING = 0) is the
   letter-of-the-law check.
6. **Merge after fill (8j).** Same-litho touching regions weld into one body AFTER the
   fill (`mergeTouchingBodies`); a unit starts as its own body.
7. **Columns are ground truth (8k).** Iterate columns (user-picked lithos are truth);
   a gap is a look-direction, never the iteration frame.
8. **Top band = one correlation (8d-rev).** A first unit whose only tie is the top band
   is corr-1 and onlaps riding the surface.
9. **Lens reach (8b).** Lens reach = min(0.45×gap, ~2×unit thickness); on conflict with
   a tie, the LENS halves — seams never chase brackets.
10. **The fill is the FACE-FILL of the line art (8n — "stay inside the lines").**
    Every closed polygon bounded by the emitted line art is one region. An onlap/lens
    wedge carries the terminating unit's litho to its apex and NOT ONE POINT PAST IT.
    Past an onlap apex: the unit being onlapped INTO (sampled at the FLOODED contact,
    not mid-elevation). A band's litho may NEVER claim a face across its own band
    boundary line. Sub-TD: a band crossing a column below TD anchors at the
    band∩column intersect, extrapolated to both sides.
11. **Lens wedge = enclosing matrix (8n(b)).** The wrap past a corr-0 lens apex takes
    the litho of the lens's OWN-column enclosing matrix (walking past sibling
    minorities); the far facing column is NEVER sampled for a lens wedge. Lens wedges
    clamp to any tie their flanks cross (the tie owns the boundary).
12. **Lines are load-bearing.** Never delete or truncate given line art (ties,
    contacts, band contours) — split faces at junctions instead (the near-T pass in
    `intersect.ts` splits at T-junctions within 1 grid unit).

## Engineering invariants (hard; verify, don't assume)

- **True partition flag-ON**: interior holes above-TD = 0 and cross-litho overlaps = 0
  on the 14 real sections — EXCEPT the one known baseline (below).
- **Flag-OFF byte-identical**: every campaign change is gated on
  `twoSidedTerminationsEnabled()` (`tileFlags.ts`, runtime-mutable for tests) or
  provably unread flag-OFF. Flag-OFF output must equal the pre-campaign engine.
- **v1 untouched**: `git diff develop...wip-v2-tiler-rewrite --name-only` contains no
  `partitionFill/` file.
- **Determinism**: output must be stable across processes (no Map/Set iteration-order
  dependence in geometry or labels).
- **1 mm snap grid** (`snap.ts`); all geometry integer-grid after snapping; the near-T
  tolerance is 1 grid unit.

## Known issues — already tracked; do NOT spend your run rediscovering these

- CS2 gap17: 20 above-TD holes (the sloping-enclosure wall) — the one accepted flag-ON
  hole baseline.
- `literalCorr` cases (c)/(d) skipped: the col18 TRUE-untied interbed host-split
  (the +104-overlap annulus wall) — deferred.
- `convergingStack (a)`: 1 pre-existing red (enclosed lens pokes past a corr-1 onlap
  host's flank).
- 8 of 436 interior units have a MIXED enclosure (above/below matrices differ) — lens
  wedges there fall back to facing-sampling; owner ruling pending.
- The conformance gate audits the FLAG-OFF render with pre-8l inline arithmetic
  (intentional — documented in REWRITE_STATE §24/§25); baseline 5/5/0 = 10.

## How to verify claims (from `desktop/`, Node 22; env prefixes as shown)

- `npx tsc --noEmit -p tsconfig.web.json`
- Full suite: `npx vitest run src/renderer/src/utils/` → expect 1 failed
  (`convergingStack (a)`) / 789 passed / 23 skipped.
- Gates: `SHAPE_AUDIT=1 CS1_GATE=1 npx vitest run <gate files> --disableConsoleIntercept`
- Holes/overlaps flag-OFF: `HOLES_DIAG=1 npx vitest run
  src/renderer/src/utils/partitionFillV2.holes_overlaps.diag.test.ts
  --disableConsoleIntercept` → 0/0/0. For flag-ON, copy that file, import
  `setTwoSidedTerminations` from `./partitionFillV2/tileFlags`, wrap the
  `computeSectionFillV2` call in set-true/try/finally → 20/0 (all CS2-g17), overlaps 0.
- Real 14-section input: `scripts/diag_allsections_input.json`.

## What to audit for (priority order)

1. **Rule conformance**: places where the code contradicts rules 1–12 — especially
   guards/heuristics/thresholds that a ruling deleted but that survive somewhere,
   litho decisions made from anything other than the tie/line art, and label sources
   that sample a column the rules forbid.
2. **Numerical robustness**: the snap/near-T interplay (`snap.ts`, `intersect.ts`) —
   tolerance interactions, degenerate segments, apex-on-vertex cases, potential
   double-splits or missed splits at compound junctions.
3. **Silent failure paths**: fallbacks that swallow a defect instead of surfacing it
   (e.g. label fallbacks, `null` enclosures, faces no constraint reaches) — each should
   be counted/logged, not silent.
4. **Gate strength**: permanent gates that would stay green under a plausible
   regression (assertions on summaries instead of shapes, tolerance too loose,
   RED-provenance missing).
5. **Dead code from the rewrite**: flag-ON-unreachable tiler paths (the seam-era
   `tileInterval` body and friends are scheduled for deletion at cutover — flag
   anything ALREADY unreachable in BOTH flag states).
6. **Maintainability**: the escalating parameter threading (col/ui/activeTies through
   the sweep call chain), duplicated constructions, files past 500 lines.

## Report format

Per finding: file:line, the rule/invariant violated (cite the rule number or name),
severity (correctness / robustness / debt), a concrete failing scenario (real-data
coordinates if you can), and the minimal fix direction. Verify each correctness claim
against the battery above before reporting it — measured evidence beats reading. Do
not report the Known Issues list back. Findings that are really design disagreements
with the rulings: separate section, clearly marked, no severity.
