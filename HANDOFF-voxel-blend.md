# HANDOFF — voxel litho: body merge + the section-based blend

Strix repo, branch `develop` (all work below is UNPUSHED — push is the owner's call).
Read `AGENTS.md`, `docs/design/section-fill.md`, `docs/debt.md` #241–#243, and
`memory/project_voxel_litho_builder.md` before touching anything.

**Owner is on remote control.** He is reachable but intermittent. That means:
ask a domain question the moment a rule is genuinely ambiguous and park that
thread; do NOT invent a geological heuristic to keep moving
(`memory/feedback_ask_domain_questions_dont_bugfix`). Pure geometry, plumbing and
test work may proceed autonomously.

---

## Ground rules

* **Evidence-first.** Every claim reproduced before it is asserted. The owner has
  been burned by confident wrong answers twice today; both times the fix was to
  instrument rather than reason.
* **Prove an offline harness reproduces production BEFORE trusting it.** The
  control arm of any A/B must return the persisted build's numbers exactly. Two
  traps already cost time: the mesh vertex lattice is NOT the voxel lattice (the
  greedy mesher inserts edge MIDPOINTS, so a 2 m grid looks like 1 m), and the
  committed oracle fixture `tests/fixtures/voxel/teststrix_partitions.json` is a
  **v1-engine** capture while the model is built with **v2**.
* **Do NOT touch**: the 2-D partition engines (`partitionFill`, `partitionFillV2`),
  the model-fill renderer (`sectionFromSolids` / `resolveModelFillPolys` /
  `ModelFillOverlay`), or the watertight / zero-overlap invariants. They are
  correct and gated.
* **Do NOT move a baseline to make a number look better.** If a metric is
  misleading, ADD a second clearly-labelled line beside it (see what was done to
  `eval_strat_fidelity` in commit `76636aa38`).
* Commit per file, Conventional Commits, never push.

## The reference model

Dev DB `groundmodel`, litho model `019e934c-70fd-7d11-a44a-b2073f4063a2`,
2 m horizontal / 0.25 m vertical, 58 investigations, 14 sections, 90 bodies.
Current state after today's work: **58/58 columns covered, 49 exact**, contact
error within drilled ground **median 0.066 · p90 0.115 · max 4.835 m**.

Diagnostics (all read-only, dev-DB-guarded, committed):

| script | what it answers |
|---|---|
| `scripts/eval_strat_fidelity.py` | THE acceptance gate; now prints a second within-drilled-ground line |
| `scripts/diag_voxel_label_columns.py` | per column: footprint / honor winner / label grid vs persisted mesh. **Its docstring carries the payload-capture recipe** |
| `scripts/diag_voxel_fidelity_delta.py` | controlled A/B on identical inputs |
| `scripts/diag_voxel_newly_covered.py` | honor contention + below-TD vs in-interval mismatches |
| `scripts/diag_voxel_footprint_variants.py` | footprint variants, timed |

Regenerating the frontend partition payload needs `STRIX_PARTITION_V2=1`; `tsx`
is not installed, so run `desktop/scripts/captureVoxelOracle.ts` through vitest
from a temporary spec **and delete that spec afterwards** — otherwise `npm test`
overwrites the committed v1 oracle on every run.

---

## TASK 1 — wire the enclosed-lens body merge (debt #243)

**Smallest, best understood, do it first.**

`MergeEnclosedLensBodies` is finished and correct but **has never run**: nothing
calls `POST .../bodies/merge-enclosed-lenses`. Verified against the real
S4/B4 pair — given their actual stacks `plan_enclosed_lens_merges` returns both
host halves tied to B4's continuous sand; only the upper tie exists in the DB
(the owner drew it by hand).

**Owner decision: fire it on BUILD, with a report** ("merged N enclosed lenses
across M sections").

**The ordering is not negotiable:**

```
merge (per section — the use case is section-scoped)
  → RELOAD the litho layers into the frontend
    → recompute the partition (regions carry body_id)
      → POST the build
```

Body identity is the connected components of the user-approved correlation-edge
graph (`ResolveLithoInstances`); the voxel build reads body identity from the
FRONTEND payload. Merging inside the build endpoint would leave the payload's
split ids disagreeing with the re-stamped picks, and the mesher would emit a
merged island inside two unmerged hosts — worse than not merging.

Insertion point: `desktop/.../hooks/useLithoSolids.ts` → `buildLithoSolids`,
BEFORE `voxelRequestBuilder()` is invoked (that callback closes over the litho
data). The refetch crosses into `useGeologicalModel`. **Wait for the reload;
do not simulate the post-merge state** — `memory/feedback_defer_until_loaded_not_predict`
records three commits burnt on exactly that mistake.

**Acceptance:** the lower-host tie exists in `litho_contact_correlation_edge`;
S4's two sand halves share one `body_id`; `eval_strat_fidelity` no worse.
This is a frontend change, so **owner dogfeed is required** — vitest and tsc do
not catch this class of bug.

---

## TASK 2 — the blend is section-based, not column-based ⚠ NEEDS DESIGN

**This is the one destroying the owner's confidence. Brainstorm before coding.**

### The evidence (reproduce it first)

On CS1, between `GEO-23/125-S9` and `GEO-23/125-S8`, the model puts
`SILT 1.2 → −1.1` inside a sand. Neither bracketing test has any silt there:

| test | sand interval |
|---|---|
| GEO-23/125-S9 | `ZAND 3.260 → −4.700` solid |
| GEO-23/125-S8 | `ZAND 3.200 → −4.450` solid |

The silt is imported from elsewhere. `label_voxels._stack_at_band` blends the two
nearest **sections**, and at that midpoint:

| section | perpendicular distance |
|---|---|
| a 2-column tie, `GEO-10/170-S4 ↔ GEO-23/125-S9` | **15.98 m** |
| CS1 (24 columns, includes both S9 and S8) | 17.43 m |

The tie is closer, so it takes ~52 % of the weight — and its far end,
`GEO-10/170-S4`, logs `SILT 3.140→2.260` and `SILT −3.141→−3.831` inside the
sand. That silt is ramped into a sand both CS1 neighbours call solid.

**So a slice along CS1, between two CS1 columns, is not showing CS1.** A
two-borehole tie section can outvote the section you are looking at.

Reproduce: sample the persisted solids every 2 m along the S9→S8 leg
(`_compute_model_stack` at interpolated `(x, y)`); the silt wedge enters at ~4 m
and thickens.

### The open question — ASK THE OWNER, do not choose

*Which neighbours should a point between two columns interpolate from?* Candidates,
none endorsed:

1. the two nearest **sections** (today);
2. the nearest **columns** (a Delaunay / natural-neighbour interpolation over the
   investigation cloud, ignoring section membership);
3. sections, but weighted so the section a point lies **between the columns of**
   dominates;
4. keep sections, but exclude a section whose contributing column is farther away
   than the bracketing columns.

Option 2 is the biggest change and arguably the most defensible geologically
(the ground does not know what a cross-section is), but it discards the
interpretive work the owner does ON sections — which is the entire product
premise. **That trade-off is his to make.**

---

## TASK 3 — lenses migrate vertically instead of holding their level ⚠ NEEDS DESIGN

Owner: *"of course lenses go horizontal not vertical."*

Sampling the same S9→S8 leg, the imported silt **climbs 4.5 m** as it crosses:

| distance | sand interval |
|---|---|
| 0–2 m | `ZAND 3.2 → −4.8` solid |
| 4 m | `ZAND 3.2/−1.6` · `SILT −1.6/−4.1` · `ZAND −4.1/−4.6` |
| 12 m | `ZAND 3.2/1.9` · `SILT 1.9/−0.8` · `ZAND −0.8/−4.6` |
| 18 m | `ZAND 3.2/2.9` · `SILT 2.9/0.4` · `ZAND 0.4/−4.6` |

**Mechanism** (`label_voxels._blend_stacks` + `_layout`): thicknesses are
interpolated and laid out cumulatively DOWNWARD from a blended top. A lens's
depth-within-the-package is interpolated; its stratigraphic level is not. As the
units above thicken and thin, the lens slides.

Likely the same rework as TASK 2 — but confirm before assuming, and ask the owner
what "holds its level" should mean when the two ends genuinely sit at different
elevations (absolute elevation? proportional position within the host? tied to
the host's top or its base?). That is a geological rule, not a coding choice.

---

## OPEN, NOT DIAGNOSED

* **Voids in the CS1 slice** around `GEO-10/170-S6` / `GEO-10/171-B6` /
  `1411-GEO-23/126-B4`. Those three sit within **4 m** of each other in world
  space but are nudged far apart on screen. Two hypotheses already tested and
  KILLED: the zigzag skip threshold is 1 mm (`ZIGZAG_MIN_SEG_M`), and
  `ModelFillOverlay` IS warp/spacing-aware. Current suspicion — the fill for
  those legs is squeezed into a near-zero along-range — is UNVERIFIED. Screenshot
  exists; ask the owner to re-share it.
* **Debt #242 — the model floor is shallower than the deepest tests.** Grid floor
  −13.190 mTAW (set by the 2-D partition), but `GEO-05/040-S2` and `-S3` drilled
  to −16.4. The bottom ~3.3 m of two CPTs is absent. Deferred: extending the grid
  below the partition would grow isolated columns with nothing beside them.
* **False precision on borehole litho contacts.** Accepted contacts sit at 0.481 /
  1.532 / 3.747 where the driller's log says 0.5 / 1.5 / 3.8, and the field log is
  on a 0.5 m grid. Something downstream is placing contacts to the millimetre.
  Not the 3-D builder.

## Settled today — do not re-litigate

* **The footprint fix** (`d3b6c1fd0`..`99c6e023f`): the footprint was framed from
  section columns' PROJECTED FEET while the builder honors logs at TRUE positions
  (0.5–64.9 m apart). Fixed; covered 49→58/58, exact 41→49.
* **Honor precedence** (`3ea43f734`..`b021e2982`): at a shared voxel column —
  has-a-log, then **CPT over borehole**, then deepest, then id. The owner's first
  instinct ("borehole always wins") was reversed on measurement: driller's logs
  are on a 0.5 m grid, the CPT resolves 3–4× more contacts, collars agree to
  2–6 cm. Rationale in debt #241.
* **The gate's `max` contact error is not a usable signal.** The pairing walk runs
  past the drilled bottom and matches the substrate; that inflates max to 15.7 m
  and p90 to 0.42 m. Within drilled ground it is p90 0.115 m. Both lines print.
* **`9635`'s 4.835 m is not a displacement.** Comparing the sand PACKAGE base
  (owner's framing) gives **0.05 m**; the model there shows S4's log because S4
  wins the shared column, and S4 splits B4's one thick sand with a silt lens.
