# Retire the DB body-extent system — the partition fill is the one model

**Date:** 2026-06-06
**Status:** design / owner-approved direction (Option 1)
**Owner directives in this session:**
- *One consolidated way to make bodies* — not another parallel mechanism.
- The 2026-06-05 partition fill ("Fill bands does everything") is that way.
- Retire the superseded DB-entity extent system + the 5 obsolete tests.

---

## 1. Context — how we got here

The same-lithology correlation guard (`correlate_litho_contacts.py`, `46b2bac1`,
2026-06-05) rejects cross-lithology edges. That broke the old `to_target`
body-extent detector (`detect_body_extents` / `DetectBodies`): it requires both
of a body's bounding contacts (different lithologies) to correlate to one target,
which the guard forbids. Five integration tests test only that broken detector and
fail deterministically.

Investigating the fix surfaced the real situation: on **2026-06-05** the section
fill was rewritten as a **partition fill** (`PartitionFillOverlay` +
`utils/partitionFill.computePartitionFill`). It aligns adjacent column unit-stacks
into a hole-free, overlap-free partition; **pinch-outs and lenses fall out of that
geometry** (a `pinch` region + a `lens` region), and freedraw handles
(`body_boundary_nodes`) shape them. The Bodies-dropdown already **hides** the
DB-entity verbs (Detect-lenses / Suggest-pinch-outs / Accept-pinch-outs) with the
note *"the partition fill derives lenses + pinch-outs in pure geometry, so these
manual DB-entity verbs are redundant + confusing — draw bands does everything."*
`BodyExtentOverlay` (which renders from the extent columns) is dead code behind
`SHOW_LEGACY_BODY_EXTENT` (off). `PartitionFillOverlay` renders live and reads
**`lithoLayers` + `body_id` + `body_boundary_nodes` — never the extent columns.**

So the whole DB-entity extent system is **superseded**, not broken-and-worth-fixing.
The consolidated decision (owner, this session) is to **retire it**.

## 2. Core problem / who / success / non-goals

- **Core problem.** A superseded DB-entity body-extent system lingers behind the
  partition fill — broken by the guard (5 red tests), feeding only dead/hidden
  code, and duplicating the one model the owner actually uses. It must go, so
  there is exactly **one** way to make bodies.
- **Who.** The geotechnical engineer: *correlate same-lithology contacts → click
  "Fill bands" → freedraw the few pinch/lens shapes that are wrong.* One path.
- **Success.**
  - The DB-extent system and its 5 obsolete tests are deleted.
  - The partition fill (`computePartitionFill` + `PartitionFillOverlay` + freedraw
    `body_boundary_nodes`) is the **sole** body-shape model.
  - Full suite green (unit + integration + e2e); nothing live regressed.
  - Future 2D/3D export remains possible from the persisted raw inputs (§6).
- **Non-goals.**
  - Building any export now (there is none — the export menu items are
    placeholders).
  - Porting `computePartitionFill` to Python now (tracked future work, §6).
  - 3D interfingering between control points (Phase 5).
  - Cross-lithology correlation (the guard stays — it is correct).
  - Re-introducing an auto-detector or a side-effect-on-correlate (your
    2026-05-31 explicit-verb directive stands).

## 3. Keep vs retire (the heart of the change)

**KEEP — the partition-fill model + its inputs:**

| Component | Role |
|---|---|
| `ResolveLithoInstances` | One `body` per same-lithology connected component; stamps `litho_layer.body_id`. Runs inline on correlation changes (unchanged). |
| Correlation edges (`LithoContactCorrelationEdgeOrm`) | Drive the resolver's components. |
| `litho_layer` rows | The picks (depth, formation, `body_id`). |
| `body` rows | Identity + name + `body_boundary_nodes`. (Extent columns removed — §5.) |
| `body_boundary_nodes` + the save-boundary path | The freedraw shapes (the engineer's manual override). |
| `computePartitionFill` + `PartitionFillOverlay` + "Fill bands" toggle | The one geometry engine + render. |

**RETIRE — the DB-entity extent system (each subject to a no-live-consumer grep first):**

- Backend use cases: `DetectBodies`, `SuggestBodyPinchOuts`, `ClaimBodyExtent`
  (+ their endpoints, request/response schemas, and `api/clients/geology.ts`
  methods).
- Domain: `detect_body_extents.py` (+ `BodyExtent` / `DetectedBody` in
  `body_extent.py`), `BODY_MAX_THICKNESS_DEFAULT_M` + `_resolve_max_thickness`.
- `extent_kind.py` constants (`to_target`, `pinch_out_halfway`, `extrapolated`,
  `open`, the provenance helpers) **iff** no remaining consumer (verify; the
  partition does not use them).
- DB: the `body.extent_*` columns (`extent_<side>_kind`, `_provenance`,
  `_target_contact_id`, `_neighbour_inv_id`) — Alembic migration to drop.
- Frontend: `BodyExtentOverlay` + `SHOW_LEGACY_BODY_EXTENT`; the hidden Bodies-
  dropdown items (Detect-lenses / Suggest-pinch-outs / Accept-pinch-outs) + their
  handlers + `pinchOutCandidates` state; the "Lens max thickness" Settings row
  (`view_state.litho_segmenter.max_lens_thickness_m`).
- Tests: the 5 failing integration tests **plus** every test that targets a
  retired component (`SuggestBodyPinchOuts`, `ClaimBodyExtent`,
  `detect_body_extents`, the body-extent API tests, `BodyExtentOverlay` tests).

**FLAG for owner (not auto-retired — adjacent, semantics unclear under partition):**

- "Materialise lens companions" verb (`materialiseLensCompanions`) — companion-
  section creator; still meaningful?
- "Delete all detected lenses" verb — with no detector, what is a "detected lens"?
  Re-label to operate on resolver/partition bodies, or retire?

## 4. The one consolidated flow (after this change)

> **correlate same-lithology contacts → band appears (resolver) → click "Fill
> bands" → partition draws bands + pinch-outs + lenses → freedraw any shape that's
> wrong (persists as `body_boundary_nodes`).**

No detector, no per-cap suggest/claim, no extent columns. The pinch-out geometry
is `computePartitionFill`; the manual overrides are `body_boundary_nodes`.

## 5. Data / format changes

Backwards compatibility is **suspended pre-ship** (2026-05-16), so a clean break
is allowed:

- **Alembic migration** dropping the four `body.extent_*` columns.
- **`.strix` bundle v4**: remove the extent fields from the body serialize/restore
  (no version bump — pre-ship amnesty). Legacy bundles carrying extent data:
  the fields are ignored on restore; bodies + `body_boundary_nodes` + membership
  round-trip unchanged, so a re-opened legacy project renders identically via the
  partition.
- **Settings**: remove the "Lens max thickness" row.

## 6. Future export (the foresight check — answers "can we export 2D/3D later?")

**Yes, and retiring leaves us better positioned.** Export geometry *is* the
partition polygons, deterministically reconstructible from the kept raw inputs:
`litho_layer` picks + `body_id` membership + correlation edges + `body_boundary_nodes`
+ section/column geometry. The extent columns stored only a partial, single-valued
`(kind, target, neighbour)` per side — they never captured the multi-node freedraw
shapes (those are in `body_boundary_nodes`), so for export they were strictly
*less* complete than what we keep. 3D (Phase 5 interfingering) draws from the same
raw inputs; the extent columns never helped it.

**The one tracked future task:** `computePartitionFill` lives only in client-side
TypeScript; the exporters (`BaseExporter`, Plaxis/DXF) are Python. When export
lands (Phase-4 export step / Phase 5), make one bounded choice — **port
`computePartitionFill` to a Python domain service** (clean-architecture-correct;
the TS becomes a consumer of the shared contract) **or export client-side**. Not
now. Recorded here so it is a deliberate decision, not a scramble. It is not a
foreclosure: the raw inputs are persisted and the algorithm is portable.

## 7. Edge cases — now partition-geometry behaviours (verify coverage)

These were the cases we walked; under Option 1 they are properties of
`computePartitionFill` aligning two column stacks, **not** of an extent detector.
Each must be covered by `partitionFill` / overlay unit tests (add where missing):

| Case | Partition behaviour |
|---|---|
| One-sided pinch-out | Body matches the neighbour on one side (quad), pinches on the other (pinch region). |
| Stacked lenses | Each unit aligns independently; per-`body_id` identity keeps same-lithology lenses separate. |
| Single-column lens | A unit with no match either side → `lens` region (triangle / freedraw polygon). |
| Skip-column continuation | Membership spans the gap → one body; alignment tiles the matched interface. |
| Section edge | First/last column units fill out as open-end stubs (~5 m, `OPEN_END_M`). |
| Bottom substrate | Deepest unit tiles to the base; no spurious pinch. |
| Min / zero thickness | N/A — enforced at the litho-layer level (422; FE 0.01 m / BE 0.001 m); bodies inherit it. |
| Partition invariant | Every gap is hole-free + overlap-free (the 2D→3D correctness rule). |

## 8. Test plan

- **Delete** the 5 failing integration tests and every test bound to a retired
  component (enumerate via grep in the plan: `SuggestBodyPinchOuts`,
  `ClaimBodyExtent`, `detect_body_extents`, body-extent API + `BodyExtentOverlay`
  tests).
- **Keep + extend** `bodyBands.test.ts` / `computePartitionFill` / overlay tests so
  the §7 matrix is covered (add any missing case as a pure unit test — comments
  phrased in partition vocabulary: quad / pinch / lens / open-stub).
- **Regression**: a `partition is hole-free + overlap-free` property test over a
  representative multi-column stack.
- Full gates green: `tsc` web+node, Vitest, `mypy`, `ruff`, integration (wrapper
  DB), e2e (`run-e2e.ps1`).

## 9. Build sequence (for the implementation plan)

1. **Survey + confirm** no live consumer of the extent columns / retired use cases
   (grep `extent_left_kind`, `extent_right_kind`, `ClaimBodyExtent`,
   `SuggestBodyPinchOuts`, `DetectBodies`, `detect_body_extents`,
   `BodyExtentOverlay`, `max_lens_thickness_m` across `src/`, `desktop/src/`,
   `tests/`). Confirm the freedraw save-boundary path is independent of
   `ClaimBodyExtent`.
2. **Frontend removals** (no-behaviour-change first): delete `BodyExtentOverlay`
   + `SHOW_LEGACY_BODY_EXTENT`; remove the hidden dropdown items + handlers +
   `pinchOutCandidates`; remove the "Lens max thickness" Settings row; drop the
   retired `geology.ts` client methods. `tsc` + Vitest green.
3. **Backend removals**: delete the use cases + endpoints + schemas + domain
   files + the max-thickness guard; remove `DetectBodies` from the restore/startup
   sweep (resolver-only there). `mypy` + `ruff` + unit green.
4. **Migration + bundle**: drop `body.extent_*` columns; strip extent fields from
   bundle serialize/restore. Integration green (incl. a legacy-bundle-opens test).
5. **Tests**: delete obsolete tests; add the §7/§8 partition coverage.
6. **Record** the export-portability note (§6) in `docs/debt.md` as a Tier-D
   future task.
7. **Verify**: full suite + e2e green. Then the original integration handoff
   close-out (the pending e2e run + worktree cleanup) proceeds on a clean tree.

## 10. Open questions for the plan / owner

1. **Materialise companions / Delete-all-detected verbs** (§3 flag) — re-label,
   retire, or keep?
2. **`extent_kind.py` / `body_extent.py` deletion** — confirm zero remaining
   consumers before removing (the plan's step-1 grep decides).
3. **Companion sections** — does retiring the extent system touch the companion-
   section feature at all? (Step-1 grep decides; expected: no.)
