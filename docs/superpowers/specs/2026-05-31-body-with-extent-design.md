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

**In scope (added by owner edit during spec review, 2026-05-31):**

* `extent_kind = 'extrapolated'` — body-pure absorption of the existing
  `ExtrapolatePinchOut` tool. The tool's synthetic `FormationContact` rows
  go away; closure is represented purely as an extent marker; the
  dip-extrapolation endpoint is computed at render time. Existing synthetic
  contacts in dev DBs are migrated to extents in the slice-1 data fill;
  pre-ship amnesty covers any lossy edges. The `ExtrapolatePinchOut` use
  case + `POST .../contacts/pinch-out` endpoint are retired; the
  user-visible gesture is rewired to claim an extent. Downstream consumers
  of synthetic contacts (TIN inputs, formation_absences) are updated to
  stop seeing them — TIN regenerates from real measurements only;
  per-formation absences re-derive at slice-4 migration time. Render style
  for an extrapolated wedge is the standard solid teal wedge with a small
  dip-arrow glyph at the endpoint so the engineer reads "this side is
  computed, not measured".

* `extent_kind = 'open'` — explicit "extends to / past the section
  boundary". Renderer draws a wedge from source column edge to the section
  endpoint at the body's mid-elevation (not tapering). New gesture in the
  body-band context menu: "Extends to section boundary →/←". User claim
  populates `extent_<side>_kind = 'open'`; no other fields needed.

**Non-goals (still explicitly out of scope for this build):**

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
| `'extrapolated'` | Dip-extrapolation closure (absorbs the retired `ExtrapolatePinchOut` tool, body-pure). Endpoint computed at render time from source contacts + neighbour's surface; no stored synthetic contact. | User claim populates `neighbour_inv_id`. |
| `'open'` | Explicitly extends to / past the section boundary. | User claim populates `extent_<side>_kind` only; neither `target_contact_id` nor `neighbour_inv_id` is needed. |
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
7. **Absorb synthetic pinch-out contacts (`source='pinch_out_extrapolation'`)
   into body extents.** For each synthetic contact:
   a. Identify the body it represents: find the corresponding source pair
      on the upstream investigation (the contact the extrapolation
      originated from); locate that body via `(model, formation,
      body_ordinal)` from the resolver.
   b. Determine which side (left/right) by comparing the synthetic
      contact's anchor investigation along-position to the source body's
      along-position on the primary section.
   c. Create / update the body extent: `extent_<side>_kind = 'extrapolated'`,
      `extent_<side>_neighbour_inv_id = <anchor investigation of the
      synthetic contact>`. If the body row doesn't exist yet (synthetic
      contact pre-dates any LithoLens row), create one.
   d. Delete the synthetic contact row.
   Edge case: synthetic contacts that can't be cleanly attributed to a
   body (orphaned, malformed, anchor investigation no longer in project,
   ...) are dropped with a warning. Pre-ship amnesty covers any losses;
   user re-claims via the rewired gesture if needed.
8. **Refresh downstream artefacts.** Re-run TIN builds for every affected
   litho model (now without the synthetic contacts as inputs). Re-derive
   `formation_absences` from the (now smaller) contact set. Both happen at
   migration time so the user opens to a coherent state.
9. Rename tables: `litho_lens → body`, `litho_lens_shape → body_boundary_shape`,
   `litho_lens_boundary_node → body_boundary_node`.

**Pre-migration cleanup:** the startup sweep (shipped this morning) cleans
unilateral stale lens rows. Run it before the migration to keep the data
fill straightforward.

**Retired endpoint + use case** (lockstep with the migration):
* `ExtrapolatePinchOut` use case is deleted; its dip-extrapolation math
  moves to a domain helper consumed by both `ClaimBodyExtent`
  (kind=`'extrapolated'`) and the renderer (computes endpoint for display).
* `POST /projects/{pid}/cpt/contacts/pinch-out` (or wherever it lives)
  endpoint is removed.
* Frontend gesture that previously created the synthetic contact is rewired
  to call `POST /bodies` with `kind='extrapolated'`.

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
* **User-claimed**: `kind ∈ {'pinch_out_halfway', 'extrapolated', 'open'}`.
  The detector NEVER overwrites these. User explicitly clears via
  `ClearBodyExtent`.

A body is "purely detected" iff *both* sides are NULL or `'to_target'` AND
`name IS NULL`. The reconcile sweep only deletes purely-detected bodies whose
topology no longer holds. Named or user-claimed bodies survive every sweep.

### 5.3 Use cases

| Use case | Purpose | Commit boundary |
|---|---|---|
| `DetectBodies` | Renamed from `DetectLithoLenses`. Runs bilateral detection; creates/updates/reconciles per provenance rule. Returns counts (created, updated, removed_stale, skipped_unresolved_ordinal). | Flushes; caller commits (today's pattern preserved). |
| `ClaimBodyExtent` | Sets one side of one body to a user-claimed extent kind ∈ `{'pinch_out_halfway', 'extrapolated', 'open'}`. Creates the body row if needed using `(model, formation, body_ordinal)` from the resolver + `source_investigation_id` from the request. For `'pinch_out_halfway'` and `'extrapolated'`, payload carries `neighbour_inv_id`; for `'open'`, neither extra field is needed. For `'extrapolated'`, the use case validates dip-extrapolation is geometrically defined (source contacts have enough information to project; neighbour exists in the section) and persists the extent — the endpoint is computed at render time. Refuses to overwrite an existing `'to_target'` extent without explicit `ClearBodyExtent` first. | Commits. |
| `ClearBodyExtent` | Clears one side back to NULL. If both sides end up NULL and `name IS NULL`, body row is hard-deleted. | Commits. |
| `SuggestBodyPinchOuts` | Ephemeral pass. No persistence side effects. Scans bodies whose source pair has zero approved correlations in some direction; returns candidate records. | Read-only. |
| `NameBody` | Renamed from `NameLensBody`. Sets `name`. | Commits. |
| `DeleteBody` | Renamed from `DeleteLensMetadata`. Hard-delete the body row + cascade its boundary shape. | Commits. |
| `MaterialiseBodyCompanions` | Renamed from `MaterialiseLensCompanions`. Same gate logic. | Commits. |
| ~~`ExtrapolatePinchOut`~~ | **RETIRED.** Its dip-extrapolation math moves to a `domain/services/dip_extrapolation.py` helper consumed by both `ClaimBodyExtent` (validates and persists `kind='extrapolated'`) and the renderer (computes endpoint position for display). The existing `POST .../contacts/pinch-out` endpoint is removed. | — |

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

**Retired endpoints** (lockstep with `ExtrapolatePinchOut` retirement):

```text
POST   /projects/{pid}/cpt/contacts/pinch-out         — REMOVED
                                                        (existing pinch-out
                                                        tool's endpoint; the
                                                        frontend gesture
                                                        rewires to call
                                                        POST /bodies with
                                                        kind='extrapolated')
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
right primitives, hardened this morning. can we compound all body actions in one dropdown menu to avoid toolbar clutter?

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
   * `'extrapolated'` → wedge from source column edge to the
     dip-extrapolation endpoint, computed at render time via
     `domain/services/dip_extrapolation.py`. The helper takes the source
     contact pair on the source investigation + the neighbour
     investigation's surface elevation; returns the (along, elevation)
     where the extrapolated boundary would cross the neighbour's
     elevation column. Endpoint is rendered with a small dip-arrow
     glyph so the engineer reads "this side is computed, not measured".
     Falls back to halfway-pinch-out style with a console.warn when the
     extrapolation is geometrically undefined (e.g. source contacts
     collinear; neighbour's elevation unknown).
   * `'open'` → wedge from source column edge straight to the section
     endpoint in that direction, at the body's mid-elevation
     `(source_above_elev + source_base_elev) / 2`. Wedge does NOT taper —
     the upper and lower edges run at the source contacts' respective
     elevations all the way to the section endpoint. Visually: a
     parallel-sided band fading off the section. Lets the engineer
     express "this body continues past where we have data".
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
| User-claimed halfway pinch-out (one or both sides) | Solid teal wedge on each claimed side, tapering to halfway point |
| User-claimed extrapolated (one or both sides) | Solid teal wedge tapering to dip-extrapolation endpoint, with a small dip-arrow glyph at the endpoint |
| User-claimed open (one or both sides) | Parallel-sided teal band extending to section endpoint (no taper) |
| Mixed extents per side | Each side renders independently per its kind — e.g. `to_target` left + `open` right is a wedge-left + parallel-band-right |
| Unclaimed, suggested by Suggest pass | Dashed amber wedge on suggested side |
| Unclaimed, not suggested | No render — column band only |
| Provenance conflict (user-claimed side + auto-detection available) | Inspector badge `"auto-detection available — click to apply"` on the body row |

---

## 8. Gestures

### 8.1 Right-click on a body band (in the column itself)

Opens a context menu with **per-side closure** items. For each side
(left / right), one item appears based on the current state:

* If the side is unclaimed (kind = NULL), a submenu offers four claim
  kinds:
  * **"Pinch out halfway →/←"** — fires `ClaimBodyExtent` with
    `kind='pinch_out_halfway'`, `neighbour_inv_id = adjacent
    investigation along the section in that direction from source`.
  * **"Extrapolate (dip-projection) →/←"** — fires `ClaimBodyExtent`
    with `kind='extrapolated'`, `neighbour_inv_id = adjacent
    investigation in that direction`. Replaces the existing
    user-invoked pinch-out wedge tool.
  * **"Extends to section boundary →/←"** — fires `ClaimBodyExtent`
    with `kind='open'`; no extra fields.
  * **(Auto-detected `to_target` doesn't appear as a manual claim — it
    comes from `DetectBodies` only. User can't pick it from the menu.)**
* If the side is already claimed, the menu shows the current claim
  kind plus a **"Clear extent (right/left)"** action.
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

8. **Extrapolated extent: dip-extrapolation is geometrically undefined.**
   Cases: source contacts have identical depths (zero dip → projection
   never reaches the neighbour's elevation), neighbour's surface
   elevation is unknown, source pair is on the same investigation as
   the neighbour (degenerate). `ClaimBodyExtent` rejects with a 422 and
   the gesture shows a toast `"Can't extrapolate — source contacts
   collinear / neighbour elevation unknown"`. Renderer falls back to
   halfway-pinch-out style with a console.warn if a persisted
   `'extrapolated'` extent becomes undefined later (e.g. neighbour's
   elevation field gets cleared).

9. **Open extent on a section's middle column.** `'open'` means "extends
   to / past the section endpoint in this direction". Rendering at a
   middle column is geometrically possible (the band extends across all
   intermediate columns to the section endpoint) but interpretively
   strange — usually you'd claim `pinch_out_halfway` or `'to_target'`
   first. We don't block the claim; the renderer just draws the band
   across intermediate columns. Inspector shows a small warning glyph
   `"open extent crosses other investigations"` so the user sees it's
   unusual.

10. **Mixed extent kinds on one body** (e.g. `'extrapolated'` left +
    `'to_target'` right). Renderer dispatches per side independently;
    each side uses its own kind's render logic. Boundary shape (the
    user-drawn polyline through the body) spans both sides as a single
    continuous curve — the kind doesn't affect the shape, only where
    the endpoints land. Provenance rule applies per side: detector can
    overwrite `to_target` right but not `extrapolated` left.

---

## 11. Ship phasing

Ten slices, each commitable on its own, each leaves the system green.
Owner edit (2026-05-31) brought `'extrapolated'` and `'open'` into scope,
which added one full slice (1a — synthetic-contact migration + tool
retirement) plus expanded slices 2, 6, and 7. Sequencing matters: slice
1a runs immediately after slice 1's schema rename so the legacy
synthetic contacts are gone before slice 2 starts wiring new use cases
against the clean state.

| # | Slice | Est | Green-gate |
|---|---|---|---|
| 1 | **Schema + ORM rename + migration** | 3-4 h | Existing pytest suite passes after the rename. Alembic upgrade tested end-to-end against integration DB. Steps 1-6 + 9 of §4.5 (the table rename + bilateral-detector data fill); steps 7-8 (synthetic-contact absorption) ship in slice 1a. |
| 1a | **Synthetic pinch-out contact migration + tool retirement** | 2-3 h | Alembic revision absorbs every `source='pinch_out_extrapolation'` contact into a body extent `kind='extrapolated'`; deletes the synthetic contacts; re-runs TIN + absences for affected litho models. `ExtrapolatePinchOut` use case + `POST .../contacts/pinch-out` endpoint removed; integration tests that exercised them either rewire to the new gesture or get deleted. Pre-ship amnesty covers lossy edges. |
| 2 | **Domain + use cases** | 4-5 h | Unit tests for `detect_body_extents`. New `domain/services/dip_extrapolation.py` helper with its own unit tests (computes endpoint from source pair + neighbour surface). Integration tests for `DetectBodies`, `ClaimBodyExtent` (all four kinds: `to_target` via detector path, `pinch_out_halfway` + `extrapolated` + `open` via user-claim paths), `ClearBodyExtent`, `SuggestBodyPinchOuts`. Callers (startup sweep, restore-time reconcile, edge mutations) updated. |
| 3 | **API rename + new endpoints** | 2 h | Integration tests for every new endpoint. `POST /bodies` accepts all four extent kinds via payload `kind` field. Manual smoke via httpx test. |
| 4 | **Bundle round-trip + reconcile guards** | 2 h | Bundle build/restore round-trip integration test with claim-bearing bodies of every kind. Preserve-claimed guard test (all three user-claim kinds survive sweeps). |
| 5 | **Frontend types + API client** | 1 h | tsc clean. Existing client tests pass. New `api.geology.claimBodyExtent` accepts `kind` parameter. |
| 6 | **Frontend renderer** | 4 h | Per-side dispatch for all four extent kinds (`to_target`, `pinch_out_halfway`, `extrapolated`, `open`, NULL). New dip-arrow glyph for extrapolated endpoints. Parallel-band render for open. Existing 10 LW tests + ~12 new BE tests pass (one per kind per side, plus mixed-kind combinations). Manual render check at multiple spacing values + multiple kinds. |
| 7 | **Frontend gestures + auto-suggest UI** | 4 h | Right-click body band → per-side submenu with all four claim items (`pinch_out_halfway`, `extrapolated`, `open`, plus `Clear extent`). "Suggest pinch-outs" verb wires + ghost click commit. Provenance-conflict badge + override dialog. Vitest coverage per gesture. Manual dogfeed walkthrough on test2.strix. |
| 8 | **Docs + dogfeed + cleanup** | 1-2 h | `CLAUDE.md` reflects rename + concept shift + ExtrapolatePinchOut retirement. Memory updates if patterns shift. User-confirmed dogfeed walkthrough exercising every extent kind. |

**Total estimate: 23-27 h** at focused pace (3-4 working days). Increase
from 18-20 h reflects the in-scope addition of `'extrapolated'` (slice 1a
+ slice 2 helper + slice 6 render + slice 7 gesture) and `'open'`
(smaller — slice 2 + 6 + 7 each grow by ~30 min).

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
  * **NEW for each kind:**
    * `kind='pinch_out_halfway'` — persists neighbour_inv_id; rejects when neighbour missing.
    * `kind='extrapolated'` — persists neighbour_inv_id; rejects when dip-extrapolation is geometrically undefined (collinear source contacts; unknown neighbour elevation; source-pair on same investigation as neighbour).
    * `kind='open'` — persists kind only; ignores neighbour_inv_id / target_contact_id payload fields if supplied.
* `test_dip_extrapolation.py` (NEW, `tests/unit/domain/services/`)
  * Computes correct endpoint for a known source pair + neighbour surface.
  * Returns None for degenerate inputs (collinear contacts; flat dip; unknown neighbour elevation).
  * Deterministic across re-runs.
* `test_synthetic_contact_migration.py` (NEW, `tests/integration/db/migrations/`)
  * Fixture: dev-style DB with several `source='pinch_out_extrapolation'` contacts.
  * After Alembic upgrade runs slice 1a: synthetic contacts are gone; corresponding body extents exist with `kind='extrapolated'`; TIN inputs no longer reference synthetic contacts.
  * Lossy-edge fixture: malformed synthetic contact is dropped with warning, doesn't break migration.
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
  * Render dispatch for ALL FOUR extent kinds (`to_target`,
    `pinch_out_halfway`, `extrapolated`, `open`, NULL).
  * Edge-anchored endpoints (LW8 logic preserved).
  * Bilateral body renders both sides (LW9 logic preserved).
  * Secondary side has no draggable nodes (LW10 logic preserved).
  * **NEW per kind:**
    * `pinch_out_halfway` renders triangle to halfway midpoint.
    * `extrapolated` renders triangle to dip-extrapolation endpoint;
      dip-arrow glyph at endpoint; falls back to halfway-style with
      console.warn when extrapolation is undefined.
    * `open` renders parallel-sided band to section endpoint (no taper).
  * **NEW combinations:** `to_target` left + `open` right; `extrapolated`
    left + `pinch_out_halfway` right (every meaningful pair).
  * **NEW:** ghost candidate renders with dashed amber stroke + tooltip.
  * **NEW:** click on ghost candidate fires `claimBodyExtent` callback.
* `SectionsToolbar.test.tsx` (extends)
  * "Suggest pinch-outs" verb wired to `api.geology.suggestBodyPinchOuts`.
  * Toast shows candidate count.
* `BodyContextMenu.test.tsx` (NEW)
  * Per-side submenu shows all four claim items when side is unclaimed.
  * Already-claimed side shows current kind + "Clear extent" action.
  * Each menu item fires `claimBodyExtent` with the correct `kind`.
* `BodyInspector.test.tsx` (new, or extends `LithologyInspector`)
  * Provenance-conflict badge appears when conditions match.
  * Override dialog wires correctly.

### 12.5 Manual dogfeed checkpoint after slice 7

On `test2.strix`:

1. Pick an unclaimed body. Right-click → "Pinch out halfway right". Verify
   wedge renders flush at column edge, tapers to halfway midpoint.
2. Same body, other side: right-click → "Extrapolate (dip-projection)
   ←". Verify dip-arrow glyph at extrapolation endpoint; verify endpoint
   sits where dip-projection predicts.
3. Different body: right-click → "Extends to section boundary →". Verify
   parallel-sided band reaches the section endpoint.
4. Save the project. Close. Reopen. Verify ALL claims persist with their
   correct kinds.
5. Run "Suggest pinch-outs". Verify ghosts appear for expected candidates.
6. Click a ghost. Verify body materialises with `pinch_out_halfway`.
7. Trigger the provenance conflict (claim pinch-out left, then create
   bilateral correlations on left). Verify inspector badge + override
   dialog.
8. Trigger the extrapolation-undefined case (claim `extrapolated` on a
   body where source contacts are collinear). Verify gesture rejection
   toast.

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
| Synthetic pinch-out contact migration loses information | Pre-ship amnesty covers lossy edges (malformed synthetic contacts, ones that don't cleanly map to a body). Migration emits warnings; user re-claims via the rewired gesture. Worst case: a few extrapolated extents need to be re-clicked after open. Acceptable in dogfeed. |
| Downstream consumers of synthetic contacts not yet updated | The slice 1a migration re-runs TIN + absences right after deleting synthetic contacts so the user opens to a coherent state. Other consumers (statistics, parameter computation, exports — all Phase 5) don't exist yet, so there's nothing to break beyond TIN + absences. |
| `ExtrapolatePinchOut` retirement breaks any test / docs / memory that references it | Slice 1a's green-gate explicitly covers removing tests that exercised the retired use case. Memory cleanup in slice 8 (search for "pinch_out_extrapolation" / "ExtrapolatePinchOut" / "pinch-out tool" — update or delete). |
| Dip-extrapolation math correctness | `domain/services/dip_extrapolation.py` gets its own unit test suite (`test_dip_extrapolation.py`) covering: known-good geometry → known-good endpoint; degenerate inputs → None; symmetry (left and right directions). The math is well-defined; the risk is implementation drift over time. |
| `'open'` extent on a middle column is geometrically reasonable but interpretively unusual | Don't block the claim. Inspector shows a small warning glyph (§10 #9). User can clear if they didn't mean it. |
| Extent kind enum drift between backend and frontend | Single source of truth: define the enum once in a shared schema (`src/groundmodel/shared/constants/extent_kind.py`); generate TypeScript types from it (or duplicate with care). Each new kind requires updating both sides + the tests catch missing handling. |

---

## 14. What stays out of scope (re-affirmed)

* Geological-model body rendering — schema kind-agnostic, renderer in
  slice 6 wires litho path only.
* Per-side boundary shape storage — one polyline per body in this build.
* Migration from existing user-named lenses to body model: preserve names
  verbatim; the rename is the only change to user-visible state.

---
## 15. Playwright e2e coverage

The Playwright harness (`desktop/tests/e2e/`) is the codebase's end-to-end
safety net (debt #128 shipped 2026-05-25; #130 expansion convention is
ongoing). Existing flows that touch the lens / pinch-out surface need
updating in lockstep with the refactor, and new flows cover the new
extent kinds. All belong in slice 7 (so the gestures + auto-suggest UI
are exercised end-to-end) plus slice 1a for the retired-tool flow.

### 15.1 Existing flows to update or replace

| File | Change |
|---|---|
| `flow_inspect_lens.spec.ts` | Rename `flow_inspect_body.spec.ts`. Update selectors: `lens-wedge-*` → `body-wedge-*`, `lens-*` → `body-*`. Behaviour stays the same (inspect a detected bilateral body). |
| `auto-correlate-and-lenses.spec.ts` | Rename `auto-correlate-and-bodies.spec.ts`. Update selectors + assertions about lens row → body row. Behaviour stays the same. |
| `flow_litho_pinch_out.spec.ts` | **REPLACE.** This tested the retired `ExtrapolatePinchOut` tool (creates synthetic contact). New flow: same user gesture lands on `ClaimBodyExtent(kind='extrapolated')` — body extent created, no synthetic contact. Rename `flow_body_extrapolate.spec.ts`. |
| `flow_correlate.spec.ts` + `flow_auto_correlate.spec.ts` | Update assertions that previously read `lenses_created` / `lenses_removed` from the Accept response — those fields rename to `bodies_created` / `bodies_removed` in slice 5. |
| `flow_bundle_roundtrip.spec.ts` | Extend to round-trip a project containing bodies of every extent kind (`to_target` + `pinch_out_halfway` + `extrapolated` + `open`). Assert all kinds + side data survive save → close → reopen. |

### 15.2 New flows (slice 7)

| File | Coverage |
|---|---|
| `flow_body_pinch_out_halfway.spec.ts` | Right-click body band → "Pinch out halfway →" → wedge appears tapering to halfway midpoint. Verify wedge is present + visually positioned. Save → close → reopen → verify wedge persists. |
| `flow_body_extrapolate.spec.ts` | (Replaces `flow_litho_pinch_out`.) Right-click body band → "Extrapolate (dip-projection) ←" → wedge appears tapering to dip-extrapolation endpoint with dip-arrow glyph. Save → close → reopen → verify wedge persists. Verify no synthetic FormationContact rows were created (call the API to list contacts; assert no `source='pinch_out_extrapolation'` rows exist). |
| `flow_body_open_extent.spec.ts` | Right-click body band → "Extends to section boundary →" → parallel-sided band reaches section endpoint. Save → close → reopen → verify band persists. |
| `flow_body_suggest_pinch_outs.spec.ts` | Click "Suggest pinch-outs" toolbar verb → ghost wedge(s) appear dashed amber → click a ghost → wedge committed solid teal → ghost disappears. Re-run suggest → no candidates for already-claimed sides. |
| `flow_body_clear_extent.spec.ts` | Body with a claim on one side. Right-click band → "Clear extent (left)" → wedge disappears. Verify body row deleted when both sides + name empty (assert via API list call returns no body). |
| `flow_body_provenance_conflict.spec.ts` | Claim `pinch_out_halfway` on left. Then draw correlations that would form bilateral closure on left. Verify inspector badge appears `"auto-detection available — click to apply"`. Click badge → override dialog opens. Click "Apply" → extent flips to `to_target`. Click "Keep user-claim" → badge dismissed for session. |
| `flow_body_dip_extrapolation_undefined.spec.ts` | Try to claim `'extrapolated'` on a body with collinear source contacts. Verify 422-class toast `"Can't extrapolate — source contacts collinear / neighbour elevation unknown"`. Verify no body extent was created. |

### 15.3 Slice 1a coverage

| File | Coverage |
|---|---|
| `flow_synthetic_contact_migration.spec.ts` | Set up a fixture project with existing `source='pinch_out_extrapolation'` contacts. Run Alembic upgrade. Open the project. Verify: no synthetic contacts remain (`GET /contacts` doesn't list them); body extents exist with `kind='extrapolated'` for the same geometries; rendering looks identical to pre-migration (wedge still drawn at the same screen position via the runtime dip-extrapolation helper). |

### 15.4 Selector convention

The DOM `data-testid` rename for the overlay happens in slice 6. Pattern:
* `data-testid="lens-wedge-{id}"` → `data-testid="body-wedge-{id}"`
* `data-testid="lens-boundary-{upper|lower}-{id}"` → `data-testid="body-boundary-{upper|lower}-{id}"`
* `data-testid="lens-node-{id}-{side}-{index}"` → `data-testid="body-node-{id}-{side}-{index}"`
* New: `data-testid="body-extent-{id}-{left|right}"` — wraps the per-side wedge so e2e can assert presence per kind.
* New: `data-testid="body-extent-dip-arrow-{id}-{side}"` — the dip-arrow glyph on `extrapolated` extents.
* New: `data-testid="body-ghost-{candidateKey}"` — auto-suggest ghosts.
* New: `data-testid="body-provenance-badge-{id}"` — inspector conflict badge.

### 15.5 Green-gate addition to slice phasing

Slice 7's green-gate (§11) extends: "All new + updated Playwright flows
above pass on the integration harness." Slice 1a's green-gate extends:
"`flow_synthetic_contact_migration.spec.ts` passes against a fixture DB
with pre-migration synthetic contacts."

---

*End of design.*
