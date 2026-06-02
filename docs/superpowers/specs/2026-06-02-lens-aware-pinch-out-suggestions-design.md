# Lens-Aware Pinch-Out Suggestions — Design Spec

**Status:** Approved for implementation (2026-06-02).
**Author:** Claude + Robin (dogfeed brainstorm).
**Related:** `docs/superpowers/specs/2026-05-31-body-with-extent-design.md`
(the body/extent model this refines); `SuggestBodyPinchOuts`
(`src/groundmodel/application/suggest_body_pinch_outs.py`); the litho
find-or-create key in `AcceptLithoSuggestions`.

---

## 1. Problem

Dogfeed 2026-06-02: on a test with a **sand → silt → sand** stack, the
"Suggest pinch-outs" verb produced three pinch-out ghosts — one for the
upper sand, one for the silt, one for the lower sand. Only the silt ghost
is correct.

Geologically this is **one continuous sand body with a silt lens inside
it**. The silt is the thing that pinches out (present at this test, absent
toward the neighbour); the sand is continuous and ties into the sand body
on the adjacent test. Suggesting the two sand halves pinch out is wrong —
they are not two bodies, they are the upper and lower parts of one host
that wraps the lens.

### Root cause

`SuggestBodyPinchOuts` walks each investigation's depth-sorted contact
stack and emits a pinch-out candidate for **every adjacent contact pair**
that lacks an approved correlation on a side. It has no concept of a
*lens-in-host sandwich*, so a single sand interrupted by a thin silt
becomes three independent "bodies", and the two sand halves each get a
spurious ghost.

---

## 2. Key insight — the host is already one formation

The litho find-or-create key in `AcceptLithoSuggestions` is
`(parent geo formation, litho_main_soil_code, canonical_admixture_signature)`.
So two clean-sand intervals at the same test, split by a silt lens,
**resolve to the same `formation_id` row** — the sand is literally *one
formation that appears twice in the depth column*, interrupted by the
silt (a different `formation_id`).

Two consequences shape this design:

1. **Continuity is emergent, not a new primitive.** "One body" already
   falls out of the data: same composition → one formation → one
   connected component in `resolve_litho_instances` → one body. We do
   **not** add a "mark as continuous body" flag. An area-covering layer
   (e.g. the Tertiary clay) becomes one body the moment its contacts
   share one formation and correlate across the tests. Adding a parallel
   "continuous" primitive would duplicate and drift from this. (Aligns
   with the repo rule "never design a layer you haven't needed yet".)

2. **Lens detection can be exact, not heuristic.** A unit is an enclosed
   lens when the formation *directly above* equals the formation *directly
   below* it (same `formation_id`) and differs from the unit itself. No
   lithology-string fuzziness, no admixture guessing.

---

## 3. Decisions captured during brainstorming

1. **Scope** — *Option 2: lens-aware suggestions.* The suggester
   recognises the sandwich, suggests the enclosed lens, and treats the
   surrounding host as one continuous body (suppresses the host-half
   ghosts). Chosen over Option 1 (blind suppression — leaves no lens
   framing) and Option 3 (auto-correlate the host — re-opens the
   auto-correlate spaghetti history and over-automates a judgement call).

2. **Detection identity** — *(a) exact same-formation bracket only.*
   Host halves are collapsed only when they are the **same formation**
   (same parent + lithology + admixture signature). Same-lithology /
   different-admixture units (clean ZAND over silty ZAND) are *not*
   treated as one host — they stay separate suggestions. **Rationale
   (owner directive 2026-06-02):** the engineer subdivides on admixture;
   admixture is part of formation identity, so exact-formation matching
   is precisely what preserves that subdivision. Option (b)
   (lithology-code match) is foreclosed permanently.

3. **Continuity** — *emergent from correlations + formation identity.*
   No separate "continuous body" primitive (see §2).

4. **Body-level admixture editing** — *out of scope here; separate slice
   tied to the geotech stage.* The geotech stage will need the ability to
   add/edit admixtures on a body after the fact. Today admixtures are set
   only at creation (find-or-create key); the formation PATCH does not
   accept them; `PropagateLithoAdmixtures` already writes admixtures
   across a correlated body (connected component) but is not exposed as a
   user-driven edit gesture, and it mutates composition in place (which
   makes the original find-or-create key stale). Because composition *is*
   identity, post-hoc editing is its own data-model decision (re-bucket vs
   in-place mutate) and is specced separately. It does not couple to this
   fix.

---

## 4. Detection rule

Work on one investigation's depth-sorted contact stack. The stack is a
list of contacts (tops), ascending by `depth_top_m`. A **unit** `i` is the
interval between `entries[i]` (its top contact) and `entries[i+1]` (its
base contact); `formation(i) = entries[i].formation_id`. Units run
`0 .. U-1` where `U = len(entries) - 1`. The deepest formation (last
contact, no base contact below it) is **not** a unit — it is never framed
as a body.

**Unit `i` is an enclosed lens** iff:

```
1 <= i <= U-2                                  # has a unit above AND below
AND entries[i-1].formation_id == entries[i+1].formation_id   # same host both sides
AND entries[i-1].formation_id != entries[i].formation_id     # the lens differs
```

**Unit `j` is a host-half** iff it is the bracketing unit of some enclosed
lens — i.e. there exists an enclosed lens at `j+1` or `j-1` and
`formation(j)` equals that lens's bracket formation. (For a lens at `i`,
the host-halves are units `i-1` and `i+1`.)

Worked stacks:

| Stack (top→bottom) | Lens units | Host-half units |
|---|---|---|
| sand · silt · sand · clay | silt (1) | upper-sand (0), lower-sand (2) |
| sand · silt · sand · silt · sand | both silts (1,3) | all three sands (0,2,4) |
| sand · silt · sand · silt · clay | first silt (1) | sands 0,2 |
| clay · sand · clay (terminal clay has no base) | sand (1) | upper-clay (0) only* |

\* the deepest clay has only a top contact, so it is never framed as a
unit — it cannot be a host-half or a lens. The bracket test still fires on
the unit pair that *does* exist; see Edge cases §6.

The rule is a **pure function** of the formation-id sequence on the stack.
It lives in a new `domain/services/` helper,
`classify_enclosed_lenses(formation_ids: list[UUID]) ->
EnclosedLensClassification`, returning `lens_units: set[int]` and
`host_half_units: set[int]` (no DB, no logging) so it is unit-testable in
isolation and reusable by the detector later if wanted. The suggester
consumes only `host_half_units`; tests assert both.

---

## 5. Algorithm change

The change to `SuggestBodyPinchOuts.execute` is surgical: **suppress
pinch-out candidates for host-half units; everything else is unchanged.**

Lens units already get suggested by the existing per-pair logic (they are
uncorrelated → a candidate is emitted on each unpaired side). Normal units
(both neighbours present but not a same-formation bracket) are unchanged.
So the *only* edit is: classify the stack, and `continue` past host-half
units in the emit loop.

```
for inv_id, entries in stacks.items():
    if inv_id not in position:
        continue
    src_pos = position[inv_id]

    # NEW: classify this investigation's stack once.
    host_half_units = classify_enclosed_lenses(
        [e.formation_id for e in entries]   # pure domain helper
    ).host_half_units

    for i in range(len(entries) - 1):
        if i in host_half_units:
            # Interior to a continuous host that wraps a lens — the host
            # is presumptively continuous here, not a pinch-out. Skip.
            continue
        # ... existing left/right candidate emission, unchanged ...
```

Result on the screenshot stack: the silt lens emits its candidate(s); the
upper and lower sand emit nothing. The sand is left to be correlated
normally (or recognised continuous), exactly as the user wants: *one sand
layer, one pinched-out silt lens.*

### Why suppress the host entirely (not re-frame it as one outer body)

When a formation brackets a lens at an investigation, it is *wrapping* the
lens — that is strong local evidence it is continuous there, not
terminating. So at this investigation we suppress its pinch-out suggestion
outright. If that same formation genuinely pinches out at a *different*
investigation (where it does not bracket a lens), the normal per-pair
logic still evaluates it there. Suppression is local to the bracket.

No body re-framing is needed: the suggester only emits *candidates*, and
host-halves emit none, so their body identity / extent bookkeeping is
irrelevant to the output.

---

## 6. Edge cases

1. **Deepest formation, "only a top" (Tertiary clay).** Has a top contact
   but no base contact, so it is never framed as a unit (the loop pairs
   adjacent contacts; the deepest top is never the upper member of a
   pair). Never suggested to pinch out, never a host-half, never a lens.
   Inherently safe.

2. **Shallowest layer, "only a bottom".** If its top is the ground surface
   (no stored contact), it is likewise never framed as a unit. Safe. If a
   surface contact does exist, it is a normal interior unit and follows
   normal logic.

3. **Lens needs both neighbours.** Any unit at either end of the stack can
   never satisfy the bracket test (`1 <= i <= U-2`), so terminal units are
   never misread as lenses. This is the structural reason both ends are
   safe.

4. **Continuous interior layer (not a lens).** A unit with both neighbours
   present but *different* formations above/below is **not** a lens and is
   **not** suppressed — it still surfaces as a generic pinch-out candidate
   until correlated. This is intended suggest-don't-commit behaviour
   (surfacing genuine wedge candidates), not a regression. Owner directive
   2026-06-02: keep these surfaced; do not make the verb lens-only.

5. **Stacked lenses (sand·silt·sand·silt·sand).** All same-formation sand
   units are host-halves and suppressed; every enclosed silt emits. The
   pure helper handles the run by classifying each unit independently.

6. **Three identical formations in a row.** Cannot occur in a clean
   contact model (adjacent same-formation intervals are one contact). The
   `!=` guard makes it a no-op anyway (a unit equal to its own bracket is
   not a lens).

7. **Lens present only at the edge test.** The enclosed lens emits on each
   *unpaired* side via existing logic — interior side → `pinch_out_halfway`
   toward the nearest neighbour; section-edge side → `open`. Unchanged
   from current behaviour; the lens taper is correct.

---

## 7. What stays out of scope

* **Body-level admixture editing** — separate slice, tied to the geotech
  stage (see Decision §3.4).
* **Auto-correlating the host across investigations** — that is the
  auto-correlate surface, with its own adjacency/spaghetti history (#163);
  not bundled here.
* **Lens-only suggester** — keeping generic wedge candidates surfaced
  (Edge case §6.4).
* **Detector (`detect_body_extents`) changes** — the bilateral detector
  builds bodies from approved correlation edges, a separate concern. The
  new helper is written so the detector *could* consume it later, but no
  detector change ships here.

---

## 8. Testing strategy

### 8.1 Domain unit tests (`tests/unit/domain/services/`)

New `test_classify_enclosed_lenses.py` for the pure classifier (asserting
both `lens_units` and `host_half_units`):

* sand·silt·sand·clay → host-halves = {0, 2}; lens at 1.
* sand·silt·sand·silt·sand → host-halves = {0, 2, 4}; lenses at {1, 3}.
* sand·silt·sand·silt·clay → host-half = {0, 2}; lens at {1} only (lower
  silt is bracketed by different formations).
* No lens (clay·sand·silt) → host-halves = {} (all distinct neighbours).
* Single unit / two units → no lens possible (terminal-only).
* Same-formation bracket but *different admixture signature* would be
  different `formation_id`s upstream → not a lens (asserted at the
  formation-id level: distinct ids → no bracket match).
* Determinism: same input → same output.

### 8.2 Use-case integration test (`tests/integration/application/`)

Extend `test_suggest_body_pinch_outs.py`:

* **Lens sandwich:** seed a litho model where one investigation has
  sand·silt·sand (the two sands sharing one `formation_id`, silt a
  different one). Run `SuggestBodyPinchOuts`. Assert: a candidate is
  emitted for the silt unit; **no** candidate is emitted for either sand
  half.
* **Regression — non-lens stack unchanged:** an investigation with
  distinct formations (clay·sand·clay-different-parent) still emits the
  expected candidates.
* **Terminal safety:** the deepest formation emits no candidate
  (pre-existing behaviour, pinned).
* No persistence side effects (the verb is read-only — re-assert).

### 8.3 e2e (Playwright, optional in this slice)

If cheap: extend `flow_body_suggest_pinch_outs.spec.ts` with a fixture
investigation carrying a sand·silt·sand stack and assert only one ghost
appears over that column. Defer if the synthetic fixture does not already
carry a lens stack (fixture authoring is the cost, not the assertion).

---

## 9. Ship phasing

| # | Slice | Green-gate |
|---|---|---|
| 1 | **Pure detection helper + unit tests** | `classify_enclosed_lenses` in `domain/services/`; unit tests for every stack shape in §8.1 pass. |
| 2 | **Wire into `SuggestBodyPinchOuts`** | The `host_half_units` classification + `continue` skip; integration tests in §8.2 pass; existing suite green. |
| 3 | **Dogfeed + docs** | Manual confirm on the screenshot project: sand·silt·sand → one silt ghost, no sand ghosts. Update CLAUDE.md / debt if the pattern shifts. e2e fixture extension only if cheap (§8.3). |

Total: small — one pure helper, one `continue` in the existing loop, two
test surfaces. No schema change, no API change, no migration.

---

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Two sand halves do *not* actually share a `formation_id` (e.g. straddle-split assigned different parents, or admixtures differ) → no suppression. | Correct by design — different formations are genuinely different units and *should* stay separate suggestions (Decision §3.2). The screenshot case (clean sand both sides, one geology parent) shares a formation, so it is suppressed. |
| Helper misclassifies at stack ends. | The `1 <= i <= U-2` bound is unit-tested for 1- and 2-unit stacks; terminal units provably cannot be lenses (§6.3). |
| Suppressing the host hides a genuine host pinch-out at the bracket test. | Acceptable: a formation that wraps a lens is presumptively continuous *there*; it is still evaluated at non-bracket investigations. Owner-accepted trade-off. |
| Scope creep into admixture editing / auto-correlate. | Both explicitly fenced out (§7) and tracked separately. |

---

*End of design.*
