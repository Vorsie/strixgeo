"""Configuration for the StrixGeo code guide generator and checker.

This is the single source of truth shared by :mod:`generate_pages` and
:mod:`check_pages`:

* which source trees the guide covers (``SOURCE_ROOTS``);
* which pages must be fully explained before the checker will pass
  (``COMPLETE_MODULES``);
* the beta-critical reading order that drives the index pages
  (``READING_ORDER``).

Kept as plain module-level data (per the project convention that constants live
in a dedicated file) so a value change touches one place. It is imported by the
two scripts after they add this directory to ``sys.path``; it deliberately
imports nothing from ``groundmodel`` so the guide can be generated and checked
without importing the application or standing up a database.
"""

from __future__ import annotations

from pathlib import Path

# Repository root, resolved from this file's location on disk
# (``<repo>/docs/code-guide/code_guide_config.py``) rather than from the working
# directory, so the scripts work no matter where they are invoked from.
REPO_ROOT: Path = Path(__file__).resolve().parents[2]

# The Sphinx source directory (this folder) and the sub-folder that holds the
# one-page-per-source-file pages.
GUIDE_ROOT: Path = Path(__file__).resolve().parent
PAGES_DIRNAME: str = "pages"

# Source trees the guide documents, as ``(label, path-relative-to-repo)``. The
# Python backend ships first; the desktop TypeScript tree is added to this list
# when the campaign reaches it (the generator already knows how to split
# ``.ts`` / ``.tsx`` — see ``code_guide_lib.split_typescript_source``).
SOURCE_ROOTS: list[tuple[str, str]] = [
    ("groundmodel", "src/groundmodel"),
]

# File suffixes the generator turns into pages, per source tree. Python only for
# now; ``.ts`` / ``.tsx`` are listed so a later desktop root picks them up.
PYTHON_SUFFIXES: tuple[str, ...] = (".py",)
TYPESCRIPT_SUFFIXES: tuple[str, ...] = (".ts", ".tsx")

# Directory names skipped anywhere in a source tree.
IGNORED_DIR_NAMES: frozenset[str] = frozenset(
    {"__pycache__", ".mypy_cache", ".pytest_cache", "node_modules", "_build"}
)

# The pages whose every block MUST carry a hand-written explanation for the
# checker to pass. These are the beta-critical files the founder reads first:
# the boot + activation path, and the CPT/geotech classification correlations.
# Everything NOT in this set is allowed to keep generated placeholders — the
# guide is a campaign, and the checker only demands completeness where a package
# has been declared done. Paths are relative to the repository root, POSIX form.
COMPLETE_MODULES: frozenset[str] = frozenset(
    {
        # Reading-order group (1): boot + activation + migrator + warm-up.
        "src/groundmodel/api/serve.py",
        "src/groundmodel/api/main.py",
        "src/groundmodel/api/boot_migration.py",
        "src/groundmodel/api/boot_migration_constants.py",
        "src/groundmodel/api/heavy_library_warmup.py",
        "src/groundmodel/api/heavy_library_warmup_constants.py",
        "src/groundmodel/infrastructure/db/database_migrator.py",
        "src/groundmodel/infrastructure/db/database_migrator_constants.py",
        # The CPT / NAD / litho classification correlations.
        "src/groundmodel/domain/services/robertson_2015.py",
        "src/groundmodel/domain/services/nad_classifier.py",
        "src/groundmodel/domain/services/nad_classification_constants.py",
        "src/groundmodel/domain/services/litho_segmentation.py",
        # Reading-order group (2): the parsers — GEF CPT, DOV CPT, DOV borehole,
        # DOV lab, and the shared DOV WFS/HTTP infrastructure.
        "src/groundmodel/infrastructure/parsers/__init__.py",
        "src/groundmodel/infrastructure/parsers/borehole/__init__.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/__init__.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/borehole_parse_result.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/borehole_wfs_row.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/dov_boring_parser.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/dov_client.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/dov_constants.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_client.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/dov_interpretation_parser.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/dov_sample_client.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_parse_result.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_wfs_row.py",
        "src/groundmodel/infrastructure/parsers/borehole/dov/sample_wfs_row.py",
        "src/groundmodel/infrastructure/parsers/cpt/__init__.py",
        "src/groundmodel/infrastructure/parsers/cpt/dov/__init__.py",
        "src/groundmodel/infrastructure/parsers/cpt/dov/dov_client.py",
        "src/groundmodel/infrastructure/parsers/cpt/dov/dov_constants.py",
        "src/groundmodel/infrastructure/parsers/cpt/dov/dov_parse_worker.py",
        "src/groundmodel/infrastructure/parsers/cpt/dov/dov_parser.py",
        "src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/__init__.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/cpt_type.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/gef_constants.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/gef_crs_codes.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/gef_header.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/gef_parse_result.py",
        "src/groundmodel/infrastructure/parsers/cpt/gef/gef_parser.py",
        "src/groundmodel/infrastructure/parsers/cpt/validation/__init__.py",
        "src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py",
        "src/groundmodel/infrastructure/parsers/cpt/validation/validation_level.py",
        "src/groundmodel/infrastructure/parsers/dov/__init__.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_common.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_fixture_transport.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_gml_location.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_http.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_http_retry.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_wfs_bbox.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_wfs_client_base.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_wfs_download.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_wfs_request.py",
        "src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py",
        "src/groundmodel/infrastructure/parsers/dov/virtuele_boring_client.py",
        "src/groundmodel/infrastructure/parsers/dov/virtuele_boring_constants.py",
        "src/groundmodel/infrastructure/parsers/dov/virtuele_boring_result.py",
        "src/groundmodel/infrastructure/parsers/lab/__init__.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/__init__.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/dov_constants.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_client.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/dov_grain_size_parser.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/dov_scalar_observation_client.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/grain_size_parse_result.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/grain_size_wfs_row.py",
        "src/groundmodel/infrastructure/parsers/lab/dov/scalar_observation_wfs_row.py",
        # Reading-order group (3): domain models + value objects, the ORM
        # tables, and the repositories (including the .strix bundle
        # build / restore package).
        "src/groundmodel/domain/models/__init__.py",
        "src/groundmodel/domain/models/borehole/__init__.py",
        "src/groundmodel/domain/models/borehole/borehole.py",
        "src/groundmodel/domain/models/borehole/drill_segment.py",
        "src/groundmodel/domain/models/borehole/field_log_interval.py",
        "src/groundmodel/domain/models/borehole/observation.py",
        "src/groundmodel/domain/models/borehole/observation_layer.py",
        "src/groundmodel/domain/models/borehole/sample.py",
        "src/groundmodel/domain/models/job.py",
        "src/groundmodel/domain/models/job_status.py",
        "src/groundmodel/domain/models/lab/__init__.py",
        "src/groundmodel/domain/models/lab/atterberg_limits.py",
        "src/groundmodel/domain/models/lab/caco3_content.py",
        "src/groundmodel/domain/models/lab/grain_size.py",
        "src/groundmodel/domain/models/lab/lab_test.py",
        "src/groundmodel/domain/models/lab/organic_content.py",
        "src/groundmodel/domain/models/lab/scalar_lab_test.py",
        "src/groundmodel/domain/models/lab/water_content.py",
        "src/groundmodel/domain/value_objects/__init__.py",
        "src/groundmodel/domain/value_objects/admixture.py",
        "src/groundmodel/domain/value_objects/contact_depth.py",
        "src/groundmodel/domain/value_objects/contact_point_3d.py",
        "src/groundmodel/domain/value_objects/coordinate.py",
        "src/groundmodel/domain/value_objects/depth.py",
        "src/groundmodel/domain/value_objects/derived_value_source.py",
        "src/groundmodel/domain/value_objects/elevation_source.py",
        "src/groundmodel/domain/value_objects/field_log_kind.py",
        "src/groundmodel/domain/value_objects/formation_contact_result.py",
        "src/groundmodel/domain/value_objects/formation_surface_input.py",
        "src/groundmodel/domain/value_objects/gap_issue.py",
        "src/groundmodel/domain/value_objects/litho_body_mesh.py",
        "src/groundmodel/domain/value_objects/observation_type.py",
        "src/groundmodel/domain/value_objects/section_line_2d.py",
        "src/groundmodel/domain/value_objects/slice_point.py",
        "src/groundmodel/domain/value_objects/tin_surface.py",
        "src/groundmodel/domain/value_objects/unit_weight_profile.py",
        "src/groundmodel/domain/value_objects/water_depth_source.py",
        "src/groundmodel/infrastructure/db/models/__init__.py",
        "src/groundmodel/infrastructure/db/models/admixture_orm.py",
        "src/groundmodel/infrastructure/db/models/atterberg_limits_orm.py",
        "src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py",
        "src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py",
        "src/groundmodel/infrastructure/db/models/body_geometry_fact_orm.py",
        "src/groundmodel/infrastructure/db/models/body_orm.py",
        "src/groundmodel/infrastructure/db/models/body_separation_orm.py",
        "src/groundmodel/infrastructure/db/models/body_union_orm.py",
        "src/groundmodel/infrastructure/db/models/borehole_orm.py",
        "src/groundmodel/infrastructure/db/models/caco3_content_orm.py",
        "src/groundmodel/infrastructure/db/models/cpt_orm.py",
        "src/groundmodel/infrastructure/db/models/cpt_series_orm.py",
        "src/groundmodel/infrastructure/db/models/cross_section_orm.py",
        "src/groundmodel/infrastructure/db/models/drill_segment_orm.py",
        "src/groundmodel/infrastructure/db/models/field_log_interval_orm.py",
        "src/groundmodel/infrastructure/db/models/formation_absence_orm.py",
        "src/groundmodel/infrastructure/db/models/formation_contact_orm.py",
        "src/groundmodel/infrastructure/db/models/formation_surface_orm.py",
        "src/groundmodel/infrastructure/db/models/geological_formation_orm.py",
        "src/groundmodel/infrastructure/db/models/geological_model_orm.py",
        "src/groundmodel/infrastructure/db/models/geotech_tie_tombstone_orm.py",
        "src/groundmodel/infrastructure/db/models/grain_size_orm.py",
        "src/groundmodel/infrastructure/db/models/investigation_review_orm.py",
        "src/groundmodel/infrastructure/db/models/lab_test_family_constants.py",
        "src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py",
        "src/groundmodel/infrastructure/db/models/litho_build_generation_orm.py",
        "src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py",
        "src/groundmodel/infrastructure/db/models/litho_layer_orm.py",
        "src/groundmodel/infrastructure/db/models/observation_layer_orm.py",
        "src/groundmodel/infrastructure/db/models/observation_orm.py",
        "src/groundmodel/infrastructure/db/models/organic_content_orm.py",
        "src/groundmodel/infrastructure/db/models/orm_relationship_constants.py",
        "src/groundmodel/infrastructure/db/models/project_orm.py",
        "src/groundmodel/infrastructure/db/models/sample_orm.py",
        "src/groundmodel/infrastructure/db/models/scalar_lab_test_orm.py",
        "src/groundmodel/infrastructure/db/models/water_content_orm.py",
        "src/groundmodel/infrastructure/db/repositories/__init__.py",
        "src/groundmodel/infrastructure/db/repositories/borehole_repository.py",
        "src/groundmodel/infrastructure/db/repositories/cpt_repository.py",
        "src/groundmodel/infrastructure/db/repositories/cross_section_repository.py",
        "src/groundmodel/infrastructure/db/repositories/dov_dedup.py",
        "src/groundmodel/infrastructure/db/repositories/geology_repository.py",
        "src/groundmodel/infrastructure/db/repositories/investigation_review_repository.py",
        "src/groundmodel/infrastructure/db/repositories/litho_layer_repository.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/__init__.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_clone.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_collections.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_core.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_drops.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_row_builders.py",
        "src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_serialization.py",
        "src/groundmodel/infrastructure/db/repositories/project_repository.py",
        # Reading-order group (6): the exporters — the three exporter base
        # classes, the DXF section + fence writers, the Plaxis 2D/3D script
        # emitters, the Deltares D-Series (D-Stability + D-Sheet Piling)
        # writers, and the shared unit-identifier / label / styling helpers.
        "src/groundmodel/infrastructure/exporters/__init__.py",
        "src/groundmodel/infrastructure/exporters/ascii_fold.py",
        "src/groundmodel/infrastructure/exporters/dsheet_piling_exporter.py",
        "src/groundmodel/infrastructure/exporters/dsheet_piling_exporter_constants.py",
        "src/groundmodel/infrastructure/exporters/dstability_exporter.py",
        "src/groundmodel/infrastructure/exporters/dstability_exporter_constants.py",
        "src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py",
        "src/groundmodel/infrastructure/exporters/dxf_fence_exporter_constants.py",
        "src/groundmodel/infrastructure/exporters/dxf_layer_style.py",
        "src/groundmodel/infrastructure/exporters/dxf_section_exporter.py",
        "src/groundmodel/infrastructure/exporters/dxf_text_safety.py",
        "src/groundmodel/infrastructure/exporters/fence_panel_source.py",
        "src/groundmodel/infrastructure/exporters/nad_soil_parameter_lookup.py",
        "src/groundmodel/infrastructure/exporters/plaxis_exporter.py",
        "src/groundmodel/infrastructure/exporters/plaxis_script_helpers.py",
        "src/groundmodel/infrastructure/exporters/plaxis_section_exporter.py",
        "src/groundmodel/infrastructure/exporters/project_exporter.py",
        "src/groundmodel/infrastructure/exporters/section_exporter.py",
        "src/groundmodel/infrastructure/exporters/section_geometry_exporter.py",
        "src/groundmodel/infrastructure/exporters/section_unit_labels.py",
        "src/groundmodel/infrastructure/exporters/unit_identifier.py",
        "src/groundmodel/infrastructure/exporters/unit_identifier_constants.py",
        # Reading-order group (5): the geotech stage — the two subdivision use
        # cases and the geotech_* application helpers (band edit, borehole
        # materialiser, edge derivation, tie re-anchor / status / tombstones,
        # crossing + off-section sweeps, litho staleness, view-state).
        "src/groundmodel/application/divide_boreholes.py",
        "src/groundmodel/application/subdivide_all_bodies.py",
        "src/groundmodel/application/geotech_band_edit_constants.py",
        "src/groundmodel/application/geotech_band_edit_helpers.py",
        "src/groundmodel/application/geotech_borehole_materialiser.py",
        "src/groundmodel/application/geotech_crossing_sweep.py",
        "src/groundmodel/application/geotech_edge_derivation.py",
        "src/groundmodel/application/geotech_litho_staleness.py",
        "src/groundmodel/application/geotech_offsection_sweep.py",
        "src/groundmodel/application/geotech_tie_reanchor.py",
        "src/groundmodel/application/geotech_tie_status.py",
        "src/groundmodel/application/geotech_tie_tombstones.py",
        "src/groundmodel/application/geotech_view_state.py",
    }
)


# The beta-critical reading order. Each group becomes one index page with a
# hand-written introduction and a toctree of its file pages. Groups are matched
# in list order: a module joins the FIRST group that names it in ``members`` or
# whose ``prefixes`` it starts with. Anything unmatched falls into the generated
# "Everything else" group, bucketed by top-level package.
#
# ``members`` is an ordered list of exact repo-relative paths — used where the
# reading order is curated and spans directories (group 1). ``prefixes`` is a
# list of repo-relative path prefixes — used for whole-package groups.
READING_ORDER: list[dict[str, object]] = [
    {
        "slug": "01-boot-and-activation",
        "title": "1. Boot and activation — how the engine starts",
        "members": [
            "src/groundmodel/api/serve.py",
            "src/groundmodel/api/main.py",
            "src/groundmodel/api/boot_migration.py",
            "src/groundmodel/api/boot_migration_constants.py",
            "src/groundmodel/infrastructure/db/database_migrator.py",
            "src/groundmodel/infrastructure/db/database_migrator_constants.py",
            "src/groundmodel/api/heavy_library_warmup.py",
            "src/groundmodel/api/heavy_library_warmup_constants.py",
        ],
        "prefixes": [],
    },
    {
        "slug": "02-parsers",
        "title": "2. Parsers — reading CPT, borehole and DOV data",
        "members": [],
        "prefixes": ["src/groundmodel/infrastructure/parsers/"],
    },
    {
        "slug": "03-domain-models-and-storage",
        "title": "3. Domain models and storage — the shape of the data",
        "members": [],
        "prefixes": [
            "src/groundmodel/domain/models/",
            "src/groundmodel/domain/value_objects/",
            "src/groundmodel/infrastructure/db/models/",
            "src/groundmodel/infrastructure/db/repositories/",
        ],
    },
    {
        "slug": "04-litho-engine",
        "title": "4. The fill / litho engine — turning readings into layers",
        "members": [],
        "prefixes": ["src/groundmodel/domain/services/"],
    },
    {
        "slug": "05-geotech",
        "title": "5. Geotech — NAD packing classes and subdivision",
        "members": [
            "src/groundmodel/application/divide_boreholes.py",
            "src/groundmodel/application/subdivide_all_bodies.py",
        ],
        "prefixes": [
            "src/groundmodel/application/geotech_",
        ],
    },
    {
        "slug": "06-exports",
        "title": "6. Exports — writing files for design tools",
        "members": [],
        "prefixes": ["src/groundmodel/infrastructure/exporters/"],
    },
]

# Slug/title for the catch-all group that holds every source file no reading-
# order group claimed. Bucketed by top-level package into one sub-index each.
REST_GROUP_SLUG: str = "07-everything-else"
REST_GROUP_TITLE: str = "7. Everything else — the rest of the codebase"
