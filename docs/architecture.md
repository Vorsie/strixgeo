# Project Structure

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Project Structure

`src` layout — package lives under `src/groundmodel/`.

```
Strix/
├── src/groundmodel/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── base/          insitu_test.py, investigation_point.py
│   │   │   ├── pushed/        cpt.py, dmt.py
│   │   │   ├── borehole/      borehole.py, sample.py, borehole_test.py,
│   │   │   │                  observation.py, observation_layer.py,
│   │   │   │                  drill_segment.py, field_log_interval.py
│   │   │   ├── lab/           lab_test.py, grain_size.py, atterberg_limits.py,
│   │   │   │                  caco3_content.py, organic_content.py, water_content.py,
│   │   │   │                  scalar_lab_test.py    ← catch-all family
│   │   │   ├── monitoring/    piezometer.py, inclinometer.py
│   │   │   └── job.py         Job + JobStatus
│   │   ├── services/          cpt_interpretation.py, cpt_corrections.py, ec7/
│   │   └── value_objects/     depth.py, coordinate.py, unit_weight_profile.py,
│   │                          observation_type.py, field_log_kind.py, admixture.py,
│   │                          derived_value_source.py
│   ├── application/           import_cpt.py, import_cpt_dov.py,
│   │                          import_borehole_dov.py, import_borehole_dov_result.py,
│   │                          export_project.py, run_interpretation.py, queue.py
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
│   │   │   ├── cpt/           gef_parser.py, ags_parser.py, las_parser.py
│   │   │   ├── borehole/      dov/dov_constants.py, dov_boring_parser.py,
│   │   │   │                      borehole_parse_result.py,
│   │   │   │                      dov_interpretation_parser.py,
│   │   │   │                      interpretation_parse_result.py
│   │   │   └── lab/           dov/dov_constants.py, dov_grain_size_parser.py,
│   │   │                          grain_size_parse_result.py
│   │   ├── exporters/         base_exporter.py, plaxis_exporter.py, ...
│   │   ├── dem/               dem_provider.py (DemProvider ABC + DemZGrid),
│   │   │                      wcs_dem_provider.py (WcsDemProvider — shared
│   │   │                      WCS GetCoverage + tile-cache + GeoTIFF-decode
│   │   │                      pipeline; subclasses set constants + _extract_tiff
│   │   │                      / _is_nodata hooks), dhmvii_dem_provider.py,
│   │   │                      ahn4_dem_provider.py (both thin subclasses),
│   │   │                      dem_provider_factory.py (build_dem_provider,
│   │   │                      NoDemProviderError), dem_tile_cache.py,
│   │   │                      dhmvii_sampler.py (WCS multipart + line sampler)
│   │   ├── gis/               postgis_service.py, spatial_query.py
│   │   ├── codelists/         g3dv3_catalog.py — Flanders stratigraphy
│   │   │                      lookup; data/ has the DOV CSVs (hoofdnaam,
│   │   │                      kleur, consistentie), G3Dv3 xlsx sources +
│   │   │                      generated g3dv3_units.json + g3dv3_aliases.json
│   │   └── rust/              groundmodel_core/ (Phase 4)
│   ├── api/
│   │   ├── routers/           cpt.py, borehole.py, jobs.py
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
│   └── e2e/                   full HTTP round-trips
├── pyproject.toml
├── docker-compose.yml         PostgreSQL + PostGIS
├── alembic.ini
└── .env.example
```
