# Project Structure

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Project Structure

`src` layout — package lives under `src/groundmodel/`.

```
Strix/
├── src/groundmodel/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── borehole/      borehole.py, sample.py,
│   │   │   │                  observation.py, observation_layer.py,
│   │   │   │                  drill_segment.py, field_log_interval.py
│   │   │   ├── lab/           lab_test.py, grain_size.py, atterberg_limits.py,
│   │   │   │                  caco3_content.py, organic_content.py, water_content.py
│   │   │   └── job.py         Job + JobStatus (job_status.py)
│   │   ├── services/          cpt_interpretation.py, cpt_corrections.py,
│   │   │                      voxel_litho/ (Numba greedy-mesh) + the litho /
│   │   │                      geotech / correlation domain-logic services
│   │   └── value_objects/     depth.py, coordinate.py, unit_weight_profile.py,
│   │                          observation_type.py, field_log_kind.py, admixture.py,
│   │                          derived_value_source.py
│   ├── application/           75 use-case modules (imports, litho, geotech,
│   │                          bodies, sections, exports) — see "Application
│   │                          use cases" below; task_queue.py (ABC) +
│   │                          synchronous_queue.py (MVP inline) + job_registry.py
│   ├── infrastructure/
│   │   ├── db/                models/         cpt_orm.py, cpt_series_orm.py,
│   │   │                                      borehole_orm.py, drill_segment_orm.py,
│   │   │                                      field_log_interval_orm.py,
│   │   │                                      observation_orm.py, observation_layer_orm.py,
│   │   │                                      admixture_orm.py, sample_orm.py,
│   │   │                                      grain_size_orm.py, atterberg_limits_orm.py,
│   │   │                                      caco3_content_orm.py, organic_content_orm.py,
│   │   │                                      water_content_orm.py, scalar_lab_test_orm.py
│   │   │                      repositories/   cpt_repository.py, borehole_repository.py,
│   │   │                                      project_bundle/ (package: bundle_serialization,
│   │   │                                      bundle_row_builders, bundle_build,
│   │   │                                      bundle_restore_litho, bundle_restore_core,
│   │   │                                      __init__ facade)
│   │   │                      migrations/
│   │   ├── parsers/
│   │   │   ├── dov/           dov_common.py — DOV-domain shared constants
│   │   │   ├── cpt/           gef/ (gef_parser + header/constants/crs/type),
│   │   │   │                      dov/ (streaming DOV import worker)
│   │   │   ├── borehole/      dov/dov_constants.py, dov_boring_parser.py,
│   │   │   │                      borehole_parse_result.py,
│   │   │   │                      dov_interpretation_parser.py,
│   │   │   │                      interpretation_parse_result.py
│   │   │   ├── lab/           dov/dov_constants.py, dov_grain_size_parser.py,
│   │   │   │                      grain_size_parse_result.py
│   │   │   └── validation/    validation_issue.py + validation_level.py —
│   │   │                          shared ValidationIssue / ValidationLevel across
│   │   │                          CPT, borehole and lab parsers (a cpt/validation/
│   │   │                          shim re-exports the old path for back-compat)
│   │   ├── exporters/         project/section/section_geometry ABCs; plaxis 2D/3D,
│   │   │                      dxf section/fence, dstability, dsheet_piling,
│   │   │                      (the cross-section PDF is rendered client-side, see docs/exports.md)
│   │   ├── dem/               dem_provider.py (DemProvider ABC + DemZGrid),
│   │   │                      wcs_dem_provider.py (WcsDemProvider — shared
│   │   │                      WCS GetCoverage + tile-cache + GeoTIFF-decode
│   │   │                      pipeline; subclasses set constants + _extract_tiff
│   │   │                      / _is_nodata hooks), dhmvii_dem_provider.py,
│   │   │                      ahn4_dem_provider.py (both thin subclasses),
│   │   │                      dem_provider_factory.py (build_dem_provider,
│   │   │                      NoDemProviderError), dem_tile_cache.py,
│   │   │                      dhmvii_sampler.py (WCS multipart + line sampler)
│   │   ├── gis/               spatial_query.py
│   │   ├── codelists/         g3dv3_catalog.py — Flanders stratigraphy
│   │   │                      lookup; data/ has the DOV CSVs (hoofdnaam,
│   │   │                      kleur, consistentie), G3Dv3 xlsx sources +
│   │   │                      generated g3dv3_units.json + g3dv3_aliases.json
│   │   └── (no rust/ yet)     Rust+PyO3 deferred; the profiled hotspot uses
│   │                          Numba @njit (domain/services/voxel_litho/greedy_mesh.py)
│   ├── api/
│   │   ├── routers/           9 top-level + geology/ (13 sub-routers)
│   │   │                      — see "API routers" below
│   │   ├── schemas/
│   │   └── main.py
│   └── shared/
│       ├── logging/           levels.py, ground_model_logger.py,
│       │                      logger_factory.py
│       ├── config.py          pydantic-settings Settings
│       └── exceptions.py
├── tests/
│   ├── unit/                  no DB, no I/O
│   ├── integration/           real DB (Docker Compose)
│   ├── e2e/                   full HTTP round-trips
│   └── fixtures/contracts/    cross-language TWIN arbiters (debt #284): one
│                              committed JSON per rule that lives in both Python
│                              and TypeScript (section_corridor_membership,
│                              packing_class_key, admixture_canonical_key,
│                              robertson_sbt_bands), read by a Python
│                              tests/unit/.../test_twin_*.py AND a desktop
│                              *.twin.test.ts so a drift on one side reddens the
│                              other
├── pyproject.toml
├── docker-compose.yml         PostgreSQL + PostGIS
├── alembic.ini
└── .env.example
```

## API routers

23 router modules, 144 routes. Top-level routers are mounted in `api/main.py`; the 13 `geology/` sub-routers are aggregated under one `/projects/{project_id}/geology` prefix (debt #40). Full per-route catalogue: [api.md](api.md).

**Top-level — `api/routers/`**

```
cpt.py                     12 routes  CPT import (file + DOV bbox + SSE stream), metadata, plot, SBT profile, elevation, water-table
borehole.py                 7 routes  Borehole DOV import (+ SSE stream), full detail tree, batch detail, elevation
project.py                 10 routes  Project CRUD, archive/unarchive, bundle snapshot, restore, duplicate
cross_section.py           11 routes  Cross-section CRUD + per-section exports (DXF, PDF, Plaxis 2D, D-Stability, D-Sheet Piling)
dem.py                      1 routes  Sample DEM elevations along a line
investigation_review.py     5 routes  Per-investigation review decisions + project view-state patch
codelists.py                2 routes  G3Dv3 + DOV formal-stratigraphy lookup lists
stratigraphy_lumping.py     2 routes  Staged/promote lumping snapshot slots
virtuele_boring.py          2 routes  DOV Virtuele Boring lagenmodel catalogue + per-project overlay predictions
bed_override.py             4 routes  Manual bed-level polygon CRUD
```

**Geology package — `api/routers/geology/` (parent prefix `/projects/{project_id}/geology`)**

```
formations.py               5 routes  Formation CRUD + name codelist
models.py                   5 routes  Geological/litho/geotech model CRUD + activate
contacts.py                 5 routes  Formation-contact CRUD + batch
litho_ops.py                8 routes  Auto-populate / seed / suggest / accept litho contacts + dedupe + clear
litho_layers.py             8 routes  Litho-layer CRUD, boundary-move, batch status/update, link-geo
surfaces.py                 5 routes  TIN rebuild, surfaces read, stratigraphy + crossing validation, ground-surface build
bodies.py                  11 routes  Body metadata + boundary shapes + recompute + companions + formation absences
body_separations.py         3 routes  Separate / Rejoin durable body-separation rulings
body_unions.py              3 routes  Join / Disjoin durable body-group rulings
contact_correlations.py    11 routes  Contact-correlation edges: create/delete/auto/accept/confirm-review + admixtures
geotech.py                 17 routes  Geotech NAD subdivision: subdivide, divide-boreholes, band split/merge/move/set-class, ties
litho_solids.py             5 routes  3-D litho-solid voxel build + build-report + body colour + footprint
exports.py                  2 routes  Plaxis 3D script + 3-D fence DXF
```

## Application use cases

75 use-case classes (one orchestrator per unit of work, most exposing `execute`). The application layer has 120 modules total — the remaining ~45 are supporting DTOs, result value objects, constants, shared helpers, the re-anchor machinery, and the task-queue abstraction (`task_queue.py` ABC + `synchronous_queue.py` MVP inline impl + `job_registry.py`). One of the DTOs is `export_artifact.py` (`ExportArtifact`), the framework-free download contract every export route returns for the API layer to serve (debt #110).

**Imports + interpretation**

```
ImportCpt — Use case: parse a CPT file and persist it to the database.
ImportCptDov — Use case: query DOV WFS for a bbox, download CPT XMLs, and persist them.
ImportBoreholeDov — Use case: query DOV WFS for a bbox, download borehole XMLs, persist them.
ImportInterpretationsDov — Use case: query DOV interpretation streams in a bbox, attach to boreholes.
ImportSamplesDov — Use case: query DOV sample + grain-size streams in a bbox, attach to boreholes.
RunInterpretation — Run EC7 soil classification + Robertson Ic for a stored CPT.
FetchVirtueleBoringPredictions — Use case: fetch per-investigation Virtuele Boring overlays.
```

**Sections + snapshots**

```
BatchCreateSections — Create several cross-sections atomically (one commit).
BuildSectionSnapshot — Materialise the data needed to render or export one section.
BuildSectionPolygons — Turn a renderer-drawn section partition into a ``SectionPolygonSet``.
BuildGroundModelSnapshot — Materialise the data needed to export a whole geological model.
```

**Formations + contacts**

```
CreateFormationContact — Insert one formation contact and commit the transaction.
UpdateFormationContact — Apply a partial update to one formation contact and commit.
UpdateFormationContactsBatch — Apply N partial updates to formation contacts and commit once.
DeleteFormationContact — Drop one formation-contact row and commit.
DeduplicateFormationContacts — Drop duplicate (model, anchor, formation) contacts.
AutoPopulateContactsFromStratigraphy — Seed a geological model with contacts derived from DOV stratigraphy.
DiscoverFormationsFromStratigraphy — Read-only use case: scan boreholes and return candidate formation names.
OrphanFormationSweep — Delete project formations that no layer, contact or body references.
MaterializeWedgeTipsForFormation — Re-materialise synthetic wedge-tip contacts for one formation after an absence delta.
```

**Surfaces + validation**

```
RebuildModelSurfaces — Force-recompute every formation's TIN cache in one model.
RecomputeFormationSurface — Refresh the cached TIN for a (model, formation) pair.
BuildGroundSurface — Build the ground-surface TIN for a geological model.
ValidateBoreholeStratigraphy — Run the no-gaps validator for one borehole in one model.
ValidateModelCrossings — Run the cross-formation crossing validator for one model.
```

**Formation absences (inference)**

```
UpsertFormationAbsence — Create or promote a formation absence row.
RecomputeFormationAbsencesForBody — Run the inference engine for one body and apply the delta to the DB.
RecomputeFormationAbsencesForFormation — Formation-level trigger for the Position 4 inference engine.
RecomputeAllAbsencesForModel — Bulk inference recompute for all formations in a lithostratigraphic model.
```

**Lithostratigraphy**

```
SeedLithoFromGeologicalModel — Copy a parent geological model's contacts into a lithostratigraphic model.
SuggestLithoContacts — Read-only use case: segment an investigation and return layer suggestions.
AcceptLithoSuggestions — Bulk idempotent use case: commit litho suggestions to the litho model.
BatchAcceptLithoSuggestions — Commit the accepted suggestions of many anchors in one transaction.
BulkCreateLithoLayers — Insert N ``litho_layer`` rows + commit.
ListLithoLayersForModel — List the layers for a lithostratigraphic model with optional filters.
UpdateLithoLayer — Apply a partial update to one ``litho_layer`` row + commit.
BatchUpdateLithoLayers — Apply per-row patches to N layers in one transaction.
DeleteLithoLayer — Hard-delete one ``litho_layer`` row and reconcile downstream state.
MoveLithoLayerBoundary — Atomically move the shared boundary between two adjacent layers.
ClearLithoModel — Delete all content from a lithostratigraphic model in one transaction.
PropagateLithoAdmixtures — Write ``litho_admixtures`` to every formation in a correlated body.
LinkLithoToGeo — Use case: manually link a lithostratigraphic contact to the nearest
UnlinkLithoFromGeo — Use case: break the litho↔geo coupling on a single contact (#162 Task 6).
ResolveLithoInstances — Re-run the litho-instance resolver for one model and commit the result.
```

**Contact correlations + companions**

```
CorrelateLithoContacts — Create (or confirm) a contact-level correlation edge (#133 Phase 1).
UncorrelateLithoContacts — Delete a contact-level correlation edge (#133 Phase 1).
AutoCorrelateContactEdges — Run contact-level auto-correlate for a litho model.
AcceptContactCorrelations — Approve unapproved contact-correlation edges in scope.
ConfirmCorrelationEdgeReview — Drop ``review_reason`` from one edge or from a whole model.
MaterialiseBodyCompanions — Create perpendicular companion sections for qualifying bodies.
CreatePerpendicularCompanion — Auto-create a perpendicular companion cross-section for a litho lens.
```

**Bodies**

```
RecomputeBodies — Persist the geometric body merge for one litho or geotech model.
NameBody — Attach a name and optional primary section to a body.
DeleteBody — Delete the BodyOrm metadata row for a body.
GetBodyBoundary — Read the stored boundary shape for a body (read-only).
SaveBodyBoundary — Full-replace the boundary shape for a body. Commits.
ClearBodyBoundaries — Delete every user-authored boundary shape for a model. Commits.
MergeEnclosedLensBodies — Merge same-lithology host halves split by a local lens into one body.
GetBodyGeoLabels — Resolve the derived geological label for a set of bodies.
```

**3-D build**

```
BuildVoxelLithoModel — Build + persist the litho 3-D solids from the validated 2-D voxel partitions.
GetModelFootprint — Re-derive a lithostratigraphic model's footprint ring from its last build.
```

**Geotech subdivision**

```
SubdivideAllBodies — Classify + materialise geotech spatial bodies for the whole litho model.
DivideBoreholes — Fill borehole columns in an existing geotech model, litho-confined.
AutoCorrelateGeotechEdges — Re-derive geotech packing correlations as suggestions, adding only.
GeotechLithoStaleness — Compare a geotech model's recorded litho provenance against today's litho.
PreviewGeotechBandEdit — Read-only "what would this do?" for a packing-band split or merge.
SplitGeotechBand — Split one packing band in two and re-derive both halves' NAD class.
MergeGeotechBands — Merge two adjacent packing bands and re-derive the union's NAD class.
MoveGeotechBandBoundary — Drag the shared boundary of two adjacent packing bands and re-derive both.
SetGeotechBandClass — Repoint one borehole band at an engineer-chosen NAD class.
SetGeotechStatistic — Write the one choice column; everything else is derived.
ClearGeotechColumn — Delete one investigation's geotech bands so a pipeline press rebuilds it.
MoveRestatedContact — Move a restated contact and everything recorded at the same boundary.
```

**Exports support**

```
ThinExportUnits — Collapse adjacent units that share a NAD class and soil.
```

**Cache staleness**

```
StaleInvestigationCaches — Flip every cached geometry anchored at one investigation to stale.
```

## Exporters — `infrastructure/exporters/`

Three ABCs by scope + the concrete exporters. The closed-geometry family (D-Stability / D-Sheet Piling) consumes a renderer-POSTed partition and writes no design parameter. See [exports.md](exports.md).

```
project_exporter.py              ProjectExporter — Abstract base class for project-scoped ground-model exporters.
section_exporter.py              SectionExporter — Abstract base class for section-scoped ground-model exporters.
section_geometry_exporter.py     SectionGeometryExporter — Abstract base class for section exporters that need CLOSED 2-D geometry.
plaxis_exporter.py               PlaxisExporter — PLAXIS 3D exporter — emits a runnable ``plxscripting`` Python script.
plaxis_section_exporter.py       PlaxisSectionExporter — PLAXIS 2D per-section exporter — emits a runnable ``plxscripting`` script.
dxf_section_exporter.py          DxfSectionExporter — DXF exporter for cross-section geometry — v1.0 MVP gate #5.
dxf_fence_exporter.py            DxfFenceExporter — DXF exporter for the 3-D fence diagram — v1.0 MVP gate (owner ballot 2026-08-26).
dstability_exporter.py           DStabilityExporter — Export one cross-section's drawn geometry to Deltares D-Stability (``.stix``).
dsheet_piling_exporter.py        DSheetPilingExporter — Export a 1-D soil profile through one cross-section to D-Sheet Piling (``.shi``).
(cross-section PDF)             rendered by the desktop app itself — `desktop/src/renderer/src/sheet/` + Chromium printToPDF; no backend exporter (2026-09-02, docs/exports.md)
```
