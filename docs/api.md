# API Endpoints

Additive-only contract — see CLAUDE.md "Backwards Compatibility" for the deprecation cycle when fields must be removed or repurposed. The frontend always goes through the API — never directly to domain or DB.

One line per route: `METHOD path — purpose`. The purpose is the endpoint's own docstring summary. Catalogue regenerated from the routers under `src/groundmodel/api/routers/` — 144 routes across 23 router modules. Conflict semantics that need more than one line follow the catalogue.

One line per route: `METHOD path — purpose`. The purpose is the endpoint's own docstring summary. Catalogue regenerated from the routers under `src/groundmodel/api/routers/` — 145 routes across 23 router modules. Conflict semantics that need more than one line follow the catalogue.

All **Geology** routes are mounted under one parent prefix `/projects/{project_id}/geology` (the `geology` package aggregates 13 sub-routers, debt #40); the paths in that section are shown relative to that prefix. **Borehole** routes are mounted under `/borehole`.

**Project-scope guard:** single-resource by-id endpoints (e.g. `GET /cpt/{cpt_id}`, `GET /borehole/{borehole_id}`, and their `PATCH` / `DELETE` siblings) require a `?project_id` query parameter and answer `404` when the id is not in that project — a cross-project id-enumeration guard (`scope_guard.load_scoped_or_raise`, #166). Every read and write goes through the SQLAlchemy ORM; there is no raw-SQL surface.

**Loopback access control (launch token + CORS).** The API binds to `127.0.0.1` and is unauthenticated by design (single-seat desktop app). The threat model is a web page the engineer has open cross-origin-fetching the local API. Two layers close it:

* **CORS** (`api/main.py`) allows exactly the renderer's own origins: `"null"` (the packaged `file://` renderer) in every environment, plus `http://localhost:<port>` (the Vite dev server) **only in development** (`environment == "development"`). A packaged build allows no browser origin but `null`. The 500 error handler is pinned to the same allowlist so an escaped exception never echoes an origin CORS would reject.
* **Launch token** (`local_client_token_middleware.py`). A browser origin is forgeable, so the Electron main process mints a random token per launch, passes it to its uvicorn child as `STRIX_API_TOKEN`, and injects it as the `X-StrixGeo-Token` header on every renderer request (both the packaged and the dev renderer). **Any request carrying an `Origin` header must present a valid token** (constant-time compared); a request with **no** `Origin` header — curl, the integration suite, the main process's readiness probe — is exempt. A backend started by hand (no `STRIX_API_TOKEN`) disables the check entirely, so dev shells, `scripts/run-e2e.ps1`, and integration runs are unaffected. A CORS preflight (`OPTIONS`) is answered by CORS before the token check and needs no token.

**CPT — `cpt.py`**

```
POST   /cpt/import — Import a CPT file and persist it, refreshing the row if it already exists.
POST   /cpt/import-dov — Import CPTs from DOV within a WGS84 bounding box.
POST   /cpt/import-dov/stream — Spawn a CPT DOV import as a background task and return its job-id.
GET    /cpt/import-dov/stream/{job_id} — Drain the SSE event queue for a running CPT DOV import job.
GET    /cpt/ — Return a lightweight summary list of CPTs.
GET    /cpt/{cpt_id} — Return full CPT metadata for a single record.
PATCH  /cpt/{cpt_id}/elevation — Update the manually-entered surface elevation for a CPT.
PATCH  /cpt/{cpt_id}/water-table — Set (or clear) the engineer's depth to groundwater for a CPT.
DELETE /cpt/{cpt_id} — Delete a CPT and its series data.
GET    /cpt/{cpt_id}/plot — Return raw depth-series arrays for plotting qc, fs, and u2 vs depth.
GET    /cpt/{cpt_id}/sbt-profile — Return both Robertson SBT classifications per depth point for one CPT.
POST   /cpt/plot-batch — Batch the per-CPT plot endpoint into one round-trip.
```

**Lab series — `lab_series.py`** (raw oedometer / triaxial readings, 2026-09-29)

```
POST   /lab-series/preview — Parse one lab file and propose where it goes — nothing is written.
POST   /lab-series/import — Store a lab file's readings on the confirmed (or a new) sample.
GET    /lab-series — List a borehole's lab-series tests with counts (no readings); ?project_id&borehole_id.
GET    /samples/{sample_id}/lab-series — Every lab-series test of a sample, with every channel's values; ?project_id.
DELETE /lab-series/{test_id} — Delete one lab-series test with its specimens, stages, channels and lab results; ?project_id.
```

Both POSTs take a multipart `file` (`.txt` / `.csv` / `.dat`; the export kind is sniffed from the CONTENT, never the name) plus `project_id`. Preview takes an optional `borehole_id` (re-preview against the user's pick) and answers the lab identity, `borehole_candidates` + `borehole_match` (`unique` / `ambiguous` / `none` / `chosen`), the chosen borehole's `samples` + `proposed_sample_id` + `sample_match` (`overlap` / `sample_number` / `none`), `create_sample_default` (the lab interval, or `null` when the export names none), `existing_test` (`{id, sample_id, same_content}`) and every finding. Import takes `borehole_id` and either `sample_id` or `create_sample=true` (+ optional `sample_depth_top_m` / `_base_m`), plus `confirm_refresh`. Answers: **201** new; **200** `unchanged=true` (same identity, same SHA-256: no-op) or `refreshed=true` (same test id, readings replaced); **409** `code = "lab_series_refresh_confirmation_required"` + `test_id`, `old_/new_n_specimens`, `old_/new_n_readings`, `old_/new_source_file_name` (nothing written); **422** `lab_series_refresh_refused` (the fresh parse has ERROR findings — never overwrites, even confirmed) or `sample_not_on_borehole` / `sample_choice_required` / `sample_interval_required`; **404** borehole / sample not in the project; **400** `code = "lab_file_format_not_recognised"` (+ `message` "… Contact the StrixGeo dev team to have it added.", `file_name`) for a format Strix does not read, a plain 400 for a supported format the parser refuses; **413** over 50 MiB. Preview `dov_lookup` (additive, 2026-09-30): when no project borehole matches `<job>-<borehole>` the preview fetches it from DOV into the project and answers `{status: "fetched" | "not_found" | "unreachable", borehole_name, borehole_id}` (fetched = proposed; the other two propose nothing, never a 500) — the one write a preview makes. Identity = (kind, lab test type, lab job, lab sample number) within the project. Channel `provenance`: `measured` / `lab_derived` (the lab software's column) / `derived` (Strix: the oedometer vertical strain, with `formula` + `derivation_inputs`); `lab_results` are `lab_reported`, never inputs. Format reference: [parsers-lab.md](parsers-lab.md). DELETE (2026-10-04) answers **204** and cascades the whole tree (the sample stays; the borehole's `lab_series_count` follows, being a live count); **404** when the test is not in the project (unknown id, or a test on another project's borehole: the scope runs test → sample → borehole → project). Irreversible: the desktop confirms first (Cancel focused, "Delete lab test"), marks the project dirty so the next save writes a bundle without the test. Preview **409** `code = "lab_borehole_conflict"` + `borehole_name` (or `null`) is translated by the desktop (`apiCodeMessages.ts`).


**CPT from a PDF report — `cpt_pdf.py`** (registered before `cpt.py`; the
pipeline is in [parsers-cpt-pdf.md](parsers-cpt-pdf.md))

```
POST   /cpt/pdf/triage — Spool a PDF report and triage it as a background job.
GET    /cpt/pdf/triage/{job_id} — Drain the SSE progress stream of a triage job.
GET    /cpt/pdf/page/{file_sha}/{page_number}.png — Return one page of a stored report as a PNG (the triage list's thumbnails).
POST   /cpt/pdf/digitise — Read one sounding through the calibration the user settled on.
POST   /cpt/pdf/import — Import the ticked soundings, one CPT each, through the GEF import's door.
```

**Borehole — `borehole.py` (mounted at `/borehole`)**

```
POST   /borehole/import — Import a LOCAL DOV borehole XML file (one or several borings, all interpretations, import flags); consented refresh-on-reimport.
POST   /borehole/import-dov — Import boreholes from DOV within a WGS84 bounding box.
POST   /borehole/import-dov/stream — Spawn a borehole DOV import as a background task and return its job-id.
GET    /borehole/import-dov/stream/{job_id} — Drain the SSE event queue for a running borehole DOV import job.
GET    /borehole/ — Return a lightweight summary list of boreholes.
GET    /borehole/{borehole_id} — Retrieve full borehole detail (header + drill segments + field log + observations).
POST   /borehole/detail-batch — Batch the per-borehole detail endpoint into one round-trip (debt #39).
PATCH  /borehole/{borehole_id}/elevation — Update the manually-entered surface elevation for a borehole.
```

**Borehole tracks — `borehole_tracks.py` (mounted at `/borehole`, 2026-09-29)** — add a track by hand or change any track, imported ones included, or reset the DOV tracks to what DOV published. All four require `?project_id` (404 across projects) and commit once.

```
POST   /borehole/{borehole_id}/tracks — Create a hand-typed track {kind, intervals[]}; 201, stored with source = "manual".
PUT    /borehole/{borehole_id}/tracks/{track_id} — Replace every interval of one track; an import keeps source = "dov" + dov_permkey and gets edited_manually_at — or answers edited_manually_at null when the new intervals equal what DOV published (the undo of a first edit).
DELETE /borehole/{borehole_id}/tracks/{track_id} — Delete one whole track with its intervals; 204. A DOV observation track's permkey is remembered on the borehole (deleted_dov_permkeys) so a DOV bbox re-import does not bring it back.
POST   /borehole/{borehole_id}/tracks/reset-dov[?track_id=] — Reset every DOV track (or one) to the cached DOV XML; 200 {tracks[], discarded_edits, kept_manual}.
```

* **Reset to DOV (2026-09-30).** Re-reads the XML the DOV bbox import cached (`<dov_cache_dir>/interpretatie/<dov_permkey>.xml` per observation; the boring XML found in `<dov_cache_dir>/boring/` by its `<identificatie>` = the borehole's boornummer `test_id`, because the boring permkey is not stored on the row), re-parses it with the import's parsers and rewrites the DOV tracks: observations in place (same ids), field logs wholesale (a deleted DOV field-log kind comes back); manual tracks are kept; `edited_manually_at` is cleared. All-or-nothing: a track without cached XML (an XML-file import, a wiped cache, a manual track named by `track_id`) answers `409` `code = "borehole_reset_no_dov_source"` + `missing[]` and writes NOTHING; the desktop shows that as a notice. No undo: the desktop confirms first.
* **3 admixtures at most** on a coded interval (`MAX_ADMIXTURES_PER_INTERVAL`, owner 2026-09-30): a fourth is a `422` issue `too_many_admixtures` at `intervals.<i>.admixtures`. DOV data written by the import or a reset is not judged by it.

* **One shape for both ORM families.** `kind` is an `ObservationType` value (one `observation` row per track, several per kind allowed) or a `FieldLogKind` value (`color` / `moisture` / `consistency`: the `field_log_interval` rows of that kind, ONE track per kind, id `"field_log:<kind>"`). Each interval is `{top_m, base_m, value?, description?, color?, main_soil_codes?, admixtures?[{soil_code, amount, locally}]}`: a field-log kind fills `value`, a coded kind (`coded_lithology`, `geotechnical_coding`) fills `main_soil_codes` (+ admixtures / colour), every other kind fills `description`. Raw DOV tokens only; the desktop picker offers the DOV codelists, the backend does not check them.
* **Rules** (`domain/services/validate_track_intervals.py`): top < base on the 1 mm grain (`LITHO_LAYER_DEPTH_DECIMALS`), no overlap within a track, the kind's content present → `422` with `detail = {code: "borehole_track_invalid", message, errors[{loc, code, message}], warnings[...]}`, `loc` the dotted request path (`"intervals.3.base_m"`). Gaps and an interval deeper than the borehole's total depth save, reported in the response's `warnings`. A second field-log track of a kind answers `409` `code = "borehole_track_exists"`.
* **Which track is drawn.** `GET /borehole/{id}` and `POST /borehole/detail-batch` order `observations` so each kind's preferred track comes first (`domain/services/track_preference.py`: manual, else newest edited, else `observation_date` order); the section columns and the borelog take the first of a kind, the backend consumers call `preferred_track`. `ObservationResponse` gains `source`, `edited_manually_at`, `dov_permkey`; `FieldLogIntervalResponse` gains `source`, `edited_manually_at` (all optional, additive).
* A track edit stales no cache: no stored contact moves (unlike the elevation PATCH) and every observation consumer re-reads on its next run.

**Projects — `project.py`**

```
GET    /projects/ — List all projects, most-recent first.
GET    /projects/archived — List only archived projects, ordered by archive date (most-recent first).
POST   /projects/ — Create a new project.
GET    /projects/{project_id} — Return a single project by id.
PATCH  /projects/{project_id} — Apply a partial metadata update to a project.
POST   /projects/{project_id}/archive — Soft-delete a project — hide from default listings, keep all data.
POST   /projects/{project_id}/unarchive — Restore a previously-archived project to active status.
GET    /projects/{project_id}/bundle — Return a complete snapshot of a project + every CPT and borehole.
POST   /projects/{project_id}/restore — Idempotently materialise a project row + its CPTs + boreholes from a bundle.
POST   /projects/{project_id}/duplicate — Deep-clone a project — investigations AND the whole interpretation.
```

**Cross-sections + section exports — `cross_section.py`**

```
POST   /projects/{project_id}/sections — Create a new cross-section under the given project.
POST   /projects/{project_id}/sections/batch — Create several cross-sections in one transaction (Accept-all tie-sections).
GET    /projects/{project_id}/sections — List every section for a project, ordered by display_order then name.
GET    /projects/{project_id}/sections/{section_id} — Fetch a single section by id. 404 when missing or not in this project.
PATCH  /projects/{project_id}/sections/{section_id} — Partial update — only fields present in the body are written.
DELETE /projects/{project_id}/sections/{section_id} — Delete a section. Polylines drawn on it (when the editor lands)
GET    /projects/{project_id}/sections/{section_id}/export/dxf — Export the section's contact lines and column lines to a DXF file (the 0.1.x shape, kept).
POST   /projects/{project_id}/sections/{section_id}/export/dxf — The same DXF plus the drawn fill (a closed outline and a see-through solid hatch per region on its unit's layer) and the CPT qc / Rf curves on the app's scales; the body carries the drawn partition like D-Stability.
GET    /projects/{project_id}/sections/{section_id}/export/pdf — Export the section as a PDF project report (debt #52 slice 1).
GET    /projects/{project_id}/sections/{section_id}/export/plaxis2d — Export the section's drawn geology as a runnable Plaxis 2D script.
POST   /projects/{project_id}/sections/{section_id}/export/dstability — Export the section's drawn geometry as a D-Stability ``.stix``.
POST   /projects/{project_id}/sections/{section_id}/export/dsheetpiling — Export a 1-D soil profile through the section as a D-Sheet Piling ``.shi``.
```

**Bed overrides — `bed_override.py`**

```
POST   /projects/{project_id}/bed-overrides — Create a manual bed-level polygon under the project.
GET    /projects/{project_id}/bed-overrides — List every bed override for a project, newest first.
PATCH  /projects/{project_id}/bed-overrides/{override_id} — Partial update — only fields present in the body are written.
DELETE /projects/{project_id}/bed-overrides/{override_id} — Delete a bed override (desktop guards it with a confirm dialog).
```

A bed override is a polygon drawn on the map with one constant bed elevation (m TAW / NAP). Inside it the ground surface takes that level instead of the DEM — the manual fix for the missing bathymetry over dredged water (owner ruling 2026-09-06). Survey-file bathymetry import stays Phase 5. The stored rows feed the 3-D ground surface, the section DEM line, and the crossing-line formation clip.

**DEM — `dem.py`**

```
GET    /dem/sample — Return ``n_samples`` evenly-spaced elevations along the requested line. Optional ``project_id`` applies the project's bed overrides (a sample inside a bed polygon reads the bed level, not the DEM), so the section line shows the dredged bed where it crosses a polygon.
```

**Investigation reviews + view-state — `investigation_review.py`**

```
GET    /projects/{project_id}/reviews — Return every review row for a project, oldest first.
GET    /projects/{project_id}/reviews/{target_kind}/{target_id} — Fetch the decision row for a specific investigation.
PUT    /projects/{project_id}/reviews/{target_kind}/{target_id} — Create or update the decision row for an investigation.
DELETE /projects/{project_id}/reviews/{target_kind}/{target_id} — Drop the decision row for an investigation.
PATCH  /projects/{project_id}/view-state — Shallow-merge the patch dict into ``project.view_state``.
```

**Codelists — `codelists.py`**

```
GET    /codelists/g3dv3 — Return every G3Dv3 unit, in age order (youngest first).
GET    /codelists/formal-stratigraphy — Return every DOV formal-stratigraphy unit (code + canonical Dutch name).
```

**Stratigraphy lumping — `stratigraphy_lumping.py`**

```
PUT    /projects/{project_id}/stratigraphy-lumping/staged — Write the lumping snapshot to the project's ``staged`` slot.
POST   /projects/{project_id}/stratigraphy-lumping/promote — Copy ``staged`` onto ``saved`` — the File → Save half of the model.
```

**Virtuele Boring (DOV predictions) — `virtuele_boring.py`**

```
GET    /dov/virtuele-boring/lagenmodellen — Return the list of DOV lagenmodels the Virtuele Boring server exposes.
GET    /projects/{project_id}/virtuele-boring/predictions — Return overlay predictions for every investigation in a project.
```

DOV being slow or unreachable is a degraded path, never a 500. The predictions sweep skips each (investigation, model) call that fails — a network failure (timeout, reset, refused) or a DOV HTTP error — logs a WARNING, and answers **200** with the data that came back plus `skipped: [{investigation_kind, investigation_id, name, model, reason: "dov_unreachable" | "dov_http_error", detail}]` (additive; `skipped_count` still counts only the non-Lambert-72 / no-coordinate investigations). Only when EVERY call failed for a network reason does it answer **503** with `detail = {code: "dov_unreachable", message: "DOV is not reachable right now; the predictions will load when it is."}`; the desktop treats that code as a degraded overlay (one WARN, no diagnostic, no toast). Any other exception still propagates.

**Geology » Formations — `geology/formations.py`**

```
POST   /formations — Create a new formation under the given project.
GET    /formations — List all formations defined for a project.
GET    /formations/codelist — Kind-aware formation-name suggestion set (debt-campaign follow-on).
PATCH  /formations/{formation_id} — Partial update on a formation. Only fields present in the body are written.
DELETE /formations/{formation_id} — Delete a formation. Cascades to every contact that referenced it.
```

The formation response carries an additive, read-only `nad_parameters` object — the NAD table's characteristic values (`gamma_unsat_kn_m3`, `gamma_sat_kn_m3`, `phi_deg`, `c_kpa`, `cu_kpa`) for the unit's `nad_class`, computed on read from the shared `parameters_for_class` accessor (the same row the D-Series exporters read); `null` on any unit with no NAD class or no transcribed row. Additive/optional — pre-change clients ignore it.

**Geology » Models — `geology/models.py`**

```
POST   /models — Create a model, enforcing the three-level parent invariant.
GET    /models — List all geological models for a project, active first.
PATCH  /models/{model_id} — Partial update on a model. ``is_active`` lives on its own activate endpoint.
POST   /models/{model_id}/activate — Mark this model active; clear ``is_active`` on every sibling in the project.
DELETE /models/{model_id} — Delete a model and all its dependent data.
```

**Geology » Contacts — `geology/contacts.py`**

```
POST   /models/{model_id}/contacts — Create a new formation contact under a model.
GET    /models/{model_id}/contacts — List contacts in a model, optionally filtered by borehole / formation.
PATCH  /models/{model_id}/contacts/{contact_id} — Partial update on a contact (depth, formation, anchor, confidence, notes).
DELETE /models/{model_id}/contacts/{contact_id} — Delete a contact.
PUT    /models/{model_id}/contacts/batch — All-or-nothing batch PATCH for N contacts.
```

**Cross-merge response on the contact PATCH (additive, installer #20).** A
depth-only drag can cross peer contacts on the same anchor, and the backend
resolves that by deleting the crossed boundaries. The PATCH now names them so
the renderer prunes them at once (a crossed boundary must never linger as a row
that only 404s on a second delete):

* Survivor (plain update, or a drag-up that crossed peers) → `200` with the
  updated `FormationContactResponse`, whose additive `deleted_contact_ids`
  lists the peers the drag-up deleted (empty on a plain update).
* Absorbed (a drag-down cross-merge absorbed the dragger into the formation
  above) → `200` `{"absorbed": true, "deleted_contact_ids": [...]}` — the
  dragger is gone (its id is the URL's), and the list names the crossed peers.
  This replaces the former bare `204`; a legacy `204` still maps to "absorbed,
  no named peers" client-side.

**Geology » Litho ops (auto-populate / seed / suggest / accept) — `geology/litho_ops.py`**

```
POST   /models/{model_id}/contacts/auto-populate — Seed the model with contacts derived from borehole stratigraphy.
POST   /models/{model_id}/contacts/discover-from-stratigraphy — Return candidate formation names from borehole stratigraphy — read-only.
POST   /models/{model_id}/contacts/dedupe — One-shot cleanup for legacy duplicate (anchor, formation) contacts.
DELETE /models/{model_id}/contacts — Clear ALL content from a lithostratigraphic model in one atomic call.
POST   /models/{model_id}/layers/seed-from-parent — Copy the parent geological model's contacts into a lithostratigraphic model.
POST   /models/{model_id}/contacts/suggest-litho — Suggest lithostratigraphic layer contacts for one CPT or borehole.
POST   /models/{model_id}/layers/accept-litho-suggestions — Bulk-accept litho suggestions, committing formations + contacts.
POST   /models/{model_id}/layers/batch-accept-litho-suggestions — Accept many anchors' litho suggestions in one transaction (#153 batch lever).
```

**Geology » Litho layers — `geology/litho_layers.py`**

```
GET    /models/{model_id}/layers — List ``litho_layer`` rows in a model, optionally filtered.
POST   /models/{model_id}/layers — Insert N ``litho_layer`` rows in one transaction.
PATCH  /models/{model_id}/layers/boundary-move — Atomic two-row depth update on the shared boundary.
POST   /models/{model_id}/layers/batch-status — Set the same status on N rows in one transaction (accept-all / reject-all).
PATCH  /models/{model_id}/layers/batch-update — All-or-nothing PATCH for N layer rows in one transaction.
POST   /models/{model_id}/layers/{layer_id}/link-geo — Link a litho LAYER to the nearest geological contact (A4 cleanup).
DELETE /models/{model_id}/layers/{layer_id} — Delete one ``litho_layer`` row + reconcile downstream state.
PATCH  /models/{model_id}/layers/{layer_id} — Partial update on one layer row.
PATCH  /models/{model_id}/layers/{layer_id}/composition — "Edit composition": repoint one accepted layer to the litho unit for a different (main soil code, admixtures) composition, find-or-create; depths/anchor/status kept, resolver re-runs.
POST   /models/{model_id}/layers/{layer_id}/split — "Split here": atomically split one accepted layer at ``depth_m`` into two accepted layers sharing the formation (422 when the depth leaves either half below the min thickness).
```

**Geology » Surfaces + validation — `geology/surfaces.py`**

```
POST   /models/{model_id}/surfaces/rebuild — Build the geological model — recompute every formation's TIN cache, cutting each surface where it crosses the ground surface (DEM + bed overrides).
GET    /models/{model_id}/surfaces — Return every cached TIN surface in this model.
GET    /models/{model_id}/boreholes/{borehole_id}/validate — Check that a borehole's formation contacts form a clean stratigraphy.
GET    /models/{model_id}/validate/crossings — Check that no two formation surfaces violate stratigraphic order.
POST   /models/{model_id}/ground-surface/build — Sample the DEM (with the project's bed overrides) over the model's investigation hull and return a TIN.
```

**Geology » Bodies + formation absences — `geology/bodies.py`**

```
GET    /models/{model_id}/bodies — List all body metadata rows for a lithostratigraphic model.
POST   /models/{model_id}/bodies/merge-enclosed-lenses — Merge a lithology split only by a local lens into one body (Fill bands).
POST   /models/{model_id}/bodies/recompute — Persist the geometric body merge and re-stamp ``litho_layer.body_id``.
PATCH  /models/{model_id}/bodies/{body_id} — Update a body's human-readable name.
DELETE /models/{model_id}/bodies/{body_id} — Hard-delete the ``BodyOrm`` metadata row for a body.
GET    /models/{model_id}/bodies/{body_id}/boundary — Return the user-authored boundary shape for a body.
PUT    /models/{model_id}/bodies/{body_id}/boundary — Full-replace the boundary shape + nodes for a body.
DELETE /models/{model_id}/boundaries — Reset every user-authored body boundary shape for a model.
POST   /models/{model_id}/bodies/{body_id}/perpendicular-companion — Auto-create a perpendicular companion cross-section for a body.
GET    /formations/{formation_id}/absences — Return all absence records for a formation in this project.
POST   /formations/{formation_id}/absences — Create or promote a formation absence row.
```

**Geology » Body separations (Separate / Rejoin) — `geology/body_separations.py`**

```
POST   /models/{model_id}/body-separations — Record that two bodies must never resolve into one, then re-resolve.
GET    /models/{model_id}/body-separations — Return the model's separations, each with its two anchors' current bodies.
DELETE /models/{model_id}/body-separations/{sep_id} — Delete one separation and re-run the resolver — the Rejoin.
```

**Geology » Body unions (Join / Disjoin) — `geology/body_unions.py`**

```
POST   /models/{model_id}/body-unions — Record that two bodies belong to one GROUP, then re-resolve.
GET    /models/{model_id}/body-unions — Return the model's unions, each with its two anchors' current bodies.
DELETE /models/{model_id}/body-unions/{union_id} — Delete one union and re-run the resolver — the Disjoin (ungroup).
```

**Geology » Contact correlations — `geology/contact_correlations.py`**

```
POST   /models/{model_id}/contact-correlations — Record that two formation contacts represent the same boundary across columns.
DELETE /models/{model_id}/contact-correlations — Remove the contact-level correlation edge between two contacts.
GET    /models/{model_id}/contact-correlations — Return contact-level correlation edges in the model.
POST   /models/{model_id}/contact-correlations/auto — Run the contact-level auto-correlate algorithm for a model.
DELETE /models/{model_id}/contact-correlations/auto — Remove unapproved (suggestion) contact-correlation edges for a model.
POST   /models/{model_id}/contact-correlations/accept — Flip ``user_approved=True`` for in-scope unapproved edges.
POST   /models/{model_id}/contact-correlations/{edge_id}/accept — Flip ``user_approved=True`` for one edge identified by ``edge_id``.
POST   /models/{model_id}/contact-correlations/{edge_id}/confirm-review — Clear ``review_reason`` on one edge — the engineer says the tie is right.
POST   /models/{model_id}/contact-correlations/confirm-review — Clear ``review_reason`` on every flagged edge of the model.
POST   /models/{model_id}/body-companions/materialise — Auto-create companion sections for lenses whose primary section is fully correlated.
PATCH  /models/{model_id}/contact-correlations/admixtures — Write ``litho_admixtures`` to every formation in the seed's connected component.
```

**Geology » Geotech subdivision — `geology/geotech.py`**

```
POST   /models/{model_id}/geotech/subdivide-all-bodies — Classify and materialise geotech NAD bodies for all litho bodies in the model.
POST   /models/{model_id}/geotech/subdivide-cpts — Materialise the CPT packing bands WITHOUT proposing any tie.
GET    /models/{model_id}/geotech/litho-staleness — Report the geotech columns standing on litho that has since been edited.
GET    /models/{model_id}/geotech/tie-status — Report the geotech model's packing ties by approval state.
POST   /models/{model_id}/geotech/divide-boreholes — Materialise geotech packing bands on the borehole columns.
POST   /models/{model_id}/geotech/divide-boreholes/preview — Answer what packing each borehole would get, without writing anything.
POST   /models/{model_id}/geotech/auto-correlate — Re-derive the automatic geotech packing ties as UNAPPROVED suggestions.
POST   /models/{model_id}/geotech/bands/preview-split — Answer what a proposed split would do, without writing anything.
POST   /models/{model_id}/geotech/bands/preview-merge — Answer what a proposed merge would do, without writing anything.
POST   /models/{model_id}/geotech/bands/split — Commit a hand split. Only the edited column is rewritten.
POST   /models/{model_id}/geotech/columns/clear — Delete one investigation's geotech bands (owner ask 2026-08-18).
POST   /models/{model_id}/geotech/bands/set-class — Commit an engineer-chosen class on ONE borehole band. Geometry never moves.
POST   /models/{model_id}/geotech/bands/merge — Commit a hand merge. Only the edited column is rewritten.
POST   /models/{model_id}/geotech/statistic — Change which representative statistic the NAD classifier reads.
POST   /models/{model_id}/geotech/bands/preview-move — Answer what dragging this boundary to this depth would do, without writing.
POST   /models/{model_id}/geotech/bands/move — Commit the drag: an atomic two-row write, both classes re-derived.
POST   /models/{model_id}/geotech/bands/preview-absorb-run — Answer what a Ctrl+drag absorb-all would do (the run unions, its far boundary moves), without writing.
POST   /models/{model_id}/geotech/bands/absorb-run — Commit the absorb-all in one transaction: the survivor takes the union, the entered band the remainder.
POST   /models/{model_id}/geotech/contact/move — Move a contact restated by a packing boundary, in every model that records it.
```

**Geology » Litho 3-D solids + footprint — `geology/litho_solids.py`**

```
GET    /models/{model_id}/litho-solids — Return every cached 3-D solid in this lithostratigraphic model.
POST   /models/{model_id}/litho-solids/build-voxel — Build the 3-D litho-solid cache from the validated 2-D voxel partitions (synchronous; blocks until built).
POST   /models/{model_id}/litho-solids/build-voxel/jobs — Spawn the SAME build as a background job; answers 202 {job_id} at once. 409 (code voxel_build_already_running) if a build for this model is already running.
GET    /models/{model_id}/litho-solids/build-voxel/jobs/{job_id} — SSE stream of the running build: {type:progress, phase, done, total} ticks (phase label/reconcile/extract/persist), then a terminal {type:done, ...RebuildLithoSolidsResponse...} or {type:error, code, message}.
POST   /models/{model_id}/litho-solids/build-voxel/jobs/{job_id}/cancel — Set the cooperative cancel flag; the build stops between columns, rolls back (nothing written), and its stream ends {type:error, code:build_cancelled}. 404 if no cancellable job.
GET    /models/{model_id}/litho-solids/build-report — Return the seven-clause gapless-gate report of the model's LATEST build.
PATCH  /models/{model_id}/bodies/{body_id}/color — Update the per-body display colour override for the 3-D viewer.
GET    /models/{model_id}/footprint — Return the model's footprint ring, re-derived from its last voxel build.
```

**Geology » Exports (Plaxis 3D + fence DXF) — `geology/exports.py`**

```
GET    /models/{model_id}/export/plaxis3d — Export the geological model as a runnable Plaxis 3D Python script.
POST   /models/{model_id}/export/fence-dxf — Export the client-built 3-D fence diagram as a DXF file.
```

Re-import semantics for `POST /cpt/import`: a file whose CPT is already in the
project (same GEF project_id + test_id) can REFRESH the existing row — series
and header replaced from the fresh parse, same `cpt_id`, review + every
referencing row untouched, a manual collar elevation kept, the derived
TIN/solid caches flipped to stale. That write is irreversible, so it is
**consented, never automatic**:

* duplicate, no `confirm_refresh` → `409 Conflict` with
  `detail.code = "cpt_refresh_confirmation_required"`, `cpt_id`, `name`, and
  the diff (`old_max_depth_m` / `new_max_depth_m`, `old_n_rows` /
  `new_n_rows`, `n_errors`, `n_warnings`). **Nothing is written.**
* duplicate + `confirm_refresh=true` (form field) → `200` with
  `refreshed: true` and `name`.
* a genuinely new CPT → `201` with `refreshed: false`.
* duplicate whose fresh parse has 0 rows or ERROR-level issues → `422` with
  `detail.code = "cpt_refresh_refused"` and a named `detail.reason`
  (`no_rows` / `parse_errors`), **even with `confirm_refresh=true`** — a
  broken file must never overwrite good data. (On the GEF path a 0-row file is
  already rejected earlier with `400 "GEF file contains no data rows"`.)

The legacy `409` whose body carries only `cpt_id` + `message` is reachable
only when a caller opts out with `ImportCpt.persist(refresh_existing=False)`.

Re-import semantics for `POST /borehole/import` (a local DOV `dov-schema`
XML file, `.xml` only, 50 MiB cap → `413`, unreadable / no `<boring>` →
`400`) follow the CPT rule, per FILE: a boring whose DOV identificatie is
already in the project (`project_id = "DOV"` + `test_id`, the same key the
bbox import stores) is refreshed in place — same `borehole_id`, header values
the file carries, drill segments + field log replaced, each interpretation
whose DOV permkey matches a stored observation replaced in place (the
observation id survives; its layers are new rows), other interpretations
added, stored observations the file does not carry kept, each sample
(`<monster>`) whose DOV permkey (else sample number + top depth) matches a
stored sample updated in place (same sample id; its grain-size curves with a
matching permkey replaced, its other lab tests and geotech assignment kept),
other samples added, stored samples the file does not carry kept, a manual
collar elevation kept, the TIN/solid caches staled:

* any duplicate, no `confirm_refresh` → `409` with
  `detail.code = "borehole_refresh_confirmation_required"` and
  `detail.diffs[]` (per boring: `borehole_id`, `name`, `test_id`,
  `old_/new_total_depth_m`, `old_/new_n_litho_layers`, `n_errors`,
  `n_warnings`). **Nothing from the file is written.**
* duplicates + `confirm_refresh=true` → `200`; those borings carry
  `refreshed: true`.
* only new borings → `201`.
* a duplicate whose fresh parse has ERROR-level issues → `422` with
  `detail.code = "borehole_refresh_refused"`, even when confirmed.

The body is `{boreholes: [{borehole_id, name, test_id, has_errors, issues,
refreshed, imported}], file_issues}`; a NEW boring without a usable position
is not persisted (`imported: false`, `borehole_id: null`, a `NOT_IMPORTED`
error) while its siblings are. One commit per file. Every issue is
`{level, code, message, rows, params}`: `message` is English (logs, tooltip);
`params` (additive, defaults `{}`) carries the message's variable parts so the
desktop renders the finding in the interface language
(`desktop/.../utils/importFlagText.ts`); a client that ignores `params` keeps
showing `message`. `POST /cpt/import` issues carry the same field.

PDF report import (`/cpt/pdf/*`): the report is uploaded ONCE
(`POST /cpt/pdf/triage`, multipart `file` + `project_id`, 200 MiB cap →
`413`, non-PDF bytes → `400`) and answered `202 {job_id, file_sha}`; every
later call names it by that SHA-256 and the project. The job stream ends
with `{"type": "done", "result": <digest>}` (campaign soundings with
header + warnings, unknown-origin soundings, `dropped` sheets,
`desk_study_ids`, `ocr_available`) or `{"type": "error", ...}`. A report
that is not (or no longer) triaged in this backend process answers `404`
`detail.code = "cpt_pdf_report_unknown"`; an unlisted sounding `404`
`cpt_pdf_sounding_unknown`; a malformed calibration dict `422`
`cpt_pdf_calibration_invalid`. `POST /cpt/pdf/import`
(`{project_id, file_sha, sounding_ids[], calibrations?: {id: [PageCalibration]},
headers?: {id: {x, y, epsg, ground_level_m, test_date}}, confirm_refresh}`)
answers `200` with one result per sounding — a batch cannot be one status
code: `imported`, `refreshed` (consented), `confirmation_required` (already
in the project: **nothing written**, `code =
"cpt_refresh_confirmation_required"` + the same diff as the GEF 409; the
client asks one sounding at a time and re-posts the agreed ones with
`confirm_refresh: true`), `refused` (`pdf_no_xy` — the sheet printed no
position and none was typed; `cpt_refresh_refused`;
`pdf_sounding_not_offered` — a desk-study id), or `failed`. Each sounding
commits on its own. `GET /cpt/{cpt_id}` carries the additive
`import_provenance` (null for GEF / DOV).

DEM endpoints refuse an impossible extent locally: `GET /dem/sample` (and the
ground-surface build `POST .../ground-surface/build`) answer `422` naming the
extent when the requested coordinates fall outside the project CRS's own
domain, carry a non-finite bound, or span beyond the per-tile cap — no upstream
request is made. A tile key that just failed upstream is suppressed for a few
minutes and answers `502` (sample) / `503` (ground-surface) with the retry
window, instead of re-hitting the WCS.

DOV import guards refuse a runaway or duplicate import before it fans out. The
`import-dov` request schemas reject a **reversed/degenerate bbox** (`422`, naming the
wrong corner) and a bbox larger than **625 km²** (25 km × 25 km, `422` naming the
limit). Discovery that resolves more than **2000** DOV records stops before any
download: `POST /{cpt,borehole}/import-dov` answers `422` with
`detail.code = "dov_import_too_large"`; the streaming path emits a terminal SSE
`{"type":"error","code":"dov_import_too_large", ...}` event — both name the count
and the limit. `POST /{cpt,borehole}/import-dov/stream` refuses a second import of
the same scope (resource-kind + bbox + project) while the first is still running with
`409 Conflict`, `detail.code = "dov_import_already_running"` and the running `job_id`
(the client attaches to the existing stream). A 429/503 from DOV is retried
(`Retry-After` honoured) rather than surfaced.

Body-partition contention is a `409`, not a hung request or a `500`. Every
body-partition write serialises on a per-model advisory lock; the session sets
`lock_timeout` (30 s), so a writer that cannot get the lock in time aborts and the
handler answers `409 Conflict` with `detail.code = "body_partition_locked"` naming
the waiting operation (e.g. `bodies/recompute`). Any other Postgres lock-timeout that
escapes a route maps to `409` with `detail.code = "lock_timeout"`. Both are
retryable — the action was not applied.

Body shape is **not** stored as lateral extents: the retired `/bodies/detect`,
`/bodies/suggest-pinch-outs`, bulk `DELETE /bodies`, and the per-side extent
endpoints were removed with the body-extent retirement — body shape is derived
client-side by the partition fill and persisted only as the merged `BodyOrm`
metadata + optional user-authored boundary shape above.
