# God-component decomposition plan (debt #114, extended)

**Status:** planned, not started. Execute **after** the current dogfeed pass —
the React splits carry TDZ / hook-ordering / dep-array regression risk that
must not land under a live dogfeed session.

**Why now-as-a-plan:** five files dominate the codebase by size. None is a
single unreadable mega-function; the problem is *file size + mixed concerns in
one module*, which is the lower-risk kind of "god component" to fix — most moves
are **extractions of already-separable units**, not rewrites. Order below is
strictly lowest-risk → highest-risk so we can stop at any point and still have
banked value.

Measured line counts (2026-06-04):

| File | Lines | Kind | Risk to split |
|---|---|---|---|
| `hooks/useGeologicalModel.ts` | 5,180 | React hook (47 handlers, 23 `useState`) | **High** (hook ordering, dep arrays, TDZ) |
| `components/sections/ContactsLayer.tsx` | 4,249 | React component + pure geometry | **Medium** (pure parts are safe; drag state machine is not) |
| `components/SectionPanel.tsx` | 3,709 | React component (60 hooks) | **Medium-High** |
| `api/client.ts` | 3,201 | API client (flat fn list) | **Low** |
| `infrastructure/db/repositories/project_bundle.py` | 2,682 | backend (already ~40 helpers) | **Low** (well-tested, no hooks) |

The verification bar for **every** move below: `npm test` (Vitest) +
`tsc --noEmit -p tsconfig.web.json` green for FE; `pytest tests/unit` + the
bundle round-trip integration test green for BE. One file per commit.

---

## Move 1 — `project_bundle.py` → module split (LOW risk, do first)

**Current:** one 2,682-line module already factored into ~40 module-level
`_to_json` / `_*_to_dict` / `_build_*` / `_restore_*` helpers + a thin
`ProjectBundleService` facade. The size, not the structure, is the problem.

**Split by concern into a `project_bundle/` package** (keep
`project_bundle.py`'s public names re-exported so no caller changes):

- `bundle_serialization.py` — `_to_json`, `_from_json`, `_column_to_json`,
  `_apply_json_to_kwargs`, all `_*_to_dict`, `_geological_model_to_dict`.
- `bundle_build.py` — `_build_project_bundle_impl`.
- `bundle_row_builders.py` — `_make_location`, `_build_cpt/_borehole/`
  `_observation/_layer/_sample`, `_cap`, `_uuid`, `_series_row_count`.
- `bundle_restore_core.py` — `_wipe_project_scoped_rows`, `_restore_cpts/`
  `_boreholes/_formations/_geotech_units/_flat_rows`, `_build_valid_*_ids`,
  `_restore_cross_sections/_investigation_reviews`, `_restore_project_bundle_impl`.
- `bundle_restore_litho.py` — `_restore_geological_models`, `_restore_bodies`,
  `_restore_formation_absences`, `_restore_contact_edges`,
  `_restore_lens_shapes_and_nodes`, `_attach_companion_lens_links`.
- `project_bundle.py` (facade) — `BundleIntegrityError`, `ProjectBundleService`,
  `build_project_bundle`, `restore_project_bundle`. Re-exports the rest.

**Risk:** low — pure function moves + import updates; the bundle round-trip
integration test (`tests/integration/.../test_*bundle*`) is the regression net.
This resolves the backend half of #114 outright.

---

## Move 2 — `api/client.ts` → per-domain client modules (LOW risk)

**Current:** ~3,200 lines of flat exported `async function` API wrappers +
their request/response types.

**Split** by API domain into `api/clients/` (cpt, borehole, project, geology,
sections, bodies, correlations, export) with a barrel `client.ts` re-exporting
everything. Types co-locate with their client. No behaviour, pure mechanical;
`tsc` + Vitest are sufficient. Do alphabetically, one domain per commit.

**Risk:** low — no React, no state; a missed re-export fails `tsc` immediately.

---

## Move 3 — `ContactsLayer.tsx` → extract pure geometry + subcomponents (MEDIUM)

**Current:** 4,249 lines mixing (a) pure geometry (`computeSlabsAndPolylines`
and its interfaces `LayerSlabData` / `PolylineVertexData` / `RenderedLayer` /
…), (b) pure helpers (`clamp`, `truncateToWidth`, `columnUnderCursor`,
`surfaceYForColumn`, `isTypingTarget`), (c) the `ContactContextMenu`
subcomponent, and (d) the stateful drag state machine (`DragState`).

**Order (safe → less safe):**
1. `contactsLayerGeometry.ts` — move `computeSlabsAndPolylines` + the geometry
   interfaces + pure helpers. **No React** → unit-testable; the existing
   `ContactsLayer.test.tsx` (3,139 lines) already pins behaviour. *This is the
   single biggest, safest win in the FE set.*
2. `ContactContextMenu.tsx` — move the menu subcomponent + its props interface.
3. Leave the drag state machine in `ContactsLayer.tsx` (do **not** split the
   `DragState` reducer logic — that's the regression-prone core; slimming the
   file around it is enough).

**Risk:** medium. Step 1/2 are extractions; the drag core is untouched. Verify
with the existing 3k-line test file + `tsc`.

---

## Move 4 — `SectionPanel.tsx` → extract subcomponents + effects (MEDIUM-HIGH)

**Current:** 3,709 lines, 60 hook calls, a large JSX return, an inline
`CanvasHints` subcomponent, and native `wheel` / `keydown` effect blocks
(the passive-listener + spacing-warp logic).

**Order:**
1. `CanvasHints.tsx` — already a self-contained subcomponent at the file tail;
   move it + its props. Trivial.
2. Extract the native-event effects (`wheel` zoom-at-cursor, `keydown`
   shortcuts) into `useSectionCanvasGestures.ts` — **carefully**, preserving the
   `{ passive: false }` attach + the spacing-warp anchor reads
   (`feedback_section_view_spacing_modifier` is load-bearing here).
3. Extract render-only sub-regions (toolbar row, overlay stack wiring) into
   subcomponents only where they don't share mutable drag state.

**Risk:** medium-high — the gesture effects touch the spacing-warp transform
that has bitten twice before. Each step needs a render-across-the-boundary
regression test (per `feedback_new_hook_above_early_return`).

---

## Move 5 — `useGeologicalModel.ts` → domain sub-hooks (HIGH risk, do last)

**Current:** 5,180 lines; the hook body (from line ~823) has 23 `useState` and
47 `handle*` `useCallback`s spanning formation CRUD, contact CRUD, geological
model ops, litho model ops, and litho suggestions.

**Target shape — `useGeologicalModel` becomes a composer** that owns the shared
state and delegates handler clusters to focused sub-hooks:

- `useFormationCrud` — `handleFormationCreated/Updated/Deleted`,
  `handleInlineCreateFormation`.
- `useContactCrud` — `handleCreate/BatchCreate/BatchUpdate/Update/Delete`
  `Contact`, `handleLink/UnlinkLithoToGeo`.
- `useGeologicalModelOps` — `handleAutoPopulateFromStratigraphy`,
  `handleSeedLithoFromParent`, `handleDedupeContacts`, `handleRebuildSurfaces`,
  `handleToggleBoreholeInModel`, `handleDeleteModel`.
- `useLithoModelOps` — `handleCreate/Activate/Delete LithoModel`,
  `handleRebuildLithoSurfaces`, `handleClearLithoModel`.
- `useLithoSuggestions` — `handleAutoCorrelate`, `handleClearSuggestions`,
  `handleEditLithoSuggestion`, `handleStrip/ReseedLithoAdmixtures`,
  `handleReject/Unreject/EditBulkLitho`,
  `handleInsert/Split/Merge/AbsorbLithoLayer`, `handleCreateManualLithoGhost`,
  `handleExtendLithoGhostToNearestContacts`.

**Critical constraints (all from existing memory):**
- The 23 `useState` that are shared across clusters must stay in the parent
  composer and be passed down — do **not** duplicate state into sub-hooks.
- After each extraction, grep the parent body for the moved binding and confirm
  no `const` is read above its declaration (TDZ — `tsc`/Vitest won't catch it;
  add a top-level `render` smoke per `feedback_new_hook_above_early_return`).
- One cluster per commit; full Vitest + `tsc` between each. Expect this move to
  be 5+ commits and the most review-intensive of the set.

**Risk:** high. This is the move most likely to introduce a runtime-only
regression, which is exactly why it is sequenced last and gated behind the
dogfeed.

---

## Suggested execution budget

Moves 1–2 (backend split + client split) are a clean half-day, near-zero risk —
bank them first. Move 3 (ContactsLayer geometry) is the highest-value FE win for
its risk. Moves 4–5 are multi-session and want a dedicated review pass each
(senior-code-reviewer on the diff before merge). Update debt #114 as each lands.
