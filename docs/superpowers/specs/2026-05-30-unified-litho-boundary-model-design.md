# Unified litho boundary model — replace the suggestion/contact split

**Date:** 2026-05-30
**Status:** Design proposal — awaits owner sign-off before implementation
**Scope:** Litho stage (geological axis stays as today — `formation_contact` per-boundary, no parallel "suggestion" model)
**Estimated effort:** ~1 week — backend schema + migration + repository + use cases (3 days), frontend collapse (2 days), tests + docs + dogfeed (2 days)
**Supersedes (in spirit, not literally):** `docs/superpowers/specs/2026-05-30-unified-boundary-drag-design.md` (that proposed unifying the *drag mechanism*; this proposes unifying the *data model* that drag operates on)

## Problem

The litho stage today carries **two parallel representations of the same boundary**:

1. **`LithoLayerSuggestion`** — segmenter output, lives in-memory inside `BulkAnchorGhost` in `useGeologicalModel`. Per-layer record: `{depth_top_m, depth_base_m, suggested_lithology, suggested_admixtures, parent_formation_id}`. Carries the user's local edits via the `edits: Map<idx, LithoSuggestionEdit>` overlay. The accept response gives it a status via the `accepted: Set<number>` / `rejected: Set<number>` Sets.

2. **`FormationContact`** — DB row, one per boundary depth. Per-contact record: `{depth_top_m, formation_id, anchor (cpt_id|borehole_id), source, confidence}`. Created when a suggestion is accepted; survives independently after.

These two models represent the same physical thing — a litho boundary at a depth on an anchor — at different abstraction levels:

- A *suggestion* is a **layer**: an interval [top, base] with a lithology.
- A *contact* is a **boundary**: a single depth marking where a formation begins.

After accept, BOTH records coexist:

- The suggestion stays in `BulkAnchorGhost.suggestions[idx]` with `acceptedIndices.has(idx)` = true.
- The contact lives in the DB at `depth_top_m = suggestion.depth_top_m + edits.get(idx)?.depth_top_m`.

The two are kept in sync by **depth matching** — Slice 3 of the unified-boundary-drag work added cross-store dispatch (`useBoundaryDrag` → `UpdateFormationContact`), the dogfeed surfaced drift bugs, and the robust-fix follow-up added per-accepted-idx contact-id tracking (`contactIdsByAcceptedIdx` Map).

The owner's framing (dogfeed 2026-05-30):

> *"why do we even have 2 contacts, for accepted and suggested, it's just a state change"*

It is. The dual model is an artifact of how the litho stage grew: suggestions came first as an in-memory editing surface; accept turned them into committed contacts; nobody ever went back to collapse the two. Every drift bug shipped since stems from this split.

## What acceptance actually means today

The investigation that triggered this spec — *"check what happens when we accept a column, does the acceptation live on the boundaries or on the column"* — answers as follows:

- **Acceptance lives PER BOUNDARY in the data.** Each `formation_contact` row is one independent acceptance event. There is no "column-level" or "layer-level" acceptance record.
- **But the user gesture is PER LAYER.** Double-click a hatched band → "Accept layer" → creates ONE contact at the layer's top (formation = layer's lithology). The base is implicit (= next contact below, or test bottom).

The mismatch: the user thinks **layer**, the data records **boundary**. Slice 3's cross-store dispatch heuristically reconciles them.

This is also the cause of the owner's *"accept top lithology + accept bottom lithology checkbox"* observation. A boundary at depth X separates two formations: `F_above` (the layer above) and `F_below` (the layer below). In the current schema:

- `F_below` is set by the contact at X — its `formation_id`.
- `F_above` is set by the PREVIOUS contact (at a shallower depth) — its `formation_id`.

For a boundary to be **fully defined** (both adjacent formations confirmed), the contact at X AND the contact above X both need to be accepted. If only one is accepted, the boundary is half-known.

That is what the owner's checkboxes describe: in a per-boundary acceptance model, each boundary needs explicit confirmation of both its above-formation and its below-formation. That maps to two distinct contacts being accepted, which is awkward gesture-wise (the user has to accept the layer above AND the layer below to make their shared boundary "complete").

The cleaner answer is to move acceptance from the BOUNDARY level (where it lives today) to the LAYER level (where the user's mental model puts it). Then a boundary's "complete" state is **derived** from the two adjacent layers' statuses — no separate checkbox needed.

## Goal

One model. One record per layer interval per anchor per litho model. Status is `pending | accepted | rejected`. All edits — depth, formation, status, composition — happen on this single record. The "boundary" is derived from two adjacent same-anchor layers' shared depth. Slice 3's cross-store dispatch retires entirely.

## Non-goals

- **Geological axis.** Unchanged. Geological boundaries are persisted as `formation_contact` rows representing the TOP of a formation surface; the model has no in-memory "suggestion" layer. No conflict to resolve.
- **Segmenter.** Unchanged. The Robertson-2015 / borehole segmenter still emits `LithoLayerSuggestion` items at suggest-time — but they are persisted directly to `litho_layer` rows with `status='pending'` instead of held in `BulkAnchorGhost.suggestions[]`.
- **Auto-correlation across anchors.** Unchanged. `litho_correlation_edge` still references contact ids; the migration translates them to layer-shared-boundary references.
- **Formation vocabulary.** Unchanged. Project-scoped `geological_formation` rows (litho kind) stay as the formation catalog. Layers reference formations via FK.
- **The unified-drag spec from earlier today.** That spec proposed unifying the *drag mechanism* (one bound walker across pending + committed). This spec proposes unifying the *data model* the drag operates on. The drag mechanism then collapses naturally — no more cross-store dispatch because there is no other store.

## Recommendation

**Two reasonable shapes. Recommendation: Shape A (layer-centric).**

### Shape A — Layer-centric. Replace `formation_contact` (for litho models) with `litho_layer`.

A new table records the LAYER as the primitive unit. Boundaries are derived.

```sql
CREATE TABLE litho_layer (
  id                UUID PRIMARY KEY,
  litho_model_id    UUID NOT NULL REFERENCES geological_model(id) ON DELETE CASCADE,
  cpt_id            UUID REFERENCES cpt(id) ON DELETE CASCADE,
  borehole_id       UUID REFERENCES borehole(id) ON DELETE CASCADE,
  formation_id      UUID NOT NULL REFERENCES geological_formation(id) ON DELETE RESTRICT,
  depth_top_m       NUMERIC(10, 4) NOT NULL,
  depth_base_m      NUMERIC(10, 4) NOT NULL,
  status            litho_layer_status NOT NULL DEFAULT 'pending',
  source            litho_layer_source NOT NULL,
  confidence        litho_layer_confidence NOT NULL,
  notes             TEXT,
  parent_geo_contact_id  UUID REFERENCES formation_contact(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_one_anchor CHECK ((cpt_id IS NULL) <> (borehole_id IS NULL)),
  CONSTRAINT chk_depth_ordered CHECK (depth_top_m < depth_base_m)
);

CREATE TYPE litho_layer_status AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE litho_layer_source AS ENUM ('segmenter', 'manual', 'observation_layer');
CREATE TYPE litho_layer_confidence AS ENUM ('low', 'medium', 'high');

CREATE INDEX idx_litho_layer_model_cpt    ON litho_layer (litho_model_id, cpt_id, depth_top_m);
CREATE INDEX idx_litho_layer_model_bh     ON litho_layer (litho_model_id, borehole_id, depth_top_m);
CREATE INDEX idx_litho_layer_status       ON litho_layer (litho_model_id, status);
CREATE INDEX idx_litho_layer_formation    ON litho_layer (formation_id);

-- Pending layers may overlap accepted ones (the user is exploring an
-- alternative); the renderer ranks them. No exclusion constraint at
-- the DB; the renderer's sort+sweep handles overlap visually.
```

**A boundary at depth X on anchor A in model M is derived: SELECT the layer whose `depth_top_m = X` (the formation BELOW X) and the layer whose `depth_base_m = X` (the formation ABOVE X), both with `status = 'accepted'`.** If both exist, the boundary is fully defined.

#### What acceptance now means

- **Accept a layer** = `status` transitions to `accepted`. One row mutation. No new record created. No depth-matching anywhere.
- **Accept a column** = N layer status transitions in one transaction. Same gesture as accept-all today.
- **Reject a layer** = `status` transitions to `rejected`. The row survives (so un-reject restores it; matches today's UX). Optionally soft-deleted after a project save.
- **Drag a boundary** = update two layers' shared depth atomically: the upper layer's `depth_base_m` AND the lower layer's `depth_top_m` move to the same new depth. One transaction. No PATCH dispatch logic, no contact-id mapping.

The owner's "accept top lithology / accept bottom lithology" question evaporates: each layer is independently accepted; a boundary is fully defined when both adjacent layers are accepted. No per-boundary checkbox is needed because the boundary's state is *derived* from the two layers' states. The UI can surface this as a visual gradient (e.g., dashed half-line when only one side is accepted, solid line when both are).

#### Frontend collapse

- `BulkAnchorGhost.suggestions[]` retires. The hook reads layers from the API.
- `BulkAnchorGhost.accepted`, `BulkAnchorGhost.rejected`, `BulkAnchorGhost.edits`, `BulkAnchorGhost.contactIdsByAcceptedIdx` — all retire.
- `LithoSuggestionGhostColumns` and `ContactsLayer` merge into one renderer (or stay separate but read from the same layer source — the boundary between "ghost" and "committed contact" is just a `status` filter).
- `useBoundaryDrag` becomes the boundary-drag hook for ALL layers (pending or accepted), with one commit path: `PATCH /litho_layer/{id}` for the dragged layer and the neighbour layer atomically.
- `applyCrossMergeOnDrag` retires. Cross-merge becomes a server-side operation on the two layer rows.

### Shape B — Boundary-centric with `status`. Add a `status` column to `formation_contact`.

Lighter migration. Keep the boundary-centric DB. Drop the `LithoLayerSuggestion` in-memory list. Each contact has `status = pending | accepted | rejected`. The "layer" abstraction is a pure UI derivation.

```sql
ALTER TABLE formation_contact
  ADD COLUMN status litho_contact_status NOT NULL DEFAULT 'accepted';

CREATE TYPE litho_contact_status AS ENUM ('pending', 'accepted', 'rejected');

-- Pre-existing rows backfill to 'accepted' (legacy contacts pre-dated
-- the dual model so they were always committed).
```

#### What acceptance now means in Shape B

- **Accept a layer** = `UPDATE formation_contact SET status='accepted' WHERE id = <layer's top-contact-id>`. The base is implicit (= next contact's depth).
- **Accept a column** = N status updates.
- **A boundary is "fully defined"** = the contact AT X is accepted AND the contact at the next-shallower depth (defining the formation above) is accepted.
- **Drag a boundary** = `UPDATE formation_contact SET depth_top_m = new_depth WHERE id = X`. The "boundary at depth X" is identified by the contact id; the formations on either side don't need to be touched.

This matches the owner's *"accept top lithology / accept bottom lithology"* observation literally: a boundary's full acceptance state is a function of TWO contacts (this one + the one above). The UI either:

- Renders each boundary with two half-indicators (top half = above contact status, bottom half = this contact status), which gives the owner literal checkboxes; OR
- Aggregates into one indicator (both accepted = solid; one accepted = dashed half; neither = pending hatched), which hides the dual nature but matches the layer mental model.

#### Frontend collapse in Shape B

- `BulkAnchorGhost.suggestions[]` retires. The hook reads contacts from the API.
- `BulkAnchorGhost.accepted` / `rejected` retire — status lives on the contact row.
- `BulkAnchorGhost.edits` retires — depth edits become direct PATCH calls (with optimistic local state for the live drag).
- The "layer" rendering composes adjacent contacts into bands. ContactsLayer already does this for the committed side; the pending contacts join the same pipeline.

### Recommended: Shape A

The data model that maps cleanest to the user's mental model is **Shape A — layer-centric.** Reasons:

1. **The user gesture is per-layer.** Accept gestures, drag gestures, reject gestures — all operate on a layer ("this band of SAND between 4 and 6 metres"). Matching the data model to the gesture eliminates the entire "boundary-side ambiguity" the owner flagged.
2. **The "fully accepted boundary" question disappears.** No per-side checkbox needed — a boundary is defined when both adjacent layers are accepted. The UI can still surface partial states visually (half-dashed lines), but it's a *rendering* concern, not a data shape.
3. **The dragged boundary atomically owns two layer rows.** Today's cross-merge / shared-boundary-commit / cross-store-dispatch logic — three separate code paths trying to keep top-of-formation and base-of-formation in sync — collapses into one operation: drag the shared depth, update both rows.
4. **Slice 3's robust-fix becomes unnecessary.** No contact-id-by-accepted-idx mapping, no depth-matching, no `committedContactsForAnchor`, no `onContactLivePreview` plumbing, no cross-store dispatch at all. Most of today's drag code is reaction to the dual model; collapsing the model collapses the code.
5. **Phase 5+ extensions are simpler.** Per-layer NAD class, per-layer Robertson Ic SBT zone, per-layer Dr, per-layer γ-estimate — all the geotech subdivision data — naturally hangs off a layer row instead of being inferred from contact-pairs.

The cost is a heavier migration (new table, data translation, new repository, new use cases). Roughly 50% more backend work than Shape B; the frontend collapse is similar.

The rest of this spec assumes **Shape A**. Shape B can be assembled from the same architectural moves if the owner prefers the lighter migration.

## Detailed design — Shape A

### Domain model

```python
# src/groundmodel/domain/models/litho_layer.py
@dataclass(frozen=True)
class LithoLayer:
    id: UUID
    litho_model_id: UUID
    anchor: AnchorRef  # union of cpt_id | borehole_id
    formation_id: UUID
    depth_top_m: float
    depth_base_m: float
    status: LithoLayerStatus  # pending | accepted | rejected
    source: LithoLayerSource  # segmenter | manual | observation_layer
    confidence: LithoLayerConfidence  # low | medium | high
    notes: str | None
    parent_geo_contact_id: UUID | None  # geo backbone link (debt #162)
    created_at: datetime
    updated_at: datetime
```

A **boundary** is not a stored entity. It is a *view* over the layer table: `SELECT depth_top_m FROM litho_layer WHERE anchor=? AND litho_model_id=? ORDER BY depth_top_m`. Each row's `depth_top_m` IS a boundary; the formation above is the previous row's `formation_id`; the formation below is this row's `formation_id`.

### API surface (new endpoints, geological axis untouched)

```
POST   /projects/{pid}/litho-models/{mid}/layers                # Bulk-create pending layers (segmenter output)
GET    /projects/{pid}/litho-models/{mid}/layers?anchor=...     # List per-anchor layers (or all)
PATCH  /projects/{pid}/litho-models/{mid}/layers/{lid}          # Single-layer mutation (depth / formation / status)
PATCH  /projects/{pid}/litho-models/{mid}/layers/boundary-move  # Atomic: { upper_layer_id, lower_layer_id, new_depth_m }
POST   /projects/{pid}/litho-models/{mid}/layers/batch-status   # Bulk status change ("accept all", "reject all")
DELETE /projects/{pid}/litho-models/{mid}/layers/{lid}          # Hard delete (rare — usually status='rejected' instead)
```

The `boundary-move` endpoint is the critical one: it accepts two layer ids and one new depth, and atomically updates both rows in a single transaction. No more cross-store dispatch.

### Migration from `formation_contact`

```sql
-- For each (litho_model_id, anchor) pair, pair consecutive contacts by depth.
-- Each contact_i, contact_{i+1} pair becomes a layer:
--   formation_id   = contact_i.formation_id
--   depth_top_m    = contact_i.depth_top_m
--   depth_base_m   = contact_{i+1}.depth_top_m
-- The DEEPEST contact's layer ends at:
--   - the test bottom for CPTs (cpt.max_depth_m)
--   - the borehole's total_depth_m for boreholes
-- All migrated layers get status='accepted', source='manual_pick' (or
-- the contact's source where available), confidence=contact.confidence.
```

This is a backfill migration — no data loss, all existing committed boundaries become accepted layers. Per-anchor layer ordering is preserved.

`formation_contact` rows for litho models are then DROPPED. `formation_contact` survives for geological models (kind='geological') only — we're explicitly NOT changing the geological axis.

### Bundle (`.gmproj`) compatibility

The `.gmproj` v3 bundle currently serialises `formation_contact` rows. After this work it will need to serialise `litho_layer` rows for litho models AND `formation_contact` for geological models.

**`format_version` bumps from 3 to 4.** The CLAUDE.md backwards-compat suspension is still in force pre-shipping (per the 2026-05-16 owner directive), so we can cut over cleanly without a v3→v4 upgrade chain. When the suspension lifts at first external distribution, v4 becomes the floor.

### Frontend collapse

```
useGeologicalModel.ts (changes):
  - LithoSuggestionEdit:              retired
  - BulkAnchorGhost.suggestions:      retired (replaced by `layers: LithoLayer[]`)
  - BulkAnchorGhost.accepted/rejected:retired (status on each layer row)
  - BulkAnchorGhost.edits:            retired (PATCH calls)
  - BulkAnchorGhost.contactIdsByAcceptedIdx: retired
  - handleEditLithoSuggestion:        replaced by handleUpdateLithoLayer (single PATCH)
  - handleEditBulkLitho:              same
  - applyCrossMergeOnDrag:            retired (cross-merge is a server-side operation)
  - acceptLithoSuggestions wrapper:   becomes a thin PATCH /batch-status call

useBoundaryDrag.ts:
  - committedContactsForAnchor:       retired
  - contactIdsByAcceptedIdx:          retired
  - onUpdateContactDepth:             retired
  - onContactLivePreview:             retired (the local optimistic state on the layer row IS the live preview)
  - resolveContactForAcceptedNeighbour: retired
  - handleUp commit path:             one PATCH /boundary-move call

LithoSuggestionGhostColumns + ContactsLayer:
  - Merge into one renderer: `LithoLayerBandColumns`. Reads `layers: LithoLayer[]`,
    renders bands. Visual treatment varies by status:
      pending  → diagonal hatched, accept/reject icons
      accepted → solid fill at the formation's color
      rejected → strikethrough at 20% opacity
  - The boundary line between two same-anchor layers is the layer's shared depth.
    Stroke style is derived: solid when both adjacent layers are accepted,
    dashed when at least one is pending, hairline when one is rejected.

SectionsCanvas:
  - The lithoGhostState bundle simplifies dramatically. Most of the
    Slice 3 / robust-fix plumbing (committedContactsForAnchor,
    contactIdsByAcceptedIdx, onUpdateContactDepth, onContactLivePreview)
    is gone.
```

### The boundary-rendering question (owner's "checkbox" framing)

In Shape A there is NO per-boundary acceptance checkbox. Instead the boundary renders as a function of the two adjacent layers' statuses:

```
above accepted, below accepted   → solid line (fully defined)
above accepted, below pending    → top half solid, bottom half dashed
above pending,  below accepted   → top half dashed, bottom half solid
above pending,  below pending    → fully dashed (suggested)
above accepted, below rejected   → top half solid, bottom half hairline (rejected)
above rejected, below rejected   → hairline (likely deleted in next save)
```

The owner gets the "accept top / accept bottom" semantics for free: they accept the LAYER above (which solidifies the top half of that boundary) and the LAYER below (which solidifies the bottom half). One gesture per layer, derived rendering per boundary.

If the owner wants explicit per-side checkboxes (e.g., for a UI like "this boundary is fully agreed-on, lock it"), that's a separate "boundary lock" feature on top of the layer model — a new column on `litho_layer` flagging "this layer's top boundary is locked, do not let drag move it." Out of scope for this spec.

## Slicing

Land in five slices. Each slice ships independently; the dual model survives until Slice 4 retires it.

### Slice A1 — Backend: `litho_layer` table + repository + read-path API

New table, new ORM model, new repository, new use cases (`ListLithoLayersForAnchor`, etc.), new API endpoints. Existing `formation_contact` flow untouched. Frontend ignores the new endpoints.

Backfill migration populates `litho_layer` rows from existing `formation_contact` rows so the new data shape can be inspected/queried in dev without breaking the old flow.

**Owner-visible:** nothing. **Effort:** ~2 days.

### Slice A2 — Backend: write-path API + mutation use cases

`PATCH /layers/{lid}`, `PATCH /layers/boundary-move`, `POST /layers/batch-status`, `POST /layers` (bulk-create from segmenter). The two write paths coexist: old `acceptLithoSuggestions` still works, new layer-mutation endpoints also work. Each write path keeps `litho_layer` in sync with `formation_contact` while both exist (dual-write transitional state).

**Owner-visible:** nothing. **Effort:** ~1 day.

### Slice A3 — Frontend: switch the renderer to read from `litho_layer`

The frontend hook now reads from the new endpoints. Suggestions still come from the segmenter but are immediately persisted as `litho_layer` rows with `status='pending'`. `BulkAnchorGhost.suggestions[]` becomes a thin cache of those rows. Accept gestures now PATCH the row's status instead of calling `acceptLithoSuggestions`. The renderer reads layer rows and varies visual treatment by status.

The dual model exists at the data level (both tables) but the frontend only writes to `litho_layer`. `formation_contact` is read-only for litho rows in this slice.

**Owner-visible:** the gap bug class disappears (no more drift). Drag-at-any-stage works trivially because there's no cross-store dispatch. **Effort:** ~2 days.

### Slice A4 — Backend: retire `formation_contact` for litho models

Drop the dual-write. Migrate any remaining litho `formation_contact` rows. Drop the litho rows from the table (geological rows stay).

Bundle `.gmproj` format bumps from v3 to v4. Existing CLAUDE.md backwards-compat suspension lets us cut over cleanly.

**Owner-visible:** nothing (data is identical, table is different). **Effort:** ~1 day.

### Slice A5 — Frontend: drop the dual-model scaffolding

`LithoSuggestionEdit`, `BulkAnchorGhost.{accepted, rejected, edits, contactIdsByAcceptedIdx}`, `applyCrossMergeOnDrag`, `useBoundaryDrag.{committedContactsForAnchor, contactIdsByAcceptedIdx, onUpdateContactDepth, onContactLivePreview, resolveContactForAcceptedNeighbour}` all retire. Pure code deletion.

**Owner-visible:** nothing (already retired functionally in A3). **Effort:** ~½ day.

Total: **~6.5 working days**, end to end.

## Risks

- **Geological / litho contact divergence.** The geological axis keeps `formation_contact`; the litho axis moves to `litho_layer`. The repository layer needs two code paths. Risk: the unified UI rendering layer needs to handle both shapes. Mitigation: introduce a thin "boundary view" abstraction in the application layer that both data shapes adapt to.
- **`litho_correlation_edge` references contact ids.** The correlation graph from auto-correlate currently points at contact ids. Migration needs to translate these to (layer_id, edge: 'top' | 'base') tuples. Or just bump the edge table to reference layer ids directly (the user-facing identity is "boundary at this anchor at this depth", which a layer's top edge represents).
- **`cross_section.seeded_formation_contact_ids` references contact ids.** Same translation problem. The seeded ids array would become `seeded_litho_layer_ids` (or stay as boundary identifiers via a (layer_id, edge) pair).
- **Bundle compatibility.** `.gmproj` v3 carries contacts; v4 carries layers for litho + contacts for geological. Backward-compat suspension is still in force, so we can cut over. After suspension lifts, every save is v4-or-later.
- **Undo stack.** Current `pushAcceptLithoUndo` revert/reapply pairs assume contact ids. The undo entries already store the contact ids that the API returned; after the switch they'd store the layer ids that the new PATCH affected. Existing entries from pre-cutover saves would be on dropped IDs; the undo stack is wiped on project open today (it isn't bundled), so no compat shim needed.
- **Segmenter cost.** Currently the segmenter returns suggestions in-process (no DB write). After the cutover each suggest-cycle persists N rows. For 76-anchor bulk-suggest this is ~1000 INSERTs in one transaction. Already what `acceptLithoSuggestions` does today; the cost shifts earlier.

## Backwards compatibility

CLAUDE.md "Backwards Compatibility" rules are currently SUSPENDED for pre-ship development (owner directive 2026-05-16). This work is squarely inside that suspension — we can change the `.gmproj` format and drop tables freely. The re-arm trigger (first external distribution / coworker binary handoff) is still ahead of us.

If this work lands AFTER the re-arm trigger, the migration becomes a v3 → v4 upgrade chain rather than a cutover. The `format_version` bump is the only externally-visible change either way.

## Open questions for owner sign-off

1. **Shape A vs Shape B.** Spec recommends A (layer-centric). B (boundary-centric with status column) is cheaper but leaves the "per-side acceptance" awkwardness. Confirm direction.

2. **Boundary rendering style.** When one adjacent layer is accepted and one is pending, the spec proposes half-solid / half-dashed line. Alternative: render the boundary fully dashed (treat any non-fully-accepted boundary as suggestive). What's the right read?

3. **Cross-merge semantics on the server.** Today's `applyCrossMergeOnDrag` is in the React renderer (in `lithoLayerMerge.ts`). After cutover, the merge happens server-side in the `boundary-move` use case. Confirm this is acceptable — it shifts test surface from frontend Vitest to backend pytest.

4. **Slicing cadence.** Spec proposes five slices over ~6.5 days. Land them as one continuous push, or commit after each slice for dogfeed-validation checkpoints?

5. **`litho_correlation_edge` migration.** Edge table FKs to contact ids. Two options: (a) translate to layer ids at migration time, (b) keep the edge table referencing contact ids and migrate the contact ids to layer ids 1:1 (one row per accepted-layer-top). Option (b) is mechanically simpler.

## What this work does NOT solve

- **Geological axis modeling.** Geological boundaries stay as `formation_contact`. The dual-model problem doesn't exist there (no suggestion layer).
- **Per-anchor cross-correlation.** The correlation graph between anchors stays. The migration translates edge references but doesn't change the graph.
- **NAD packing-class / Dr / Ic / γ-estimate per layer.** These are MVP outputs that hang off layers in Phase 4 / Phase 5. The new `litho_layer` table is the natural carrier (extension columns) but adding them is a separate slice.
- **Multi-anchor "drag this boundary on every anchor at once" gesture.** Today only single-anchor drag is supported. Layer-centric storage makes the multi-anchor case easier (each anchor's layers are independent rows) but the feature is its own design.

## Relationship to the in-flight unified-boundary-drag work

The earlier-today spec at `docs/superpowers/specs/2026-05-30-unified-boundary-drag-design.md` proposed unifying the drag mechanism across pending and committed boundaries. That work has shipped (Slices 1+2+3+4 today). After this spec lands, most of those drag-coordination affordances become unnecessary because there is no longer a pending vs. committed distinction in the data model.

In particular:

- `useBoundaryDrag.committedContactsForAnchor` and the resolver retire.
- `useBoundaryDrag.contactIdsByAcceptedIdx` (the robust-fix Map) retires.
- `useBoundaryDrag.onUpdateContactDepth` and `onContactLivePreview` retire.
- `SectionsCanvas.lithoSuggestionContactPreview` state retires.
- `ContactsLayer.liveContactDepthOverride` prop retires.

The unified-drag work was the **right thing to ship** for the current architecture; this work makes it gracefully retire. No duplicate effort — the drag mechanism that survives is the simpler one (single source of truth, no cross-store reconciliation).
