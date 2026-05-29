# Two-stage save via replace-restore (debt #160, "B") — design

**Date:** 2026-05-29
**Status:** SHIPPED 2026-05-29 (backend slice + frontend slice). Owner: "we're going
for B"; decisions: full project reload on discard, whole-project revert scope.

**Mutation coverage (2026-05-29, expanded):** `markMutated` now fires from the contact
edits (depth drag, delete, batch), link/unlink litho↔geo, dedupe, toggle-borehole,
clear-litho-model, auto-correlate, clear-suggestions, delete (litho) model, and the
section-local edits (lens-shape save, correlation create/delete, Ctrl-drag edge
duplicate/retarget). Creates already mark dirty via `addToSessionImports`.

**Still not flagged (known, low-priority):** formation-property edits in
`GeologyInspector` (reorder / rename / colour / pin) and model **create/activate**
(deliberately excluded — the geological model is auto-created on bootstrap and
"activate" is navigation, so flagging them would dirty every project open). Add
`markMutated()` to the GeologyInspector formation handlers if dogfeed shows those edits
slipping past the close prompt.
**Origin:** owner dogfeed 2026-05-29 — "a lot of things i manually change are still in
the project after i close window without saving." Promotes debt #160 above the litho gate.

## Problem

The DB is the live source of truth: every contact drag / delete / accept writes
immediately. The dirty flag (`hasUnsavedChanges`) is purely the union of the
`sessionImport*` sets, which track **created rows only** and double as the
discard-delete manifest. So **mutations** (depth drag) and **deletes** of existing rows
neither mark the project dirty nor revert on close — they silently persist.

## Goal

Closing the window without saving reverts **all** session changes (creates, mutations,
deletes) to the last-saved state. Word/Plaxis/AutoCAD semantics.

## Approach: snapshot + whole-project replace-restore + full reload

The `.gmproj` bundle is already the canonical snapshot. We reuse it as the revert target
and add a **replace** mode to the restore path.

### 1. Backend — `POST /projects/{id}/restore?replace=true` (this slice)

The existing restore (`_restore_project_bundle_impl`) is idempotent-**insert**
(skip-existing). Replace mode runs, in the **same transaction**, a **wipe** of the
project-scoped child collections *before* that insert — so the insert then materialises
every row from the bundle against an empty project.

Collections the bundle round-trips (the wipe set):
`cpts · boreholes(+child tree) · geological_formations · geological_models(+contacts) ·
cross_sections · investigation_reviews · geotechnical_units · litho_lenses ·
formation_absences · litho_contact_correlation_edges · litho_lens_shapes ·
litho_lens_boundary_nodes`.

**Wipe strategy (verified, not assumed):** delete the top-level project-scoped entities
(`cpt`, `borehole`, `geological_formation`, `geological_model`, `cross_section`,
`investigation_review`) scoped by `app_project_id`; the child rows (formation contacts,
geotech units, lenses, shapes, boundary nodes, correlation edges, absences, borehole
observations/samples/lab) are removed by their `ON DELETE CASCADE` FKs. FK cascade map
verified against the ORM before implementing; any child whose FK is *not* CASCADE is
deleted explicitly first. The **project shell row is kept** (metadata revert is handled
by the separate metadata two-stage-save model, out of scope here).

Atomicity: wipe + insert + commit are one transaction. A failure rolls back to the
pre-call state — never a half-wiped project. `replace` defaults to `false`, so the
existing open-from-file path is unchanged.

### 2. Frontend (next slice, not this commit)

- **`lastSavedBundle`** (in-memory `ProjectFileV3`/bundle) captured at project *open* and
  after every *Save*. The revert target. Never-saved new project → empty target → discard
  wipes the session (correct).
- **`hasUnsavedMutations`** flag set by `handleUpdateContactDepth` / `handleDeleteContact`
  / etc., OR'd into `hasUnsavedChanges`. **Decoupled** from the session-import
  delete-manifest (a mutated contact must not be deleted on discard).
- **Close flow** ("Save / Don't Save / Cancel"): *Don't Save* → `POST .../restore?replace=true`
  with `lastSavedBundle` → **full project reload** from the DB.

## Tests

- **Backend integration (this slice):** create project + bundle; mutate (change a contact
  depth + delete a contact + add one); capture the saved bundle; `replace`-restore from it;
  assert the DB matches the bundle exactly — mutation reverted, deleted row back, added row
  gone. Plus: `replace=false` still skip-inserts (unchanged); replace is atomic (a bad
  payload leaves the DB untouched).
- Frontend (next slice): close-discard fires replace-restore + reload; mutations set the
  dirty flag; Cancel aborts.

## Out of scope

- Project **metadata** revert (handled by the existing metadata two-stage save).
- Per-mutation undo granularity (this is whole-project revert-to-last-save, not an undo
  stack — the section editor's `pushUndo` stays the in-session undo).
- Targeted refetch on discard (owner chose full reload).
