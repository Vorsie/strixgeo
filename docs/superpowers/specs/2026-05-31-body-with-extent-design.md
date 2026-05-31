# Body-with-Extent — Design Spec

**Status:** Approved for implementation (2026-05-31).
**Author:** Claude + Robin (dogfeed brainstorm).
**Supersedes:** the unilateral `LithoLensOrm` model (lens = three-contact pinch).
**Related:** Phase-4 v1.0 MVP litho stage; Phase-5 sedimentological-features carve-out
in `CLAUDE.md`; this morning's bilateral-closure tightening + preserve-named guard
+ startup lens sweep (the immediate precursor work).

---

## 1. Problem

Today's `LithoLensOrm` carries `content_key = (above_id, below_id, target_id)` — three
contact ids encoding ONE pinch-out side of a body. The data model conflates
**body identity** with **body closure**:

* A body with two-sided pinch-out closure (the geological lens proper) needs two
  targets, not one. The bilateral detector we shipped this morning picks the
  smallest-UUID target as primary and discards the other from persistence — the
  shape editor can only ever author one side's boundary.
* A body that pinches out into mid-section space (e.g. a thin sand lens that
  fades out before reaching the next CPT) has **no target contact at all**. The
  current schema can't represent it. The user has been blocked from showing
  this case to coworkers (owner dogfeed 2026-05-31: *"i can't show it to my
  coworkers like this"*).
* Future Phase-5 work — sedimentological interfingering, dip-extrapolated
  pinch-outs, geological-model body extents — all want some notion of "what
  happens at the lateral edge of this body". The current `LithoLensOrm` is
  silent on every kind of closure except the one it was built for.

The product's core data primitive needs to separate *body identity* from
*body closure*, and represent closure as one of several explicit *extent kinds*
per side.

---

## 2. Goals & non-goals

**Goals:**

1. **One data primitive** that covers: detected bilateral lenses, user-claimed
   halfway pinch-outs, named bodies, and future Phase-5 closures
   (extrapolated, open-ended). Body identity is `(model, formation, body_ordinal)`;
   each body has two optional extent markers (left, right).
2. **Automatic but adaptable.** Bilateral closures auto-materialise as today
   (zero user input). Pinch-out bodies are suggested by a dedicated verb but
   require a user click to commit (matches the codebase's
   suggest-don't-commit pattern). Once committed, the user can adapt the
   boundary shape with the existing node-drag editor.
3. **Provenance-safe.** The auto-detector NEVER overwrites a user-claimed
   extent. Reconcile sweeps NEVER delete user-claimed or named bodies. The
   user keeps explicit control over their interpretation.
4. **Forward-compatible with Phase 5.** The extent-kind enum has slots for
   `'extrapolated'` and `'open'`. Geological-model body rendering reuses the
   same schema (model-kind agnostic). Per-side boundary shape editing fits as
   an additive extension when needed.
5. **Backward-clean rename.** Pre-ship backwards-compat is suspended (per
   `memory/project_backwards_compat_suspended.md`); we rename `LithoLensOrm`
   to `BodyOrm` and migrate existing data forward in one Alembic revision.

**Non-goals (explicitly out of scope for this build):**

* `extent_kind = 'extrapolated'` (absorbing the existing `ExtrapolatePinchOut`
  tool into the body model) — schema supports it; no implementation in this
  build. Phase 5.
* `extent_kind = 'open'` (explicit "extends to section boundary") — schema
  supports it; default render stays "nothing extra" (Section 6 below).
  Phase 5.
* Geological-model body rendering — schema is kind-agnostic, but the renderer
  in this build only wires the litho path. Geological bodies are Phase 5.
* Per-side boundary shape editing — one polyline per body across both sides;
  separate per-side shape storage stays Phase 5+.

---

## 3. Decisions captured during brainstorming

The five non-obvious decisions, with the user's chosen option in **bold**:

1. **Refactor scope** — *"Above + extend to geological models too"* (comprehensive).
   The data model is model-kind-agnostic; renderer ships the litho path only.
2. **Schema shape** — *"Denormalized — columns on the body row"* (one row per body,
   no JOINs to read extents).
3. **Default render for unclaimed bodies** — *"Nothing extra — just the column band"*.
   Reserve wedges for explicit claims (detected or user). Auto-suggest surfaces
   candidates only when the user invokes the verb.
4. **Auto-suggest trigger** — *"Separate 'Suggest pinch-outs' verb"*. Keeps the
   verb-to-action mapping clean: Detect bodies = auto bilateral materialise;
   Suggest pinch-outs = surface candidates.
5. **Architectural approach** — *"A — rename + extend in place"*. Rename
   `LithoLensOrm → BodyOrm` and migrate the table once. Pre-ship compat
   amnesty applies.

---

## 4. Data model

### 4.1 Table rename (DB + ORM in lockstep)

| Today | New |
|---|---|
| `litho_lens` table → `LithoLensOrm` | `body` table → `BodyOrm` |
| `litho_lens_shape` table → `LithoLensShapeOrm` | `body_boundary_shape` table → `BodyBoundaryShapeOrm` |
| `litho_lens_boundary_node` table → `LithoLensBoundaryNodeOrm` | `body_boundary_node` table → `BodyBoundaryNodeOrm` |

### 4.2 `body` table schema

```text
id                              UUID PK
app_project_id                  UUID FK project (CASCADE)
model_id                        UUID FK geological_model (CASCADE)
formation_id                    UUID FK geological_formation (CASCADE)
body_ordinal                    INT  (mirrors formation.instance_ordinal;
                                      kept for query convenience)
source_investigation_id         UUID NOT NULL — the investigation carrying
                                      the body's framing contacts. NEW column.
                                      Polymorphic id (refs cpt.id OR borehole.id);
                                      no FK constraint (mirrors the existing
                                      formation_contact.borehole_id / cpt_id
                                      pattern). Cascade on CPT/borehole delete
                                      handled at use-case layer, not via FK.
                                      Lets the renderer find the body's main
                                      span in O(1) without re-resolving.
name                            VARCHAR(120) NULL  (preserve-named guard)
primary_section_id              UUID NULL FK cross_section (SET NULL)

extent_left_kind                VARCHAR(32) NULL  enum (see 4.3)
extent_left_target_contact_id   UUID NULL FK formation_contact (CASCADE)
extent_left_neighbour_inv_id    UUID NULL

extent_right_kind               VARCHAR(32) NULL  enum (see 4.3)
extent_right_target_contact_id  UUID NULL FK formation_contact (CASCADE)
extent_right_neighbour_inv_id   UUID NULL

created_at, updated_at          (existing; server defaults preserved)

UNIQUE (model_id, formation_id, body_ordinal)
INDEX (app_project_id, model_id)
```

**Dropped column:** `content_key`. Body identity is the explicit
`(model_id, formation_id, body_ordinal)` triple. Shape rows join via direct
`body_id` FK instead of the `(model, content_key)` lookup.

### 4.3 `extent_kind` enum

| Value | Semantics | Population in this build |
|---|---|---|
| `'to_target'` | Closure at a specific target contact (auto-detected bilateral). | Detector populates `target_contact_id`. |
| `'pinch_out_halfway'` | Terminates halfway to the named neighbour investigation. | User claim populates `neighbour_inv_id`. |
| `'extrapolated'` | Dip-extrapolation closure (absorbs `ExtrapolatePinchOut`). | **Phase 5** — schema reserved. |
| `'open'` | Explicitly extends to section boundary. | **Phase 5** — schema reserved. |
| `NULL` | No claim. Default state. Renderer shows nothing on that side. | Default for both sides on new rows. |

### 4.4 `body_boundary_shape` / `body_boundary_node` schema

Existing tables minus the `(model_id, content_key)` key, plus a direct
`body_id` FK to `body`. Boundary nodes are model-of-the-body — one polyline
per upper edge + one per lower edge, with control nodes anywhere along the
body's full width (when both sides are claimed, the polyline spans the entire
body; when only one side is claimed, it spans source → claimed extent).

```text
body_boundary_shape:
  id                UUID PK
  body_id           UUID FK body (CASCADE)         -- replaces (model,content_key) key
  model_id          UUID FK geological_model (CASCADE) -- denormalised for query scope
  render_style      VARCHAR(16) NOT NULL  enum (straight|blocky|rounded)
  UNIQUE (body_id)

body_boundary_node:
  id          UUID PK
  shape_id    UUID FK body_boundary_shape (CASCADE)
  boundary    VARCHAR(8) NOT NULL  enum (upper|lower)
  node_index  INT NOT NULL
  along_m     FLOAT NOT NULL
  elevation_m FLOAT NOT NULL
  UNIQUE (shape_id, boundary, node_index)   -- existing constraint, preserved
```

### 4.5 Migration (single Alembic revision)

The revision is forward-only (downgrade body of the data fill is not
meaningful; pre-ship amnesty applies). Steps in order:

1. Add new columns to `litho_lens` (all nullable, default NULL).
2. Add `body_id` FK + `model_id` column to `litho_lens_shape`.
3. Populate `litho_lens_shape.body_id` by joining `(model_id, content_key)`
   to existing `litho_lens` rows (one-time data fill).
4. Drop `content_key` from `litho_lens` and `litho_lens_shape`.
5. Populate `litho_lens.source_investigation_id` for every existing row via a
   scan of the row's defining contacts (`formation_contact.borehole_id` or
   `cpt_id` for the row's source pair). Run `ResolveLithoInstances` first if
   ordinals are stale.
6. Populate `extent_left_kind` / `extent_right_kind` for existing rows: run
   the bilateral detector once at migration time; for each detected bilateral
   closure, set both extent kinds to `'to_target'` with the right
   target_contact_id, distinguish left vs right by along position. Rows that
   the bilateral detector doesn't claim (pre-2026-05-31 unilateral rows that
   survived the startup sweep — should be zero given the sweep ran) get both
   extents NULL.
7. Rename tables: `litho_lens → body`, `litho_lens_shape → body_boundary_shape`,
   `litho_lens_boundary_node → body_boundary_node`.

**Pre-migration cleanup:** the startup sweep (shipped this morning) cleans
unilateral stale rows. Run it before the migration to keep the data fill
straightforward.

---

## 5. Domain + use cases

### 5.1 Domain algorithm

`detect_lenses_from_graph` → `detect_body_extents`. Same bilateral-closure
rule, different return shape. For each `(source_inv, c_above, c_below)`
candidate body with ≥2 distinct target investigations, returns:

```python
@dataclass(frozen=True)
class DetectedBody:
    formation_id: UUID
    source_investigation_id: UUID
    contact_above_id: UUID
    contact_below_id: UUID
    extent_left: BodyExtent | None   # the LEFT target (smaller along)
    extent_right: BodyExtent | None  # the RIGHT target (larger along)

@dataclass(frozen=True)
class BodyExtent:
    kind: Literal['to_target']
    target_contact_id: UUID
    neighbour_investigation_id: UUID
```

Left vs right is determined by the target investigation's `along` position
relative to the source. The current "pick lowest-UUID primary, ignore the
other" logic is gone — both sides are reported.

### 5.2 Provenance rule (the load-bearing reconcile invariant)

A side's extent has one of two provenances:

* **Detector-set**: `kind = 'to_target'`. The detector owns these; may
  overwrite or clear them on subsequent runs.
* **User-claimed**: `kind = 'pinch_out_halfway'` (or future `'extrapolated'`
  / `'open'`). The detector NEVER overwrites these. User explicitly clears
  via `ClearBodyExtent`.

A body is "purely detected" iff *both* sides are NULL or `'to_target'` AND
`name IS NULL`. The reconcile sweep only deletes purely-detected bodies whose
topology no longer holds. Named or user-claimed bodies survive every sweep.

### 5.3 Use cases

| Use case | Purpose | Commit boundary |
|---|---|---|
| `DetectBodies` | Renamed from `DetectLithoLenses`. Runs bilateral detection; creates/updates/reconciles per provenance rule. Returns counts (created, updated, removed_stale, skipped_unresolved_ordinal). | Flushes; caller commits (today's pattern preserved). |
| `ClaimBodyExtent` | Sets one side of one body to a user-claimed extent kind. Creates the body row if needed using `(model, formation, body_ordinal)` from the resolver + `source_investigation_id` from the request. Refuses to overwrite an existing `'to_target'` extent without explicit `ClearBodyExtent` first. | Commits. |
| `ClearBodyExtent` | Clears one side back to NULL. If both sides end up NULL and `name IS NULL`, body row is hard-deleted. | Commits. |
| `SuggestBodyPinchOuts` | Ephemeral pass. No persistence side effects. Scans bodies whose source pair has zero approved correlations in some direction; returns candidate records. | Read-only. |
| `NameBody` | Renamed from `NameLensBody`. Sets `name`. | Commits. |
| `DeleteBody` | Renamed from `DeleteLensMetadata`. Hard-delete the body row + cascade its boundary shape. | Commits. |
| `MaterialiseBodyCompanions` | Renamed from `MaterialiseLensCompanions`. Same gate logic. | Commits. |

### 5.4 `SuggestBodyPinchOuts` candidate shape

```python
@dataclass(frozen=True)
class PinchOutCandidate:
    body_id: UUID | None             # existing body row, or None for proposed-new
    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID
    side: Literal['left', 'right']
    suggested_neighbour_investigation_id: UUID
```

For each formation in the model: for each body framed by a source pair
`(above, below)`: for each side where the source pair has no approved
correlation: emit one candidate per geometrically-adjacent neighbour
investigation in that direction. (Adjacent = nearest investigation in the
section's `along` axis.)

Refreshed on every "Suggest pinch-outs" verb click. NOT persisted.

---

## 6. API surface

Clean rename in lockstep with the schema:

```text
POST   /projects/{pid}/geology/models/{mid}/bodies/detect
       (renamed from /lenses/detect; behaviour unchanged except writes extents)

POST   /projects/{pid}/geology/models/{mid}/bodies/suggest-pinch-outs
       (NEW — returns candidates JSON, no persistence)

GET    /projects/{pid}/geology/models/{mid}/bodies
       (renamed from /lenses; list endpoint with extent fields)

POST   /projects/{pid}/geology/models/{mid}/bodies
       (CLAIM — payload carries source_inv_id, formation_id, side, kind, target_or_neighbour_id)

PATCH  /projects/{pid}/geology/models/{mid}/bodies/{bid}
       (UPDATE — name, primary_section_id, or per-side extent fields)

DELETE /projects/{pid}/geology/models/{mid}/bodies/{bid}
       (renamed from /lenses/{lid}; hard-delete body + cascade boundary shape)

DELETE /projects/{pid}/geology/models/{mid}/bodies/{bid}/extents/{side}
       (CLEAR one side back to NULL; deletes body if empty + unnamed)

GET    /projects/{pid}/geology/models/{mid}/bodies/{bid}/boundary
PUT    /projects/{pid}/geology/models/{mid}/bodies/{bid}/boundary
       (renamed from /lenses/{lid}/boundary)

POST   /projects/{pid}/geology/models/{mid}/bodies/{bid}/perpendicular-companion
       (renamed from /lenses/{lid}/...)
```

`AcceptResult` returned by `AcceptContactCorrelations` renames its `lenses_*`
fields to `bodies_*` in the same slice (pre-ship compat amnesty applies per
`memory/project_backwards_compat_suspended.md` — the old names are not kept).
Frontend client renames in lockstep (slice 5).

---

## 7. Frontend rendering

### 7.1 Overlay

`LensWedgeOverlay → BodyExtentOverlay`. Same file location, same place in
`SectionPanel.tsx`, same prop shape (types renamed). The existing
column-edge anchoring + warp-aware screen↔along inverse stay — those are the
right primitives, hardened this morning.

### 7.2 Per-body render dispatch

For each body row in the section's body list:

1. Look up the body's `source_investigation_id` → source column (skip
   bodies whose source isn't on this section).
2. For LEFT side, dispatch on `extent_left_kind`:
   * `'to_target'` → wedge from source column edge to the target contact's
     position on the target column (today's primary wedge math).
   * `'pinch_out_halfway'` → wedge from source column edge to
     `(midpoint_along, midpoint_elevation)` where
     `midpoint_along = (source.along + neighbour.along) / 2` and
     `midpoint_elevation = (source_above_elev + source_base_elev) / 2`.
     Renders as a triangle tapering to a single point at halfway.
   * `'extrapolated'` *(Phase 5)* — placeholder.
   * `'open'` *(Phase 5)* — placeholder.
   * `NULL` → render nothing on this side.
3. Mirror for RIGHT side.
4. If at least one side has a wedge, build the body's full polyline:
   * Anchors = `[left_extent_endpoint] + [source_above] + [right_extent_endpoint]`
     for the upper edge (skip endpoints whose side is NULL).
   * Same for lower edge with `source_base`.
   * Merge with user-authored boundary nodes from `BodyBoundaryShapeOrm`,
     sorted by `along_m`.
   * Render fill polygon = upper forward + lower reversed.

### 7.3 Boundary shape model

One shape per body. Polyline spans the body's full width when both sides
claimed; spans source → single extent when only one side claimed. User-drawn
nodes' `along_m` positions naturally place them on left or right side via
the sort merge. No per-side shape storage in this build.

### 7.4 Ghost candidates

`SuggestBodyPinchOuts` results render as ghost wedges:

* Dashed amber stroke + 30 % fill opacity (mirrors the pending-correlation
  ribbon convention).
* Drawn from source column edge to halfway midpoint (same math as committed
  `pinch_out_halfway`).
* Hover: tooltip `"Suggested pinch-out — click to commit"`.
* Click: fires `ClaimBodyExtent`; on success the candidate disappears from
  the list and the body re-renders as a committed wedge.
* Ephemeral lifecycle: candidate list lives in frontend state. Refreshed on
  every "Suggest pinch-outs" verb click. Cleared by `Esc` or by a manual
  Dismiss action.

### 7.5 Visual distinction

| State | Render |
|---|---|
| Bilateral detected body | Solid teal wedge on both sides |
| User-claimed pinch-out (one or both sides) | Solid teal wedge on each claimed side; nothing on unclaimed side |
| Unclaimed, suggested by Suggest pass | Dashed amber wedge on suggested side |
| Unclaimed, not suggested | No render — column band only |
| Provenance conflict (user-claimed side + auto-detection available) | Inspector badge `"auto-detection available — click to apply"` on the body row |

---

## 8. Gestures

### 8.1 Right-click on a body band (in the column itself)

Opens a context menu:

* **"Pinch out halfway →"** (right side) — fires `ClaimBodyExtent` with
  `side='right'`, `kind='pinch_out_halfway'`, `neighbour_inv_id = adjacent
  investigation along the section to the right of source`.
* **"Pinch out halfway ←"** (left side) — mirror.
* If a side is already claimed: shows **"Clear pinch-out (right/left)"**
  instead of "Pinch out".
* **"Name this body…"** (existing, repackaged).
* **"Delete body"** (existing, repackaged).

### 8.2 Right-click on an existing wedge

Today's gesture preserved: dissolves the body (hard-deletes the row).

### 8.3 "Suggest pinch-outs" toolbar verb

New `ToolbarButton` in `SectionsToolbar`, sibling of "Detect bodies" /
"Materialise body companions". Click runs `SuggestBodyPinchOuts`, populates
the ghost-candidate state, toast shows count: `"3 pinch-out candidates"`.

### 8.4 Click on a ghost candidate

Fires `ClaimBodyExtent` with the candidate's parameters. On success: ghost
disappears, body wedge appears (committed), success toast shows
`"Pinch-out body committed"`.

### 8.5 Provenance-conflict inspector badge

When a body has at least one user-claimed extent but the detector finds a
bilateral closure that would set the other side to `'to_target'`: the
detector silently skips that body (per provenance rule), but the inspector
shows an amber badge on the body row: *"auto-detection available — click to
apply"*. Click opens a dialog:

* **"Replace user-claimed pinch-out with auto-detected target?"**
  * **Apply** (default focus) — clears user-claim, lets detector populate.
  * **Keep user-claim** — closes dialog, stops showing the badge for this
    session.
  * **Cancel** — closes dialog, badge stays.

---

## 9. Bundle round-trip

`ProjectBundleRequest.litho_lenses_payload` → `bodies_payload`. Per-body
JSON gains the new extent fields and `source_investigation_id`; drops
`content_key`. Restore order:

1. Project shell, formations, contacts (existing).
2. Bodies (`bodies_payload`).
3. Body boundary shapes (`body_boundary_shapes_payload`).
4. Body boundary nodes (`body_boundary_nodes_payload`).
5. Formation absences (existing, unchanged).

**Pre-restore integrity guard** (extends today's guard):

* For each body row: `formation_id` resolves in the bundle's formation set;
  `source_investigation_id` resolves in the bundle's CPT / borehole set.
* For each populated extent: `target_contact_id` (when `to_target`) resolves
  in the bundle's contact set; `neighbour_inv_id` (when `pinch_out_halfway`)
  resolves in the investigation set.
* Body rows whose source investigation doesn't resolve are dropped with a
  warning (consistent with today's drop-orphan-bodies pattern).

**Restore-time reconcile** (shipped this morning at the API router level)
runs `DetectBodies` after restore so legacy bundles auto-clean. Preserve-
claimed guard means user-claimed pinch-outs survive.

**Startup sweep** (shipped this morning) renames its `DetectLithoLenses`
call to `DetectBodies`. Same idempotent behaviour.

---

## 10. Edge cases

1. **Body's `neighbour_inv_id` not on the current section** (the neighbour
   was excluded via section's `excluded_*_ids`, or the section was
   redrawn). Renderer falls back to: taper to the section's nearest endpoint
   in that direction; log `console.warn` once per body per session. The body
   row stays valid (the geometry is interpretive; the section just doesn't
   have the neighbour data right now).

2. **User claims `pinch_out_halfway` then a later edit creates a bilateral
   correlation closure on the same side.** Provenance rule: detector
   refuses to overwrite. User keeps the pinch-out. Inspector badge shows
   the available auto-detection; user can explicitly accept via dialog
   (see 8.5).

3. **User-claimed body's source contact gets deleted.** The body row does
   NOT directly FK its source-pair contacts — body identity is
   `(model, formation, body_ordinal)` derived from the resolver's
   connected-component algorithm, not stored references. So no cascade
   fires on source-contact delete. The resolver re-runs on the contact
   mutation; the body's `(formation, body_ordinal)` may shift or no longer
   correspond to a real component. The preserve-claimed reconcile guard
   means the user-claimed body row survives even when its topological
   identity is broken — potential **zombie body** state (a row whose
   geometry can't be rendered). User can delete it manually via the
   inspector. If this becomes a routine dogfeed annoyance, a future
   "Cleanup orphan bodies" tool detects + offers to delete bodies whose
   `(formation, body_ordinal)` doesn't match any current connected
   component.

4. **Body row's primary section gets deleted.** `primary_section_id` is
   `SET NULL` on cascade (today's behaviour, kept). Body persists; companion
   section gone. User can re-pick a primary section via the inspector.

5. **Two bodies of the same formation on the same investigation
   (stacked bilateral lenses).** Each gets its own `body_ordinal` from the
   resolver. Each gets its own row. Each renders independently. No
   conflict — unique constraint is `(model, formation, body_ordinal)`.

6. **User-claimed left + auto-bilateral right.** Detector skips because
   provenance rule forbids overwriting the user-claimed left. Inspector
   badge from 8.5 covers this.

7. **Auto-suggest candidate becomes stale before user clicks.** Refresh of
   the suggest pass re-derives from current state. Stale ghosts disappear
   silently on next "Suggest pinch-outs" click; no error if user clicks a
   stale ghost (idempotent claim — the body either exists already or
   doesn't; the click either creates or no-ops).

---

## 11. Ship phasing

Eight slices, each commitable on its own, each leaves the system green:

| # | Slice | Est | Green-gate |
|---|---|---|---|
| 1 | **Schema + ORM rename + migration** | 3-4 h | Existing pytest suite passes after the rename. Alembic upgrade tested end-to-end against integration DB. |
| 2 | **Domain + use cases** | 3-4 h | Unit tests for `detect_body_extents`. Integration tests for `DetectBodies`, `ClaimBodyExtent`, `ClearBodyExtent`, `SuggestBodyPinchOuts`. Callers (startup sweep, restore-time reconcile, edge mutations) updated. |
| 3 | **API rename + new endpoints** | 2 h | Integration tests for every endpoint. Manual smoke via httpx test. |
| 4 | **Bundle round-trip + reconcile guards** | 2 h | Bundle build/restore round-trip integration test with claim-bearing bodies. Preserve-claimed guard test. |
| 5 | **Frontend types + API client** | 1 h | tsc clean. Existing client tests pass. |
| 6 | **Frontend renderer** | 3 h | Existing 10 LW tests + ~6 new BE tests pass. Manual render check at multiple spacing values. |
| 7 | **Frontend gestures + auto-suggest UI** | 3 h | Vitest pass for context menu, suggest verb wiring, ghost click commit, provenance-conflict badge. Manual dogfeed walkthrough on test2.strix. |
| 8 | **Docs + dogfeed + cleanup** | 1 h | `CLAUDE.md` reflects rename + concept shift. Memory updates if patterns shift. User-confirmed dogfeed walkthrough. |

**Total estimate: 18-20 h** at focused pace (2-3 working days).

---

## 12. Testing strategy

### 12.1 Domain unit tests (`tests/unit/domain/services/`)

* `test_detect_body_extents.py`
  * Bilateral closure produces `BodyExtent` per side with correct left/right
    assignment from along positions.
  * Stacked bodies produce N-1 extents per side (carries forward today's
    `test_stacked_lenses` shape).
  * Unilateral closures produce nothing (carries forward
    `test_unilateral_pinch_out_does_not_create_lens`).
  * Degeneracy thickness guard still rejects.
  * Determinism: same input → same output extents.

### 12.2 Use-case integration tests (`tests/integration/application/`)

* `test_detect_bodies.py` — supersedes today's `test_detect_litho_lenses.py`.
  * Bilateral detection materialises bodies with both extents set.
  * Reconcile preserves named bodies (today's `test_named_lens_survives_…`).
  * **NEW:** reconcile preserves user-claimed bodies (`extent_*_kind`
    not in `{NULL, 'to_target'}`).
  * **NEW:** detector refuses to overwrite a user-claimed extent.
* `test_claim_body_extent.py` (NEW)
  * Creates body row if not existing; sets the side; round-trips via re-read.
  * Refuses to overwrite a `'to_target'` extent without explicit clear.
  * Validates `neighbour_inv_id != source_investigation_id`.
* `test_clear_body_extent.py` (NEW)
  * Clears one side back to NULL.
  * Deletes the body row when both sides + name are empty.
* `test_suggest_body_pinch_outs.py` (NEW)
  * Returns expected candidate shapes for known topologies.
  * Body with claim on left but open right → only right candidate emitted.
  * No persistence side effects.

### 12.3 API integration tests (`tests/integration/api/`)

* `test_body_endpoints.py` (renames + extends `test_contact_correlation_endpoints.py` patterns)
  * Every new endpoint exercised: scope guards, error shapes, idempotency.
  * Bundle round-trip end-to-end via `/projects/{pid}/bundle` POST.

### 12.4 Vitest (frontend)

* `BodyExtentOverlay.test.tsx` (renamed + extended)
  * Render dispatch per extent kind (`to_target`, `pinch_out_halfway`, NULL).
  * Edge-anchored endpoints (LW8 logic preserved).
  * Bilateral body renders both sides (LW9 logic preserved).
  * Secondary side has no draggable nodes (LW10 logic preserved).
  * **NEW:** body with `pinch_out_halfway` left + `to_target` right renders
    both wedges correctly.
  * **NEW:** ghost candidate renders with dashed amber stroke + tooltip.
  * **NEW:** click on ghost candidate fires `claimBodyExtent` callback.
* `SectionsToolbar.test.tsx` (extends)
  * "Suggest pinch-outs" verb wired to `api.geology.suggestBodyPinchOuts`.
  * Toast shows candidate count.
* `BodyInspector.test.tsx` (new, or extends `LithologyInspector`)
  * Provenance-conflict badge appears when conditions match.
  * Override dialog wires correctly.

### 12.5 Manual dogfeed checkpoint after slice 7

On `test2.strix`:

1. Pick an unclaimed body. Right-click → "Pinch out halfway right". Verify
   wedge renders flush at column edge, tapers to halfway midpoint.
2. Save the project. Close. Reopen. Verify the claim persists.
3. Run "Suggest pinch-outs". Verify ghosts appear for expected candidates.
4. Click a ghost. Verify body materialises.
5. Trigger the provenance conflict (claim pinch-out left, then create
   bilateral correlations on left). Verify inspector badge + override dialog.

---

## 13. Risk register

| Risk | Mitigation |
|---|---|
| Migration data fill fails on a dirty dev DB | Run startup sweep first (shipped this morning); migration sees clean state. |
| Alembic downgrade is forward-only | Pre-ship amnesty accepts this. Document in the revision file. |
| Frontend type churn is wide (slice 5) | Keep slice 5 to renames + new methods only, no logic changes. tsc is the safety net. |
| Companion sections cascade behaviour on body delete | Existing `CASCADE` rules suffice; add integration test coverage in slice 4. |
| Provenance-conflict UX is subtle | Inspector badge + explicit dialog (8.5) keeps the override path discoverable. User testing on test2.strix in slice 7 manual checkpoint. |
| Ephemeral candidate state on the frontend gets stale | Refresh on every "Suggest pinch-outs" verb click; click on stale candidate is idempotent (no error). |
| Two-sided shape editing deferred (per-side polylines) | One-polyline-per-body model accepts both sides via along-sorted nodes — adequate for v1; per-side editing fits as additive extension later. |
| Zombie user-claimed bodies after source-contact delete (Section 10 #3) | Preserve-claimed guard intentionally keeps them. Manual delete via inspector is the user's escape hatch. Add an explicit "Cleanup orphan bodies" tool only if dogfeed shows this happening often. |
| `source_investigation_id` is polymorphic UUID with no FK cascade (refs CPT *or* borehole) | Matches the existing `formation_contact.borehole_id` / `cpt_id` pattern. Cascade on CPT/borehole delete must be handled at the use-case layer (existing `DeleteCpt` / `DeleteBorehole` pathways extended to clean up referencing bodies). Integration test coverage in slice 4. |

---

## 14. What stays out of scope (re-affirmed)

* `extent_kind = 'extrapolated'` — schema reserved, no code in this build.
* `extent_kind = 'open'` — schema reserved, no code in this build.
* Geological-model body rendering — schema kind-agnostic, renderer in
  slice 6 wires litho path only.
* Per-side boundary shape storage — one polyline per body in this build.
* Migration from existing user-named lenses to body model: preserve names
  verbatim; the rename is the only change to user-visible state.

---

*End of design.*
