# Truthful 3D litho fill — sideways continuation + any-side correlation ties (design)

**Date:** 2026-06-17 (rewritten after real-data diagnosis on `test.strix` CS1)
**Status:** design approved (owner, 2026-06-17); ready for an implementation-plan rewrite
**Supersedes:** the earlier framing of this same file ("bottom-tie correlation — band the deepest unit"). That framing was derived from synthetic 2-unit fixtures and was wrong about both the mechanism and the primary use case. This rewrite is grounded in measured CS1 numbers (see §3).

---

## 1. Problem & goal

When the built **3D voxel litho model** is sliced back along a cross-section, a deep unit's lithology **climbs upward** to fill **shallow neighbouring tests that never observed it** — the owner's "sand running up from B2 to S7a", and "left of S5a". The fill is *not sideways* where it should be.

Diagnosis (real `test.strix` CS1, measured — §3) established two facts that redirect the whole feature:

1. **The 3D voxel labeller is faithful — it is NOT the cause.** Sampling the labelled stack on the section plane (`ONLINE`), the raw blend (`BLEND`), and the geo-bounded path (`GEO`) gave **identical** elevations. The climb is already present in the 2-D `computeSectionFill` partition; the voxel builder reproduces it exactly. **The fix belongs in the 2-D partition (`partitionFill.ts`); the 3-D model inherits it for free** — no labeller change.
2. **The climb is a deep unit being dragged up to fill a shallow test.** S5a (TD +7.91 mTAW) and S7a (TD +10.42) are shallow tests that never reached the thick deep sand; the partition extends the sand's top up to their TDs (B2→S7a: sand top dragged +4.25 → +10.42 into a test that never saw sand).

**Goal:** make the litho fill **truthful**: a unit observed at one test continues **sideways** (flat, at its observed elevation) under a shallower neighbour that never reached it, instead of climbing — *unless* the geologist explicitly **ties** it to say otherwise. Ties are correlations on **any contact side** (top, base, or the column bottom), which the per-endpoint side schema already supports.

**Non-goals:** §11. No apex-cap. No change to the 3-D voxel labeller. No change to auto-correlate ("suggest correlations") behaviour. The 2-D "Fill bands" overlay and the 3-D model both read the same `computeSectionFill`, so the fix improves both at the climb spots (the 2-D Fill bands currently climbs there too — measured).

---

## 2. Decisions (owner-confirmed 2026-06-17)

- **Un-tied default = SIDEWAYS (flat).** A unit whose lithology is not correlated to a shallower neighbour continues laterally at its observed elevation, passing **under** the shallow test — it does **not** climb up to fill the shallow column.
- **Ties are the explicit control, on ANY endpoint side.** A correlation edge joins two contacts; each endpoint independently carries a side:
  - **top↔top** — existing (a unit's top surface continues across).
  - **base↔base** — a "bottom-tie": the unit's BASE continues / the two deepest bases connect. *(Kept and fully supported — "tie the bottoms too".)*
  - **top↔base (mixed)** — the primary new use case: **deep-unit-TOP ↔ shallow-test-BOTTOM (TD)**, meaning "the unit's top rises to meet where this shallower test bottomed out, and continues below it."
- **Correlation always overrides geometry** — a tie bands/continues the unit no matter the elevation gap; no proximity guard.
- **Body-split prerequisite (owner: fix it now).** Two **non-adjacent** occurrences of the same lithology at one test (e.g. a 0.3 m shallow sand sliver + the thick deep sand at S6) must be **distinct bodies**, not merged — otherwise there is no distinct deep-unit-top surface for a tie to attach to (this blocks the S6→S5a case today).
- **Schema/backend already built** (per-endpoint `contact_a_side`/`contact_b_side`, widened uniqueness, migration, correlate/uncorrelate/list/bundle) — carries forward unchanged; all three side combinations are representable.

---

## 3. Evidence (measured on `test.strix` CS1, dev model `019e934c…`)

Tests on CS1: **B2** (`1411-GEO-23/126-B2`, deep, TD −4.45, deep-sand top +4.25), **S7a** (`GEO-23/125-S7A`, shallow, TD +10.42, **no deep sand**), **S6** (`GEO-23/125-S6`, deep, deep-sand top +7.03 **plus** a +11.43 shallow sliver — *merged into one body*), **S5a** (`GEO-23/125-S5A`, shallow, TD +7.91, only thin near-surface slivers).

- **Gap B2→S7a:** the single ZAND region's top ramps **+4.25 → +10.42** straight to S7a's TD — a solid up-dragged band into a test that never observed sand. Should pinch/continue sideways instead.
- **Gap S6→S5a:** the shallow sliver (+11.43) and deep body (+7.03) are fused into one body; its top pins at +11.4 and its base ramps −5.87 → +9.61. The deep-sand-top surface is erased.
- **Labeller faithfulness:** at every sample `ONLINE == BLEND == GEO`. The 3-D model is innocent.

---

## 4. Scope / touched modules

- **Frontend partition:** `desktop/src/renderer/src/utils/partitionFill.ts` — (a) the **sideways-default** for a unit facing a shallower neighbour that does not reach it; (b) honour **all** tie sides (top/base/mixed) in the band/continue decision, not just `base↔base`; (c) the existing per-gap classification consumes the per-endpoint sides on the `CorrelationEdge`.
- **Body assignment / resolver:** wherever a test's same-lithology occurrences are grouped into a `body_id` — **split non-adjacent occurrences** (a shallow sliver and a deep body separated by other lithology are different bodies). Likely `ResolveLithoInstances` / the body-id assignment the partition reads. (Investigate exact site during planning.)
- **Frontend section editor:** grab handles for a unit's **top**, its **base**, and a column's **bottom (TD)**; the correlate gesture creates an edge with the correct per-endpoint sides. `CorrelationEdgesOverlay` renders interpretive (base/mixed) ties dashed.
- **Confidence:** interpretive (base-side) tie contacts excluded from the distance/confidence calc.
- **Voxel:** **no change** — inherits the corrected partition on the next Build.
- **Schema/backend:** none (already built).

---

## 5. Behaviour rules (each to be test-pinned)

1. **Sideways default.** A unit observed at test A, whose lithology is NOT correlated to a shallower neighbour B that bottoms out **above** the unit, continues **flat at its observed elevation** under B. Its top is **not** dragged up to B's TD. (B2→S7a: the deep sand stays ~+4.25, continues under S7a; it does not ramp to +10.42.)
2. **Mixed tie (top↔base) reaches the TD.** When the geologist ties the deep-unit-TOP to the shallow-test-BOTTOM, the unit's top rises to meet that test's TD elevation at that test's position and continues below — the explicit "it reaches here" control.
3. **base↔base tie.** Two deepest bases tied → the unit's base continues across (the bottom-tie); the deepest unit can band when both its top (top-tie) and base (base-tie) are correlated.
4. **top↔top tie.** Unchanged from today.
5. **Correlation overrides geometry.** A tie continues the unit regardless of elevation gap; no proximity guard.
6. **Body-split.** Non-adjacent same-lithology occurrences at one test are distinct bodies, each with its own top/base surfaces; a tie attaches to the intended one.
7. **No regression where already correct.** Sections/gaps that render correctly today (correlated bands, genuine pinch-outs) are unchanged.
8. **3-D parity.** After a Build the voxel model reproduces the corrected partition (no labeller change).

---

## 6. Frontend — gesture + rendering

- Each unit exposes grab handles at its **top** and **base** contacts; each column additionally exposes a **bottom (TD)** handle (the deepest base, otherwise not an addressable contact). The existing correlate gesture connects any two handles → an edge stamped with each endpoint's side (`top`/`base`).
- Mixed and base-side ties render **dashed / interpretive** (distinct from the solid observed top-correlation), so an interpretive continuation reads at a glance.
- Deletion / re-grab follow the existing correlation-edge affordances. "Suggest correlations" (auto-correlate) is untouched and continues to produce top↔top suggestions only.

---

## 7. Partition — how the sides drive continuation

`computeSectionFill` already decides a unit's shape per gap from its bounding contacts' correlations. Extend it so:

- The `CorrelationEdge` carries `aSide`/`bSide` (`'top'|'base'`, default top) — already wired from the API rows.
- **Sideways default:** when a unit on the deep side has no correlation to the facing shallow neighbour AND that neighbour's stack does not reach the unit's depth, the unit continues **flat** (a quad at its own top/base elevations extended under the neighbour), rather than its top being interpolated up toward the neighbour's shallow stack. This is the core change — the current up-drag must become a flat sideways continuation.
- **Tie-driven continuation:** an edge on a unit's contact (matched by `layerId` + side) makes that contact "correlated" toward the neighbour. The band/onlap/pinch decision counts top + base correlations as today; a base side is supplied by a `base`-side edge on the unit's own layer (incl. the deepest unit's column-bottom). A mixed tie correlates the named side on each end independently.

*(Implementation note for the plan: the partition currently drags the deep unit up. The plan must locate that path — the per-gap matching / interface interpolation that raises the deep unit's top toward a shallow neighbour — and replace it with the flat continuation when uncorrelated + unreached. The base↔base honouring from the earlier partition work is a starting point but must be generalised to all sides + the sideways default.)*

---

## 8. Confidence — exclude interpretive ties

Interpretive (base-side / mixed) tie contacts carry no observed data, so they are **excluded** from the distance/confidence inputs (`distanceConfidence.ts` / `tinConfidence.ts`). A tie never inflates confidence. (The 2-D model-fill overlay already has confidence-fade off; this governs every other consumer.)

---

## 9. Body-split — distinct bodies for non-adjacent same-lithology occurrences

At a single test, two same-lithology layers separated by a different lithology (a shallow sand sliver above a thick clay above the deep sand) must NOT be one body. Split them so each occurrence has its own top/base surfaces. This is the prerequisite for the S6→S5a mixed tie (today the +11.43 sliver and +7.03 deep body are one body, erasing the deep-sand-top). Locate the grouping site (resolver / body-id assignment) during planning; pin with a unit test on the S6-shaped stack.

---

## 10. Voxel — inherits, no change

The voxel build consumes the `computeSectionFill` partition. Once the partition continues sideways / honours ties, the voxel model reproduces it on the next **Build**. The 2-D Fill-bands overlay reflects it immediately; the 3-D model needs a re-Build. No labeller change — proven faithful (§3).

---

## 11. Out of scope

- Apex-cap / pinch geometry beyond the sideways default and tie-driven shapes.
- Any change to the 3-D voxel labeller (`label_voxels.py`) — exonerated by measurement.
- Any change to auto-correlate ("suggest correlations").
- The Phase-5 automatic deepest-first geometric fill (`docs/debt.md` #221).

---

## 12. Testing strategy

- **Partition unit tests** (`partitionFill.test.ts`, behaviour-shaped via `coverAt`): (a) **sideways default** — a deep unit facing a shallower un-reaching neighbour continues flat at its observed elevation, its top NOT dragged to the neighbour TD; (b) **mixed tie** — top↔base tie raises the unit's top to the tied test's TD; (c) **base↔base tie** — bottom-tie continues the base; (d) **top↔top** unchanged; (e) existing correct gaps byte-identical.
- **Body-split unit test:** an S6-shaped column (shallow sliver + clay + deep body) yields two distinct same-lithology bodies.
- **Real-data validation (the load-bearing check):** reconstruct CS1, confirm the deep sand continues **sideways** under S5a/S7a (no climb) with no tie; confirm a mixed tie makes it reach a chosen TD; confirm the S6 sliver/deep-body split; **rebuild the voxel model and confirm the slice is truthful** (the owner's "rebuild and check" standard — do this, don't assert it).
- **No-regression:** full `partitionFill` suite + the existing e2e correlate/section flows green; auto-correlate unaffected.

---

## 13. Risks & mitigations

- **Changing the partition's up-drag may shift other gaps.** Mitigate with the byte-identical-where-correct regression (rule 7) + real-data CS2/CS3 spot checks.
- **Body-split scope creep.** Keep it minimal: split only non-adjacent same-lithology occurrences; do not touch adjacent merging or the resolver's other duties.
- **Sideways continuation must still respect geological bands** (the 3-D geo-band bounding) — verify the flat continuation does not cross a geological surface (the voxel geo-band clip already enforces this; confirm the 2-D partition's flat fill is consistent).
- **Mixed-side semantics in the gesture** — validate each endpoint's side independently; a top↔base tie must persist both sides correctly (the schema supports it; pin with the gesture test).
- **The earlier partition work (base↔base classifyTermination)** must be generalised, not just kept — its `base↔base`-only handling and the deleted MX1-masked tests are superseded by §7's sideways-default + all-sides design.
