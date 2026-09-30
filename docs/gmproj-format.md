# Project Files (`.gmproj`)

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Project files (`.gmproj`)

Engineering-app convention: each project is a file the user opens / saves.
The desktop client uses the extension ``.gmproj`` and JSON-on-disk content
versioned by ``format_version``. The DB is the live source of truth for
metadata; the file is a pointer + last-saved snapshot, mirrored via the
metadata editor.

```json
{
  "format_version": 3,
  "project": {
    "id": "<uuid>",
    "name": "Antwerp port — quay 7",
    "project_number": "GEO-2026-042",
    "client": "Port of Antwerp",
    "site_label": "Quay 7",
    "description": "Foundation investigation",
    "tags": ["foundation", "marine"],
    "default_horizontal_epsg": 31370,
    "default_vertical_epsg": 5710,
    "phase": "design",
    "status": "active",
    "view_state": { }
  },
  "cpts": [ ],
  "boreholes": [ ],
  "geological_formations": [ ],
  "geological_models": [
    {
      "id": "<uuid>",
      "kind": "geological",
      "contacts": [ /* boundary-centric: FormationContact rows */ ],
      "litho_layers": []
    },
    {
      "id": "<uuid>",
      "kind": "lithostratigraphic",
      "contacts": [],
      "litho_layers": [ /* Shape A — layer-centric primitives */ ]
    }
  ],
  "cross_sections": [ ],
  "bed_overrides": [ ],
  "investigation_reviews": [ ]
}
```

* Pretty-printed (2-space indent, trailing newline) — git-diff-friendly.
* Timestamps (``created_at`` / ``updated_at`` / ``archived_at``) live in the
  DB only and are not persisted to the file, so re-saving without a DB
  change leaves the file byte-identical.
* **File format v4** (current — A4 of the unified litho boundary
  model) bundles the full project state with the litho axis in Shape A
  native shape. Header metadata + ``view_state`` toggle bag under
  ``project``; every CPT (with series) under ``cpts``; every borehole
  (with its full child tree: drill segments, field log intervals,
  observations + layers + admixtures, samples + 6 lab-test families)
  under ``boreholes``. Each observation and each field-log interval carries
  its track provenance, ``source`` (``"dov"`` / ``"manual"``) and
  ``edited_manually_at`` (2026-09-29, additive, no version bump: a file
  written before carries neither key and restores as an untouched DOV
  import); the interpretation arrays
  observations + layers + admixtures, samples + 6 lab-test families +
  the optional nested ``lab_series_tests`` — see below)
  under ``boreholes``; the interpretation arrays
  (``geological_formations``, ``geological_models``); the project-scoped cross-section definitions
  (``cross_sections``); the manual bed-level polygons (``bed_overrides`` —
  owner ruling 2026-09-06; additive, absent in older files, restores to an
  empty list); and per-(project, investigation) decisions
  (``investigation_reviews``).
* **Raw lab series (2026-09-29, additive, no version bump):** each sample
  payload may carry ``lab_series_tests: [...]`` — test → ``specimens[]`` →
  ``stages[]`` (reading axis: ``reading_timestamps`` as ISO strings or
  ``point_numbers``; ``rezero_indices``) → ``channels[]`` (``series_values``
  arrays, ``provenance``, ``formula`` / ``derivation_inputs`` on derived
  channels), plus ``lab_results[]`` (lab-reported). Serialised and restored
  by ``project_bundle/bundle_lab_series.py`` (attached at the borehole level
  so the flat sample helpers stay cycle-free); restore caps tests per sample
  (200), specimens (50), stages (500), channels (64) and drops a channel over
  200 000 values. A sample without the key restores with no test. An OLDER
  build opening a newer file drops the key silently (forward-compat loss,
  accepted as for every additive key).
* **Per-model litho payload (v4):** each ``geological_models[]`` entry
  carries a nested ``contacts`` array AND a nested ``litho_layers``
  array. Geological models populate ``contacts`` only (boundary-centric
  FormationContact rows) and emit empty ``litho_layers``. Litho models
  populate ``litho_layers`` only (Shape A primitives — id, formation_id,
  anchor, depth_top_m, depth_base_m, status, source, confidence,
  parent_geo_contact_id, ...) and emit empty ``contacts``.
* Every per-project engineering decision lives here, never in
  localStorage — see ``memory/project_decisions_in_bundle.md``. The
  file weighs whatever the data weighs (JSON arrays of long
  depth-series add up — a few MB for typical projects, tens of MB
  for a 500-CPT DOV import).
* **v3 still parses.** ``SUPPORTED_BUNDLE_VERSIONS = {3, 4}``.
  v3 bundles carry litho data in the ``contacts`` array (boundary
  shape, no ``litho_layers`` field); restore creates the FCs and the
  LL→FC trigger materialises layers from them. The slice-1 de-dupe
  rule in the restore code keeps the round-trip pkey-safe when both
  fields are populated (legacy v4 bundles saved by a pre-slice-4c
  build also hit this path). v1 and v2 readers are gone — pre-shipping
  amnesty.
* Opening a file: read JSON → ``GET /projects/{id}`` → adopt the live
  metadata. If the DB row is missing (wiped DB, fresh install,
  archived elsewhere), the frontend automatically calls
  ``POST /projects/{id}/restore`` with the file's full bundle —
  metadata + CPTs + boreholes + geology + sections + reviews. The
  endpoint accepts v3 or v4 payloads; older versions return 400 +
  "re-save from a current build". Restore is idempotent (existing
  rows by id are skipped, missing rows are inserted with their
  original ids). CPTs and boreholes round-trip with their PostGIS
  geometry rebuilt from x/y/epsg on restore. The principle is:
  **the .gmproj file is the user's anchor; the DB is just a cache of
  the data**. Opening a valid v3/v4 .gmproj always brings everything
  back when the API is reachable.
* Recent-projects list lives at
  ``app.getPath('userData')/recent-projects.json`` (max 10 entries, MRU
  order). Both the File menu's "Open Recent" submenu and the Welcome
  screen's "Recent projects" column read from this single source.
* No auto-reopen on launch. The welcome screen is the always-on entry
  point — closer to Plaxis / AutoCAD / Photoshop than to Word's "reopen
  last document" behaviour. Users who want the previous project re-open
  it from the Recent column with a single click.
* Sharing a .gmproj file alone won't transfer data (the data lives in
  the recipient's DB). A self-contained "Export project bundle" feature
  is future work; today's flow is for solo work + same-machine project
  organisation.

The on-disk ``format_version`` is **3** — decoupled from the backend
``GET /bundle`` payload's ``format_version`` 4: the desktop client overrides
the version and injects ``stratigraphy_lumping`` when writing a file, and a
raw v4 bundle saved as a project file is rejected on open ("may be corrupt").
The schema lives in ``desktop/src/renderer/src/utils/projectFile.ts``
(``ProjectFileV3`` type + ``buildProjectFile`` / ``serialiseProjectFile`` /
``parseProjectFile``). Once we ship, bumping ``format_version`` will
require keeping the old reader alive and writing an explicit
``upgrade_vN_to_vN+1`` function — see "Backwards Compatibility" at the
top of CLAUDE.md.

**Adding a collection to the file is additive and does NOT bump the version.**
The convention, which every array after the v3 floor follows
(``litho_contact_correlation_edges``, ``bodies``, ``formation_absences``,
``body_boundary_shapes`` / ``body_boundary_nodes``, ``body_geometry_facts``):
declare it on ``ProjectFileV3``, copy it in ``buildProjectFile``, tolerate its
absence in ``isProjectFileV3``, backfill it to ``[]`` in ``parseProjectFile``,
and add it to ``restorePayloadFrom`` in ``desktop/.../hooks/useProject.ts`` —
that last one being the enumeration the restore actually sends. A file written
by an older build then opens unchanged, with the collection simply empty.

⚠ **The backend registry does not cover the desktop writer.**
``assert_bundle_keys_registered`` guards the backend copy paths only;
``buildProjectFile`` is a hand-written whitelist that silently drops any key it
does not name. ``body_geometry_facts`` — the persisted geometric body identity
— shipped on the backend 2026-08-12 and was missing from the file writer and
from ``restorePayloadFrom`` until 2026-08-15, so every File → Save wrote a
bundle without it and every reopen dropped every geometric body union without
a word. ``litho_solids`` is absent from both by DESIGN (a rebuildable ~10 MB
mesh cache; see ``api/clients/project.ts`` ``includeSolids``) — the distinction
that matters is evidence vs cache: evidence goes in the file, caches do not.

## The per-array column set is pinned — a new column is a conscious format decision

The bundle serialiser enumerates ORM columns via ``__mapper__.column_attrs``,
so a column added to any bundled model would otherwise ride into the ``.strix``
silently — no version bump, no decision. ``tests/unit/infrastructure/db/
test_bundle_column_pins.py`` freezes the exact column set of every bundled ORM
class (grouped per top-level array) against the hand-maintained sets in
``tests/unit/infrastructure/db/bundle_columns_expected.py``; adding or removing a
column turns the unit suite RED until the frozen set is updated on purpose — the
point at which someone decides whether the column is **portable format** (rides
along, possibly a ``format_version`` bump) or **non-portable** (dropped via
``_SKIP_COLUMNS``, pinned by ``test_bundle_skip_columns.py``). A whole new
collection is caught too: the pin's coverage guard requires every
``BUNDLE_COLLECTION_KEYS`` entry to be pinned here.

``_SKIP_COLUMNS`` is the list of columns whose value does not survive the trip to
another machine / install and so is dropped on BOTH serialise and restore: the
server clocks (``created_at`` / ``updated_at`` / ``archived_at``), the PostGIS
``location`` blob (rebuilt from ``location_x`` / ``location_y`` / ``epsg``), and
``generation_id`` — the ``LithoBodySolid`` FK into ``litho_build_generation``, a
build-history table the bundle does not carry (serialising it would dangle on a
fresh-DB open and cross-link the source project on a Save-As clone). The
rebuildable TIN / mesh caches (``vertices`` / ``triangles`` + the ``source_*``
checksums on ``FormationSurface`` / ``LithoBodySolid``) are deliberately NOT
skipped — they are portable (project-CRS geometry) and carried on purpose so a
fresh-DB open skips the recompute; File → Save drops the solid meshes separately
via ``include_solids=False``. (debt #47)

## The bundle collection registry — one list, every copy path

Four write paths used to enumerate the project's child tables by hand:
``ProjectRepository.duplicate`` (File → Save As), ``restore_project_bundle``,
the renderer's save-time formation trim, and the geotech rebuild. Each was one
forgotten branch from dropping a collection in silence, and Save As actually
did — it cloned the CPTs and boreholes and left the entire three-level
interpretation behind, then reported success.

``bundle_build`` already enumerates every project-scoped table once, to
serialise it. That enumeration is now the registry the copy paths read:

* ``project_bundle/bundle_collections.py`` — ``BUNDLE_COLLECTION_KEYS`` (every
  child-collection key, in restore order), ``BUNDLE_RESTORE_KWARGS`` (the
  keyword each travels under into the restore), and
  ``assert_bundle_keys_registered``, which ``_build_project_bundle_impl`` calls
  on every build. **Adding a collection to the bundle without registering it
  raises at save time** instead of being quietly skipped by every copy path.
* ``project_bundle/bundle_clone.py`` — ``clone_project_children`` copies one
  project's whole tree onto another project id by building the source's bundle,
  re-keying it, and feeding it to the SAME restore. Re-keying replaces ids **by
  value across the whole document** (FK columns, UUID arrays, JSON map keys), so
  a reference is carried wherever it lives; an id that is not a row of this
  bundle is left alone, which is right for a reference pointing outside the
  project. Two shapes need explicit care afterwards: geological models are
  ordered parents-first (``parent_model_id`` is a self-referential FK with no
  ORM relationship behind it, so the unit of work cannot reorder them), and
  correlation edges are put back into ``layer_a_id < layer_b_id`` order with
  their sides swapped along.
* The copy is **verified, not assumed**: the clone's bundle is re-read and
  compared to the source's, per collection and counting rows at every depth. A
  short copy raises ``BundleCloneIncompleteError`` and the endpoint rolls back —
  a Save As that quietly loses the interpretation is worse than one that fails,
  because the client adopts the copy the moment the call returns.
* Two contracts the copy inherits from the restore: ``litho_layer.body_id`` is
  dropped for the resolver to re-stamp (so the duplicate endpoint runs the same
  ``reconcile_bodies_after_restore`` the restore endpoint runs), and the
  restore's size caps apply.

Gate: ``tests/integration/db/test_project_duplicate_full_tree.py`` parametrises
over ``BUNDLE_COLLECTION_KEYS``, so a collection added tomorrow is checked
tomorrow — plus a guard that the fixture actually seeds every registered
collection, or an empty-vs-empty comparison would pass while carrying nothing.
