# Body pinch-out detector redesign — membership-driven caps

**Date:** 2026-06-06
**Status:** design / awaiting owner review
**Owner directive in this session:** Option **A** — the explicit *Detect* verb
bulk-applies halfway/open pinch-out caps via the membership classifier; the user
adjusts later with the freedraw boundary editor; the old `to_target` bilateral
detector is retired.

---

## 1. Context — why this exists

The same-lithology correlation guard (`correlate_litho_contacts.py`, commit
`46b2bac1`, 2026-06-05) rejects cross-lithology correlation edges (the
"black diagonal" stray-ribbon bug). That guard broke the **old body-extent
detector** (`detect_body_extents` / `DetectBodies`): its `to_target` bilateral
mechanism requires **both** of a body's bounding contacts to correlate to one
common target, but a body's top contact (the body's lithology, e.g. KLEI) and
its base contact (the layer below, e.g. ZAND) are different lithologies — so the
guard forbids the edge the detector depends on. The mechanism produces nothing in
production today, and where it did fire it drew the body **all the way to the
adjacent test**, implying the lithology is present there — which it is not.

Five integration tests exercise only this obsolete mechanism and fail
deterministically (they pre-date this work; the guard landed without updating
them):

- `test_detect_bodies.py::test_bilateral_gesture_materialises_body_with_extents`
- `test_detect_bodies.py::test_detect_closes_to_nearest_target_on_active_section`
- `test_detect_bodies.py::test_uncorrelate_removes_body_when_topology_breaks`
- `test_detect_bodies.py::test_provenance_rule_user_claimed_extent_is_preserved`
- `test_bodies_api.py::test_detect_rematerialises_bodies_after_clear_all`

## 2. Core problem / who / success / non-goals

- **Core problem.** A body whose lithology is *absent* at a neighbour must
  **pinch out part-way toward that neighbour, never draw to it** — and the only
  detector that writes the body's lateral caps is broken by, and conceptually at
  odds with, the same-lithology rule.
- **Who.** The geotechnical engineer building a cross-section: correlates
  same-lithology contacts into bodies, then wants each body's lateral terminations
  drawn correctly (pinch / open / band) without hand-drawing every one, and
  freedraw-adjustable where the auto guess is wrong.
- **Success.** Clicking *Detect* on a section produces, for every body, a
  geologically honest lateral cap on each side — **PINCH** (halfway toward the
  nearest neighbour where the lithology does not continue), **OPEN** (section
  edge / substrate), or **BAND** (no cap, lithology continues) — using only the
  already-validated membership logic, needing no cross-lithology edge. The five
  tests pass against the new topology. The engineer can freedraw any cap.
- **Non-goals.**
  - Cross-lithology correlation (stays forbidden — the guard is correct).
  - `to_target` "draw to the neighbour" geometry (retired).
  - Lenses-in-lenses (a different-lithology sub-body inside a body) — Phase 5.
  - Automatically firing detection on every correlate gesture (violates the
    2026-05-31 "detection is an explicit verb, no side-effects on the gesture"
    directive).

## 3. What already exists (do not rebuild)

| Lane | Component | State |
|---|---|---|
| ① Bands | `ResolveLithoInstances` → one `BodyOrm` per same-lithology connected component, stamps `litho_layer.body_id`; `BodyBandOverlay` fills it | **works** |
| ② Caps (interactive) | `SuggestBodyPinchOuts` → membership classifier (BAND / PINCH `pinch_out_halfway` / OPEN), ghost candidates; `ClaimBodyExtent` (`provenance=user`); `body_boundary_nodes` freedraw editor; `BodyExtentOverlay` renders pinch/open | **works, validated 100% on `test.strix` CS3** |
| ③ Caps (auto) | `detect_body_extents` / `DetectBodies` `to_target` bilateral detector + `BODY_MAX_THICKNESS_DEFAULT_M` degeneracy guard + "Lens max thickness" Setting | **broken / vestigial — retire** |

The membership classifier in lane ② is the validated truth. The redesign extracts
it as a shared domain service and points lane ③'s explicit *Detect* verb at it,
then deletes the `to_target` machinery.

## 4. Design

### 4.1 Shared membership classifier (domain)

Extract the per-side classification currently inlined in `SuggestBodyPinchOuts`
into a pure domain service, e.g. `domain/services/classify_body_extents.py`:

```
classify_body_extents(
    stacks,                       # per-investigation depth-sorted contact stacks
    body_id_by_layer,             # litho_layer.id -> body_id (resolver stamp)
    along_positions,              # investigation_id -> along-section distance
    bottom_depth_by_inv,          # investigation_id -> hole bottom depth
) -> list[BodyExtentClassification]
```

Each result names a `(body_id, source_investigation_id, above_contact_id,
below_contact_id | below_depth_m, side, kind, neighbour_investigation_id | None)`
where `kind ∈ {pinch_out_halfway, open}` or **band** (omitted — no cap). The rule
is the current, validated one (membership continuity along the section):

- **BAND** (no cap): the body has a member further along this side (the
  correlation chain continues — including across a skipped column).
- **OPEN**: no neighbour on this side (section's first/last *visible* column), OR
  the bottom substrate (deepest unit, no base contact) wherever it does not
  continue. The substrate never pinches.
- **PINCH** (`pinch_out_halfway`): an interior unit whose body terminates here and
  a neighbour exists to pinch toward; tapers to a point at the **midpoint** in
  along-distance between the source and the nearest neighbour.

Both `SuggestBodyPinchOuts` (ephemeral ghosts) and the *Detect* verb consume this
one service — single source of truth, eliminating the lane-②/lane-③ divergence.

### 4.2 Geometry — halfway pinch

`pinch_out_halfway` tapers to a point at the **midpoint** between the source and
the nearest neighbour, in section along-distance (spacing-relative; honours the
column-spacing warp on render — see the section-geometry rule). The wedge's tip is
zero-thickness **by definition** (a pinch-out converges to a point); the body
itself is never zero-thickness (see §6). The user freedraws the wedge shape via
the existing `body_boundary_nodes` editor.

### 4.3 The Detect verb commits `provenance=auto` caps

The explicit *Detect* verb (the `DetectBodies` use case, repurposed) does a full
reconcile against current geometry:

1. Run the shared classifier.
2. For each classified PINCH/OPEN side whose body's current `extent_<side>_provenance`
   is `auto` or null → write/update the cap (`kind`, `neighbour_inv_id`,
   `provenance=auto`).
3. For each side the classifier says is **BAND** but the body currently carries an
   `auto` cap → clear it.
4. **Never** touch a side whose `provenance=user` (a freedraw / explicit claim).

It is **explicit-only**: caps are created/updated/cleared **only** when the user
runs *Detect*. Restore / startup / a single correlate gesture do **not** create or
recompute caps (they run `ResolveLithoInstances` for bands only). Persisted caps
survive restore as stored; the user re-runs *Detect* to refresh after refining.
This honours the 2026-05-31 explicit-verb directive.

`SuggestBodyPinchOuts` (the ghost-preview + per-cap `ClaimBodyExtent`) stays for
interactive fine control. **Open question (see §10.1):** keep both verbs, or fold
"Suggest" into a preview of what "Detect" will commit? Recommend keeping both
(Detect = bulk auto, Suggest = interactive); confirm in review.

### 4.4 Retire `to_target` and the max-thickness guard

- Delete `detect_body_extents.py` (the bilateral `to_target` algorithm) and the
  `to_target` write/reconcile branch of `DetectBodies`.
- Remove `EXTENT_KIND_TO_TARGET` from the active kind set
  (`EXTENT_KIND_VALUES`, `ExtentKind`), the renderer dispatch, and any UI. Keep a
  one-line legacy note for the migration path.
- Retire `BODY_MAX_THICKNESS_DEFAULT_M` + `_resolve_max_thickness` + the
  "Lens max thickness" Settings row (`view_state.litho_segmenter.max_lens_thickness_m`).
  It guarded lane ③'s loose-framing degeneracy; under membership a body is a real
  resolved unit, so a thick body is legitimate, not spurious. **Confirm in review.**

## 5. Provenance & mutability — "adding tests later / refining the model"

The model is mutable; caps are a continuously-reconciled projection, not a one-shot.

- **`provenance=auto`** caps: recomputed in full on every *Detect* run. A new
  nearer test (changes the nearest neighbour), a removed test, or a re-correlation
  that turns BAND↔PINCH is reflected the next time the user clicks *Detect*.
- **`provenance=user`** caps (freedraw / explicit claim): **never** auto-overwritten
  or cleared. When topology change invalidates one — its neighbour is no longer the
  nearest (a closer test was added), or its body merged/split under
  re-correlation — the cap is **preserved but flagged stale** (amber re-confirm),
  the same mark-stale pattern as litho↔geo coupling. It is not silently moved
  (wrong geometry) nor silently dropped (lost intent).
- **Body merge/split reconcile.** `ResolveLithoInstances` re-components bodies on
  re-correlation, changing `body_id`. A `provenance=user` cap tied to a now-merged
  or split body must be re-attached to the surviving body where unambiguous, else
  flagged stale. This is open debt **#195** ("user-claimed extents lost when the
  instance renumbers"). **Scope decision (review):** this spec specifies the
  *flag-stale-on-invalidation* behaviour; the full unambiguous-reattach reconcile
  is bounded against #195 and may land as a follow-up if it proves large.

## 6. Edge cases (confirmed with owner 2026-06-06)

| Case | Handling |
|---|---|
| Top layer | Normal unit — pinches / bands / opens like any interior unit. |
| Bottom layer (substrate) | **OPEN** where it doesn't continue; never pinches (unknown below). |
| Stacked lenses | Each unit classified independently per side; **per-instance** body identity keeps same-lithology lenses separate. |
| One-sided pinch-out | BAND one side / PINCH the other — the case the old bilateral detector dropped; membership fixes it. |
| Skip-column continuation | A member further along (even past a column with no member) → **BAND**, don't pinch (the CS3 fix). |
| Single-column lens | PINCH both sides, or OPEN at section edges — the classic lens. |
| Bare / unsegmented neighbour | PINCH **toward** it; do not treat it as the section edge. |
| Excluded / off-section neighbours | Ignored in adjacency; detection is section-scoped — one section's caps never clobber another's. |
| **Min / zero-thickness body** | **N/A — retracted.** Min thickness is enforced at the litho-layer level (422; FE 0.01 m / BE 0.001 m); a body inherits it. No body-level guard. The wedge tip's zero thickness is the pinch by definition. |
| Legacy `to_target` in old bundles | `provenance=auto` → recomputed to pinch/open on next *Detect*; `provenance=user` was never `to_target`, so nothing is lost. |
| Lenses-in-lenses (diff-litho sub-body) | **Out of scope** (Phase 5). |

## 7. Format / data changes

Backwards compatibility is **suspended pre-ship** (owner directive 2026-05-16), so
a clean break is allowed:

- `body` rows: `extent_<side>_kind` no longer takes `to_target`; the
  `extent_<side>_target_contact_id` column becomes unused for new writes (kept
  nullable; may be dropped in a later migration). No new columns needed
  (`provenance`, `neighbour_inv_id`, boundary nodes already exist).
- `.strix` bundle v4: no version bump; legacy `to_target` auto extents are
  reconciled on the next *Detect* (not on restore).
- Settings: remove the "Lens max thickness" row (pending §4.4 confirmation).

## 8. Test plan (TDD)

Rewrite the 5 failing tests to the membership topology (same-lithology
correlations only; no cross-litho edge), then add edge-case coverage. Each test's
comment is phrased in the **behaviour's** vocabulary (pinch/band/open), not the
implementation's.

- **T1** one-sided pinch-out: clay present at source + left neighbour, absent at
  right → left BAND (no cap), right PINCH halfway. *(The case the old detector
  dropped — the headline fix.)*
- **T2** bilateral lens: clay only at source → PINCH both sides.
- **T3** substrate → OPEN, never pinch.
- **T4** section edge → OPEN.
- **T5** skip-column continuation → BAND (no pinch).
- **T6** bare-column neighbour → PINCH toward it (not OPEN).
- **T7** stacked same-lithology lenses → distinct per-instance bodies, each pinches
  independently.
- **T8** provenance: `user` cap preserved across a *Detect* run; `auto` cap
  recomputed; BAND side clears a stale `auto` cap.
- **T9** stale-flag: a `user` cap whose nearest neighbour changed (new test) is
  preserved + flagged stale, not moved.
- **T10** `test_bodies_api` detect-after-clear: rematerialises bodies + caps via the
  membership classifier.

Plus the shared classifier gets pure-domain unit tests (no DB) for the band/pinch/
open decision across the same matrix.

## 9. Build sequence (for the plan)

1. Extract `classify_body_extents` domain service; unit-test it; repoint
   `SuggestBodyPinchOuts` at it (behaviour-preserving).
2. Repurpose `DetectBodies` to commit `provenance=auto` caps via the service;
   delete `detect_body_extents` + the `to_target` branch + max-thickness guard.
3. Remove `DetectBodies` from the restore/startup sweep (resolver-only there).
4. Retire `EXTENT_KIND_TO_TARGET` + the "Lens max thickness" Setting; legacy
   migration note.
5. Stale-flag for invalidated `user` caps (mark-stale; #195 reconcile bounded).
6. Rewrite the 5 tests + add T1–T10 + classifier unit tests.
7. Frontend: confirm the *Detect* verb wiring commits + `BodyExtentOverlay`
   renders auto caps; add the stale indicator.

## 10. Open questions for owner review

1. **Verb taxonomy** (§4.3): keep both *Detect* (bulk auto) and *Suggest pinch-outs*
   (interactive), or consolidate?
2. **Max-thickness guard + Setting** (§4.4): retire (recommended) or keep the knob?
3. **#195 scope** (§5): ship flag-stale-on-invalidation now; defer full merge/split
   reattach — acceptable, or do the full reconcile in this piece?
4. **Restore/startup** (§4.3): caps explicitly *not* recomputed on open (only on the
   *Detect* verb) — confirm that matches your mental model (open a project, bodies
   show last-detected caps until you re-Detect).
