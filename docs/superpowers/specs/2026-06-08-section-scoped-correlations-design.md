# Section-scoped correlation edges — design

**Date:** 2026-06-08
**Status:** approved (owner 2026-06-08); spec for review → plan → implement
**Surface:** correlation edge model + 2D ribbon rendering + per-section Accept/Auto-correlate
**Origin:** dogfeed regression — after "classification follows the test" shipped
(2026-06-08), correlation ribbons authored on one cross-section started rendering
on every other section that projects both endpoint tests. Owner: "the correlations
carried over to the new cross section? I specifically asked to keep the correlation
bands cross-section specific, because I might draw a perpendicular [section] and
I'll need new correlations to go to 3D."

---

## Problem

`litho_contact_correlation_edge` is **model-level** — it has no `section_id`. Its
apparent section-specificity was an emergent side effect of the old explicit-content
gate: `CorrelationEdgesOverlay` positions each edge off the section's rendered
contacts, and an edge draws only when **both** endpoint contacts are in that set.
Before "classification follows the test", that set was the per-section
`seeded_formation_contact_ids`, so ribbons stayed on the section where their
endpoints were seeded.

The 2026-06-08 classification change swapped the rendered-contact set from the
seeded set to the **in-corridor projection**. Edges now draw on any section that
projects both endpoint tests — the carry-over.

Re-gating ribbons on the seeded set will **not** fix this: the live project's
seeded sets are large and overlapping (Cross-section 1: 250, 2: 299, 3: 172,
4: 60 contacts), because the accept/seed/draw flows have been seeding the same
model-level contacts onto every section. The seeded set is no longer a clean
per-section scope for correlations.

## Decision

Give correlations their **own explicit section scope**: add `section_id` to the
correlation edge. A correlation is **authored on a section, for that section's
interpretation, and displayed only on that section.** This matches the owner's
mental model and the geology: on a perpendicular cut a test's adjacency differs,
so the valid correlations differ per section.

`section_id` scopes **2D ribbon rendering** and the **per-section
Accept/Auto-correlate** verbs. It does **not** change body resolution.

## What stays model-level (deliberately unchanged)

`ResolveLithoInstances` assigns `litho_layer.body_id` from **all** user-approved
edges for the model, with no section in scope (`resolve_litho_instances_use_case.py`
lines 11-14, 193). This is correct and stays: the 3D body is the **union** of every
section's correlations (transitive closure). Section 1 (E–W) correlates A↔B; the
perpendicular section (N–S) correlates A↔C; the body is {A,B,C}. Each section
authors its own adjacency; 3D merges them. Owner-confirmed 2026-06-08: "union into
one shared 3D model."

Consequence: `section_id` is additive to the authoring/rendering layer. The
resolver, partition fill, body bands, `body_id`, and 3D path need **no change**.

## Approach

### 1. Schema + migration (clean slate)

- Add `litho_contact_correlation_edge.section_id UUID NOT NULL`, FK →
  `cross_section(id)` `ON DELETE CASCADE`. Deleting a section deletes the
  correlations authored on it; `body_id` re-resolves (the union shrinks) on the
  next resolver run.
- Index `section_id` (the render fetch filters on it).
- **Clean slate (owner choice):** the migration `DELETE`s all existing edges
  before adding the NOT-NULL column (the 307 live edges have no section linkage
  to backfill and re-correlating per section is one click — Auto-correlate →
  Accept). The downgrade re-creates the column drop only; the deleted rows are
  not restorable (acceptable pre-ship — backwards-compat suspended).
- **Consequence to surface in the plan + to the owner:** deleting all edges
  dissolves existing bodies → litho bands render per-column until the owner
  re-correlates. Re-running Auto-correlate → Accept per section rebuilds the
  ribbons **and** the bodies, now section-stamped.

### 2. Authoring — stamp the section

- `CorrelateLithoContacts.execute` and `AutoCorrelateContactEdges.execute` already
  receive `request_section_id` / `section_id`. Persist it onto every created
  `LithoContactCorrelationEdgeOrm` row as `section_id`.
- A correlation created with no section in context is a programming error — the
  gesture is always on a section. The use case raises if `section_id` is None
  (NOT NULL column would otherwise fail at flush; raise early with a clear message).

### 3. Render gate

- `GET …/models/{mid}/contact-correlations` gains an **optional** `section_id`
  query param. When present, the endpoint filters edges to that section.
- `SectionsCanvas.refetchContactEdges` passes `selectedSectionId`, so only the
  selected section's ribbons render. Classification (contacts + accepted litho)
  is unchanged — it stays on the in-corridor gate.
- Omitting `section_id` returns all model edges (back-compat for any model-level
  consumer; the section view always passes it).

### 4. Accept re-scope

- Section-scoped `AcceptContactCorrelations` currently selects unapproved edges by
  the seeded-set intersection (`accept_contact_correlations.py` lines 175-185).
  Replace that with `LithoContactCorrelationEdgeOrm.section_id == section_id`.
- This also closes the follow-up gap from the classification change (the section
  Accept button could miss correlations between auto-shown-but-unseeded contacts):
  the render gate and the accept gate now read the **same** section scope.
- The Auto-correlate "re-correlate?" pre-check (`SectionsToolbar`,
  `listContactCorrelations` count of unapproved auto edges) counts edges **for the
  current section** only — pass `section_id` to the count fetch.

### 5. Bundle (.strix)

- The edge serializer includes `section_id`. On restore, any edge lacking a
  `section_id` (legacy bundle) is **dropped** — consistent with the clean slate.
  Going forward edges round-trip with their section. No `format_version` bump
  (pre-ship amnesty, same as the body-extent retirement).

## Ripple to verify during implementation

1. **Auto-correlate adjacency** (`AutoCorrelateContactEdges`) already scopes by
   `section_id` for the section-along adjacency (2026-05-29 batch); confirm the
   created edges now also store it.
2. **Other edge consumers** — `materialise_body_companions`,
   `merge_enclosed_lens_bodies`, `propagate_litho_admixtures`,
   `accept_litho_suggestions`, `clear_litho_model`, `delete_litho_layer` query
   edges by `model_id` for body/admixture work. These are model-level and must
   stay model-level (they serve the union). Confirm none need a section filter and
   none break on the new NOT-NULL column.
3. **`ON DELETE CASCADE`** — deleting a section must cascade-delete its edges
   without orphaning `body_id` (resolver re-runs on the next mutation/open).
4. **Frontend overlay** — `CorrelationEdgesOverlay` needs no change if the fetch
   is already section-filtered (it renders whatever edges it's given); verify it
   doesn't independently re-derive cross-section edges.
5. **Correlate-mode gate** (`SectionsToolbar.sectionHasLithoContacts`) — unchanged;
   it gates on in-corridor litho contacts, not edges.
6. **Test factories + synthetic e2e fixture** — any builder that creates a
   `LithoContactCorrelationEdgeOrm` (unit/integration factories,
   `build_synthetic_fixture.py`) must stamp a valid `section_id` once the column
   is NOT NULL, or it will fail at flush. Grep for edge construction in tests +
   the fixture builder and add a section.

## Non-goals

- Changing body resolution / `body_id` / partition fill / 3D (stays model-level
  union — owner-confirmed).
- Backfilling the 307 legacy edges (clean slate — deleted, re-correlated).
- A "copy correlations from another section" convenience (YAGNI; re-correlate is
  one click).
- Per-section independent 3D (explicitly rejected — union is the intent).

## Testing

- **Schema/migration:** migration empties the edge table and the NOT-NULL column
  applies; a new edge requires `section_id`.
- **Authoring:** a manual correlate and an auto-correlate on section S stamp
  `section_id = S` on the created edges.
- **Render scope:** an edge authored on section S is returned by the
  `section_id=S` fetch and **absent** from a `section_id=S2` fetch (S2 projects the
  same two tests). This is the regression's direct assertion.
- **Accept scope:** section-scoped Accept on S approves only S's edges; an edge on
  S2 is untouched.
- **Resolver unchanged:** two edges on different sections that connect a chain
  A–B (S1) and B–C (S2) still resolve A,B,C into **one** body (union holds).
- **Bundle:** an edge round-trips with `section_id`; a legacy edge without one is
  dropped on restore.
- **Frontend:** `SectionsCanvas` renders only the selected section's ribbons;
  drawing a second section through the same tests shows no carried-over ribbons.
