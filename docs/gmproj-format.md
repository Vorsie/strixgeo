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
  "format_version": 4,
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
  "geotechnical_units": [ ],
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
  under ``boreholes``; the interpretation arrays
  (``geological_formations``, ``geotechnical_units``,
  ``geological_models``); the project-scoped cross-section definitions
  (``cross_sections``); and per-(project, investigation) decisions
  (``investigation_reviews``).
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

The on-disk schema lives in ``desktop/src/renderer/src/utils/projectFile.ts``
(``ProjectFileV3`` type + ``buildProjectFile`` / ``serialiseProjectFile`` /
``parseProjectFile``). Once we ship, bumping ``format_version`` will
require keeping the old reader alive and writing an explicit
``upgrade_vN_to_vN+1`` function — see "Backwards Compatibility" at the
top of CLAUDE.md.
