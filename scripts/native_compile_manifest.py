"""Single source of truth for which backend modules are compiled to native ``.pyd``.

The packaged StrixGeo installer ships the backend as source *except* for the
modules listed in :data:`COMPILED_MODULES`, which are translated to C by Nuitka
and shipped as one ``<name>.cp311-win_amd64.pyd`` per module with the original
``.py`` deleted from the staged tree (owner ruling 2026-08-31: the engine and
parsers must not leak as readable Python from a shipped binary — otherwise a
competitor could duplicate the product).

This manifest is read by three consumers, and is the ONLY place the compiled set
is enumerated:

* ``scripts/compile-backend-natives.ps1`` — compiles each listed module in the
  staged tree, then deletes its ``.py``.
* ``scripts/build-embedded-python.ps1`` (the smoke gate) — asserts every listed
  module imports Nuitka-compiled in the staged interpreter and that no ``.py``
  twin survives.
* ``scripts/verify-staged-natives.ps1`` (the behavioural gate) — runs the real
  unit suites against the compiled ``.pyd`` artifacts.

Scope (owner rulings 5-6, 2026-08-31): the **engine** PLUS the **parsers** (all
GEF + DOV parsing modules). "The engine" is the whole pure-domain modelling
core, not a hand-picked trio: every engine-class module under
``domain/services`` (the voxel litho builder, the CPT segmenter / Robertson SBT
classifier chain, the NAD packing classifier, the full geotech subdivision
family, and the TIN/DEM/lens/correlation geometry) is compiled. A domain module
that reaches into ``infrastructure``/``api``/``application`` (or imports
SQLAlchemy / Pydantic) is by definition NOT pure domain and is carved out with
its offending import as evidence, exactly like ``greedy_mesh`` (numba) below.

Scope EXTENSION (owner ruling "Q1", 2026-09-01): the **engine-class modules that
live in ``application/``** are compiled too — a partial reversal of "the whole
application layer stays source". The owner's criterion is "algorithm modules
only; repos / use-case orchestration / API glue stay source", and he named
``divide_boreholes`` (5090 LOC), ``subdivide_all_bodies``, ``geotech_edge_
derivation`` and ``build_voxel_litho_model``. The compiled set
(:data:`_ENGINE_APPLICATION`) is those plus every OTHER ``application/`` module
whose algorithm is computed IN-MODULE rather than delegated to a compiled
``domain/services`` module.

That delegation boundary is the real ALGORITHM/orchestration line in this layer:
the band-reclassification hand-edit verbs (merge / split / move / preview), the
body-identity resolution and recompute use cases, and the auto-correlate / sweep
/ recompute-absence / import / snapshot / CRUD families all LOAD inputs, call a
``domain/services`` service that holds the actual algorithm (``plan_split`` /
``plan_merge`` / ``plan_move`` in the compiled ``geotech_band_reclassification``;
``resolve_litho_instances``; ``body_fact_translation``; ...), then persist — so
their IP already ships as a ``.pyd`` and the wrapper stays SOURCE. What is
compiled is the code that carries the math itself: the geotech subdivision /
edge-derivation engine, the tie/pair reanchor matching, the in-module geotech
band-edit planning (``plan_edge_transfer``), the voxel build, and the
section/wedge/companion/stratigraphy/export geometry that has no compiled-domain
home. ``geotech_borehole_materialiser`` was CONSIDERED and left source: ~two
thirds of it is find-or-create upsert orchestration, so by "what dominates the
body" it is a GLUE base that happens to carry light geo-attribution geometry.

Because ``application/`` is impure (async ORM + session access) and thinly
unit-tested, the ``_ENGINE_APPLICATION`` set is proven by the INTEGRATION suite
run against the staged ``.pyd`` — not the unit gate alone — and Nuitka carve-outs
are expected and recorded in :data:`SOURCE_CARVEOUTS` like any other.

Deliberate SOURCE carve-outs, each recorded with its reason in
:data:`SOURCE_CARVEOUTS`:

* ``voxel_litho/greedy_mesh.py`` — its greedy-mesh kernel is a Numba
  ``@njit(cache=True)`` function. Numba needs the function's ``__code__`` object
  and an on-disk ``.py`` next to which it writes its compiled cache; a ``.pyd``
  has neither. The tripwire ``tests/unit/domain/services/voxel_litho/
  test_greedy_mesh.py`` (``test_kernel_compiles_in_numba_nopython_mode``,
  lines 58-77) fails if the kernel ever drops to object-mode, which is exactly
  what compiling it away would cause.
* eight top-level ``domain/services`` modules that ship as SOURCE because they
  carry no algorithmic IP (data-shape / token declarations, consistent with
  shipping ``domain/value_objects`` as source) or fall outside the owner's named
  engine scope — ``investigation_kind_constants``, ``litho_body_pick``,
  ``detect_body_extents``, ``elevation_rollback``, ``water_table_rollback``, and
  the three borehole-track-editor modules ``borehole_track_constants``,
  ``validate_track_intervals``, ``track_preference`` (2026-09-29).
  See the per-module reasons in :data:`SOURCE_CARVEOUTS`.
* every ``__init__.py`` — package markers ship as source. Compiling a package's
  ``__init__`` to a ``.pyd`` breaks the package's importability as a namespace
  and buys nothing (they hold no logic worth hiding).

C3 (geotech band-reclassification) has LANDED: ``geotech_band_reclassification``
is now compiled with the rest of the geotech family, no longer a deferred
source module.

Notes
-----
The dotted names below were enumerated directly from the ``src/groundmodel``
tree (voxel_litho ``*.py`` minus greedy_mesh; every top-level ``domain/services``
``*.py`` minus the eight source carve-outs; every non-``__init__`` module under
``infrastructure/parsers``). The ghost directories
``infrastructure/parsers/cpt/ags`` and ``infrastructure/parsers/cpt/las`` carry
no ``.py`` sources yet, so they simply do not appear here — a dotted name only
exists for a real module file.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# The engine — 3-D voxel litho builder (voxel_litho/*.py, minus greedy_mesh +
# __init__). These are the modules the on-click Build and fence render walk.
# ---------------------------------------------------------------------------
_VOXEL_LITHO = [
    "groundmodel.domain.services.voxel_litho.build_domain_from_sections",
    "groundmodel.domain.services.voxel_litho.extract_body_solids",
    "groundmodel.domain.services.voxel_litho.footprint_tolerance",
    "groundmodel.domain.services.voxel_litho.geo_bands",
    "groundmodel.domain.services.voxel_litho.honor_precedence",
    "groundmodel.domain.services.voxel_litho.label_voxels",
    "groundmodel.domain.services.voxel_litho.merge_bodies_across_sections",
    "groundmodel.domain.services.voxel_litho.packing_class_key",
    "groundmodel.domain.services.voxel_litho.paired_stations",
    "groundmodel.domain.services.voxel_litho.pinch_terminations",
    "groundmodel.domain.services.voxel_litho.pinch_terminations_constants",
    "groundmodel.domain.services.voxel_litho.section_reconciliation",
    "groundmodel.domain.services.voxel_litho.section_reconciliation_constants",
    "groundmodel.domain.services.voxel_litho.smooth_body_solids",
    "groundmodel.domain.services.voxel_litho.smooth_body_solids_constants",
    "groundmodel.domain.services.voxel_litho.snap_grid",
    "groundmodel.domain.services.voxel_litho.snap_grid_constants",
    "groundmodel.domain.services.voxel_litho.true_column_positions",
    "groundmodel.domain.services.voxel_litho.voxel_constants",
    "groundmodel.domain.services.voxel_litho.voxel_grid_budget",
    "groundmodel.domain.services.voxel_litho.voxel_types",
]

# ---------------------------------------------------------------------------
# The engine — top-level domain/services (everything under domain/services
# EXCEPT the voxel_litho subpackage above, its own greedy_mesh carve-out, and
# the eight source carve-outs in SOURCE_CARVEOUTS). Grouped by role; alphabetical
# within each group. Every module here was verified pure: it imports only
# stdlib, numpy/scipy, and other domain/services / domain/value_objects /
# shared/* — nothing from infrastructure/api/application, SQLAlchemy or Pydantic.
# ---------------------------------------------------------------------------
_ENGINE_DOMAIN_SERVICES = [
    # NAD packing classifier + lookup constants + representative-statistic
    # aggregator (the original named slice). nad_soil_parameters_constants holds
    # the norm-derived characteristic values (γ/φ′/c′ per class) the D-Series
    # exports carry — the same class of IP as the qc thresholds, so it compiles.
    "groundmodel.domain.services.nad_classification_constants",
    "groundmodel.domain.services.nad_classifier",
    # Admixture → NAD-family detection + variant resolver (owner ruling
    # 2026-09-04): decides which units the geotech prompt asks about and how the
    # answer selects the clean/secondary column — same engine IP as the classifier.
    "groundmodel.domain.services.nad_admixture_choice",
    "groundmodel.domain.services.nad_soil_parameters_constants",
    # Raw lab readings (2026-09-29): the lab-test -> borehole / sample match and
    # the oedometer vertical strain delta_h / h0 — pure, pinned by unit tests.
    "groundmodel.domain.services.lab_sample_matching",
    "groundmodel.domain.services.oedometer_vertical_strain",
    "groundmodel.domain.services.oedometer_vertical_strain_constants",
    "groundmodel.domain.services.representative_statistic",
    # Voxel-builder domain deps the compiled voxel_litho package is built on.
    "groundmodel.domain.services.model_domain",
    "groundmodel.domain.services.surface_bound",
    # CPT segmenter + Robertson SBT classifier chain (the litho suggestion engine).
    "groundmodel.domain.services.cpt_corrections",
    # The CPT display-name rule ("<project>-S<number>", owner ruling
    # 2026-10-04): pure stdlib, shared by the GEF and PDF importers.
    "groundmodel.domain.services.cpt_display_name",
    "groundmodel.domain.services.cpt_display_name_constants",
    "groundmodel.domain.services.cpt_interpretation",
    "groundmodel.domain.services.cpt_sbt_profile",
    "groundmodel.domain.services.gwt_resolution",
    "groundmodel.domain.services.litho_segmentation",
    "groundmodel.domain.services.litho_segmentation_constants",
    "groundmodel.domain.services.robertson_2015",
    "groundmodel.domain.services.robertson_2015_constants",
    "groundmodel.domain.services.robertson_sbt_non_normalised",
    # Geotech subdivision family (litho unit -> NAD packing bands, ties, bodies).
    # geotech_band_reclassification lands here now C3 is settled.
    "groundmodel.domain.services.geotech_band_reclassification",
    "groundmodel.domain.services.geotech_body_aggregation",
    "groundmodel.domain.services.geotech_crossing_repair",
    "groundmodel.domain.services.geotech_edge_bridging",
    "groundmodel.domain.services.geotech_edge_crossing_guard",
    "groundmodel.domain.services.geotech_edge_dedup",
    "groundmodel.domain.services.geotech_jump_tie_supersession",
    "groundmodel.domain.services.geotech_litho_parent_links",
    "groundmodel.domain.services.geotech_packing_edges",
    "groundmodel.domain.services.geotech_span_splitting",
    "groundmodel.domain.services.geotech_subdivision",
    "groundmodel.domain.services.geotech_subdivision_constants",
    "groundmodel.domain.services.geotech_tie_donors",
    "groundmodel.domain.services.geotech_tie_tombstone",
    "groundmodel.domain.services.geotech_unit_boundaries",
    "groundmodel.domain.services.litho_frame_conformance",
    "groundmodel.domain.services.litho_geo_bounding",
    # Geometry + correlation domain: TIN/DEM surfaces, lens geometry, contact
    # correlation, body labelling, borehole donors/fill, digests, validators.
    "groundmodel.domain.services.assign_borehole_band_body",
    "groundmodel.domain.services.assign_sample_to_band",
    "groundmodel.domain.services.auto_correlate_contact_edges",
    "groundmodel.domain.services.auto_correlate_contact_edges_constants",
    "groundmodel.domain.services.auto_correlate_helpers",
    # Manual bed-level override geometry (owner ruling 2026-09-06): point-in-
    # polygon + the ground sampler that reads the drawn bed inside a polygon.
    "groundmodel.domain.services.bed_override",
    "groundmodel.domain.services.body_fact_translation",
    "groundmodel.domain.services.body_geo_label",
    "groundmodel.domain.services.borehole_flank_donors",
    "groundmodel.domain.services.borehole_packing_fill",
    # Crossing-line clip of a formation TIN against the ground surface (owner
    # ruling 2026-09-06): a formation ends where it crosses the ground.
    "groundmodel.domain.services.clip_tin_by_ground_surface",
    "groundmodel.domain.services.dem_clip",
    "groundmodel.domain.services.dem_clip_constants",
    "groundmodel.domain.services.detect_crossing_pinch_outs",
    "groundmodel.domain.services.formation_age_order",
    "groundmodel.domain.services.formation_age_order_constants",
    "groundmodel.domain.services.formation_surface_contacts",
    "groundmodel.domain.services.geology_validator",
    "groundmodel.domain.services.lens_inference",
    "groundmodel.domain.services.lens_inference_constants",
    "groundmodel.domain.services.lens_pinch_out_geometry",
    "groundmodel.domain.services.lens_pinch_out_geometry_constants",
    "groundmodel.domain.services.litho_body_guard",
    "groundmodel.domain.services.litho_column_digest",
    "groundmodel.domain.services.litho_column_digest_constants",
    "groundmodel.domain.services.plan_enclosed_lens_merges",
    "groundmodel.domain.services.resolve_litho_instances",
    "groundmodel.domain.services.tin_surface",
    "groundmodel.domain.services.tin_surface_constants",
]

# ---------------------------------------------------------------------------
# The parsers — every non-__init__ module under infrastructure/parsers.
# GEF + DOV (CPT / borehole / lab / virtuele boring) parsing, WFS clients,
# XML helpers, validation. This is the ingestion IP the owner named explicitly.
# ---------------------------------------------------------------------------
_PARSERS = [
    "groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result",
    "groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row",
    "groundmodel.infrastructure.parsers.borehole.dov.cached_dov_track_source",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_identificatie_index",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_constants",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_entry",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parse_result",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parser",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_client",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_constants",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_file_interpretation",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_file_sample",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_client",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client",
    "groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result",
    "groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row",
    "groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_depth_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_reader",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile_constants",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_overlay_renderer",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_class",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_page_verdict",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_cli",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_header",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_report_store",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_repeat_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_report_digest",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_header",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_join_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_reader",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_text_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.borehole_triage_result",
    "groundmodel.infrastructure.parsers.borehole.pdf.cached_borehole_pdf_report",
    "groundmodel.infrastructure.parsers.borehole.pdf.depth_axis",
    "groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole",
    "groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole_adapter",
    "groundmodel.infrastructure.parsers.borehole.pdf.digitised_interval",
    "groundmodel.infrastructure.parsers.borehole.pdf.digitised_sample",
    "groundmodel.infrastructure.parsers.borehole.pdf.digitised_water_level",
    "groundmodel.infrastructure.parsers.borehole.pdf.dropped_borehole",
    "groundmodel.infrastructure.parsers.borehole.pdf.level_column_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.level_label",
    "groundmodel.infrastructure.parsers.borehole.pdf.page_word_helpers",
    "groundmodel.infrastructure.parsers.borehole.pdf.pdf_borehole_import_entry",
    "groundmodel.infrastructure.parsers.borehole.pdf.report_borehole",
    "groundmodel.infrastructure.parsers.borehole.pdf.sample_mark",
    "groundmodel.infrastructure.parsers.borehole.pdf.sheet_row",
    "groundmodel.infrastructure.parsers.cpt.dov.dov_client",
    "groundmodel.infrastructure.parsers.cpt.dov.dov_constants",
    "groundmodel.infrastructure.parsers.cpt.dov.dov_parse_worker",
    "groundmodel.infrastructure.parsers.cpt.dov.dov_parser",
    "groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache",
    "groundmodel.infrastructure.parsers.cpt.gef.cpt_type",
    "groundmodel.infrastructure.parsers.cpt.gef.gef_constants",
    "groundmodel.infrastructure.parsers.cpt.gef.gef_crs_codes",
    "groundmodel.infrastructure.parsers.cpt.gef.gef_header",
    "groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result",
    "groundmodel.infrastructure.parsers.cpt.gef.gef_parser",
    # PDF CPT digitiser (prototype, feat/pdf-cpt-digitiser): compiled like every
    # parser. Its runtime deps (pymupdf, opencv, rapidocr) are dev-group only; no
    # shipped route imports it yet.
    "groundmodel.infrastructure.parsers.cpt.pdf.axis_scale",
    "groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report",
    "groundmodel.infrastructure.parsers.cpt.pdf.colour_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.coordinate_extent_constants",
    "groundmodel.infrastructure.parsers.cpt.pdf.coordinate_extent_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin",
    "groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser",
    "groundmodel.infrastructure.parsers.cpt.pdf.depth_conversion",
    "groundmodel.infrastructure.parsers.cpt.pdf.depth_reference",
    "groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve",
    "groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding",
    "groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding_adapter",
    "groundmodel.infrastructure.parsers.cpt.pdf.dropped_sheet",
    "groundmodel.infrastructure.parsers.cpt.pdf.frame_rect",
    "groundmodel.infrastructure.parsers.cpt.pdf.graph_kind",
    "groundmodel.infrastructure.parsers.cpt.pdf.grid_line_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.layout_profile",
    "groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_constants",
    "groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry",
    "groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader",
    "groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache",
    "groundmodel.infrastructure.parsers.cpt.pdf.optional_engines",
    "groundmodel.infrastructure.parsers.cpt.pdf.overlay_renderer",
    "groundmodel.infrastructure.parsers.cpt.pdf.page_calibration",
    "groundmodel.infrastructure.parsers.cpt.pdf.page_class",
    "groundmodel.infrastructure.parsers.cpt.pdf.page_evidence",
    "groundmodel.infrastructure.parsers.cpt.pdf.page_triage",
    "groundmodel.infrastructure.parsers.cpt.pdf.page_word",
    "groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration",
    "groundmodel.infrastructure.parsers.cpt.pdf.panel_kind",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_page_renderer",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store",
    "groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_sheet_header",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_digitiser",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_page",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_page_reader",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_profile",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_report",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_report_reader",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_row",
    "groundmodel.infrastructure.parsers.cpt.pdf.printed_table_sounding",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_axis_calibrator",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_curve_extractor",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_deskewer",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_frame_calibrator",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_frame_detector",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_grid",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_grid_detector",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.raster_panel",
    "groundmodel.infrastructure.parsers.cpt.pdf.report_fingerprint",
    "groundmodel.infrastructure.parsers.cpt.pdf.report_sounding",
    "groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note",
    "groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note_constants",
    "groundmodel.infrastructure.parsers.cpt.pdf.report_triage",
    "groundmodel.infrastructure.parsers.cpt.pdf.series_resampling",
    "groundmodel.infrastructure.parsers.cpt.pdf.series_score",
    "groundmodel.infrastructure.parsers.cpt.pdf.series_scorer",
    "groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.sheet_join_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.sounding_block_reader",
    "groundmodel.infrastructure.parsers.cpt.pdf.stored_series_helpers",
    "groundmodel.infrastructure.parsers.cpt.pdf.table_column_role",
    "groundmodel.infrastructure.parsers.cpt.pdf.tick_orientation",
    "groundmodel.infrastructure.parsers.cpt.pdf.tick_run",
    "groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder",
    "groundmodel.infrastructure.parsers.cpt.pdf.triaged_pdf_report",
    "groundmodel.infrastructure.parsers.cpt.pdf.vector_axis_calibrator",
    "groundmodel.infrastructure.parsers.cpt.pdf.vector_curve_extractor",
    "groundmodel.infrastructure.parsers.cpt.pdf.vector_page_content",
    "groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader",
    "groundmodel.infrastructure.parsers.cpt.pdf.word_geometry",
    "groundmodel.infrastructure.parsers.cpt.validation.validation_issue",
    "groundmodel.infrastructure.parsers.cpt.validation.validation_level",
    "groundmodel.infrastructure.parsers.crs_bounds",
    "groundmodel.infrastructure.parsers.crs_bounds_constants",
    "groundmodel.infrastructure.parsers.crs_bounds_issue",
    "groundmodel.infrastructure.parsers.dov.dov_common",
    "groundmodel.infrastructure.parsers.dov.dov_fixture_transport",
    "groundmodel.infrastructure.parsers.dov.dov_gml_location",
    "groundmodel.infrastructure.parsers.dov.dov_http",
    "groundmodel.infrastructure.parsers.dov.dov_http_retry",
    "groundmodel.infrastructure.parsers.dov.dov_wfs_bbox",
    "groundmodel.infrastructure.parsers.dov.dov_wfs_client_base",
    "groundmodel.infrastructure.parsers.dov.dov_wfs_download",
    "groundmodel.infrastructure.parsers.dov.dov_wfs_helpers",
    "groundmodel.infrastructure.parsers.dov.dov_wfs_request",
    "groundmodel.infrastructure.parsers.dov.dov_xml_helpers",
    "groundmodel.infrastructure.parsers.dov.virtuele_boring_client",
    "groundmodel.infrastructure.parsers.dov.virtuele_boring_constants",
    "groundmodel.infrastructure.parsers.dov.virtuele_boring_result",
    "groundmodel.infrastructure.parsers.lab.dov.dov_constants",
    "groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_client",
    "groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser",
    "groundmodel.infrastructure.parsers.lab.dov.dov_scalar_observation_client",
    "groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result",
    "groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row",
    "groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row",
    # Raw lab exports (oedometer control listing, the newer oedometer module's
    # raw dump, triaxial raw dump).
    "groundmodel.infrastructure.parsers.lab.raw_export.lab_export_constants",
    "groundmodel.infrastructure.parsers.lab.raw_export.lab_export_reader",
    "groundmodel.infrastructure.parsers.lab.raw_export.lab_export_text",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_checks",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_constants",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_control_listing_parser",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_lab_summary_row",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_header",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_result",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_new_constants",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_new_export_parser",
    "groundmodel.infrastructure.parsers.lab.raw_export.oedometer_stage",
    "groundmodel.infrastructure.parsers.lab.raw_export.triaxial_constants",
    "groundmodel.infrastructure.parsers.lab.raw_export.triaxial_dump_result",
    "groundmodel.infrastructure.parsers.lab.raw_export.triaxial_raw_dump_parser",
    "groundmodel.infrastructure.parsers.lab.raw_export.triaxial_specimen",
    # Shared validation package (moved out of cpt/ 2026-09-05; boreholes + lab
    # use it too). The old cpt.validation.* entries stay listed too so the
    # back-compat shims compile alongside these canonical modules.
    "groundmodel.infrastructure.parsers.validation.validation_issue",
    "groundmodel.infrastructure.parsers.validation.validation_level",
]

# ---------------------------------------------------------------------------
# The engine in application/ (owner ruling "Q1", 2026-09-01). ALGORITHM modules
# only — every application module whose algorithm is computed IN-MODULE rather
# than delegated to a compiled domain/services service. NOT wholesale: the
# band-reclassification hand-edit verbs (delegate to the compiled
# geotech_band_reclassification), the body resolution / recompute use cases
# (delegate to the compiled resolve_litho_instances / body_fact_translation), the
# auto-correlate / sweep / recompute-absence / import / snapshot / CRUD families,
# and the queue/job/lock/scope/DTO infrastructure all stay SOURCE. There is no
# application-wide classification test — this is a hand-picked set, pinned exactly
# by tests/unit/scripts/test_native_compile_manifest.py. Grouped by role;
# alphabetical within each group.
# ---------------------------------------------------------------------------
_ENGINE_APPLICATION = [
    # Geotech subdivision / borehole division + packing-edge derivation — the
    # owner-named core. Band merge/coarsen/clip/donor + tie-pair math split
    # between divide_boreholes (the DB orchestration + the DivideBoreholes class)
    # and band_planning (the PURE band-math it re-exports, KonMari DB-S1);
    # mm-clamped sub-interval computation (subdivide_all_bodies), packing-stack
    # alignment + bandless-column bridging (geotech_edge_derivation) — all inline.
    # band_planning_constants stays SOURCE like its sibling geotech_band_edit_
    # constants: data-token declarations with no algorithmic IP.
    "groundmodel.application.band_planning",
    "groundmodel.application.divide_boreholes",
    "groundmodel.application.geotech_edge_derivation",
    "groundmodel.application.subdivide_all_bodies",
    # Geotech in-module planning + reanchor matching. band_edit_helpers holds
    # plan_edge_transfer / edge_review_actions in-module (the reclassification
    # plan_* itself is the compiled domain service); geotech_tie_reanchor and
    # pair_ruling_reanchor are the tie/pair identity + overlap band-matching math.
    "groundmodel.application.geotech_band_edit_helpers",
    "groundmodel.application.geotech_tie_reanchor",
    "groundmodel.application.pair_ruling_reanchor",
    # Voxel litho build — stack blend, body-alias, honored columns, footprint,
    # checksums (all inline).
    "groundmodel.application.build_voxel_litho_model",
    # Litho / section / body / stratigraphy / export geometry computed IN-MODULE
    # with no compiled-domain home: section-polygon gap-fraction->ring coordinate
    # mapping, per-absence pinch-tip wedge geometry, lens-centroid/perpendicular
    # companion geometry, stratigraphy key-precedence + interval-overlap bridging,
    # and same-identifier export-unit adjacency merging.
    "groundmodel.application.build_section_polygons",
    "groundmodel.application.create_perpendicular_companion",
    "groundmodel.application.materialize_wedge_tips_for_formation",
    "groundmodel.application.stratigraphy_bridge",
    "groundmodel.application.thin_export_units",
]

#: Dotted module names compiled to native ``.pyd`` in the packaged tree.
#: Order is engine-first (voxel_litho, then the rest of domain/services), then
#: parsers, then the application-layer engine; each block is grouped/alphabetical
#: within itself.
COMPILED_MODULES: list[str] = [
    *_VOXEL_LITHO,
    *_ENGINE_DOMAIN_SERVICES,
    *_PARSERS,
    *_ENGINE_APPLICATION,
]

#: Modules that live inside an otherwise-compiled area but ship as SOURCE, with
#: the reason. Keys are either a dotted module name or the sentinel ``"__init__"``
#: describing the package-marker rule. Consumed by the gates for their assertions
#: and by docs/distribution-build.md for the carve-out table.
SOURCE_CARVEOUTS: dict[str, str] = {
    "groundmodel.domain.services.geotech_column_sampler": (
        "Nuitka SEMANTIC DEVIATION — compiled, its even-odd/geometry "
        "sample_regions_at_fraction drops enclosed lens bands, so cs2/cs3 in "
        "tests/unit/domain/services/test_geotech_column_sampler.py fail against "
        "the .pyd (returns ['NAD6'] not ['NAD6','SILT','NAD6']). Verified "
        "2026-09-01 by a targeted compile. Ships SOURCE; the behavioural gate is "
        "exactly what caught this. Do NOT re-add without re-proving the suite "
        "passes against the .pyd."
    ),
    "groundmodel.domain.services.voxel_litho.greedy_mesh": (
        "Numba @njit(cache=True) kernel — needs __code__ + an on-disk .py to "
        "cache beside; compiling it away drops the hotspot to object-mode. "
        "Pinned by tests/unit/domain/services/voxel_litho/test_greedy_mesh.py:58-77."
    ),
    # Eight top-level domain/services modules that ship as SOURCE. The first three
    # are data-shape / token declarations (no algorithm to protect — the same
    # rationale that ships every domain/value_objects module as source); the two
    # rollback services carry logic but fall outside the owner's named engine
    # scope (rulings 5-6: partition/fill, voxel builder, NAD classifier, parsers).
    # The last three are the borehole track editor's rules (2026-09-29), CRUD
    # validation next to the elevation rollback, not modelling IP.
    # All eight are PURE (stdlib + domain value_objects only) and could be promoted
    # to COMPILED_MODULES on an owner call — left source, flagged, not invented.
    "groundmodel.domain.services.investigation_kind_constants": (
        "Two domain tokens (KIND_CPT/KIND_BOREHOLE), no algorithmic IP. Imported "
        "by the SOURCE repository layer (LithoLayerRepository.load_body_picks) to "
        "stamp BodyLayerPick.kind; a data-token declaration, shipped source like "
        "domain/value_objects."
    ),
    "groundmodel.domain.services.litho_body_pick": (
        "The frozen BodyLayerPick dataclass — a value object that happens to live "
        "under services/. Data shape, not algorithm; shipped source like "
        "domain/value_objects."
    ),
    "groundmodel.domain.services.detect_body_extents": (
        "Now only the frozen ContactStack/ContactEdge snapshot types (the "
        "detect_body_extents FUNCTION was retired in the body-extent refactor, "
        "2026-06-06). Data-shape declarations reused by the compiled "
        "detect_crossing_pinch_outs / auto_correlate_contact_edges; no algorithm "
        "to protect."
    ),
    "groundmodel.domain.services.elevation_rollback": (
        "Pure, but outside the named engine scope (rulings 5-6): import-provenance "
        "rollback of surveyed collar elevation (debt #8), not modelling IP. Owner's "
        "call to promote."
    ),
    "groundmodel.domain.services.water_table_rollback": (
        "Pure, but outside the named engine scope (rulings 5-6): import-provenance "
        "rollback of the water table, not modelling IP. Owner's call to promote."
    ),
    "groundmodel.domain.services.borehole_track_constants": (
        "Track-editor kind sets + size caps (owner 2026-09-29); token declarations, "
        "no algorithm. Shipped source like domain/value_objects."
    ),
    "groundmodel.domain.services.validate_track_intervals": (
        "Pure, but outside the named engine scope (rulings 5-6): the hand-edited "
        "borehole track's interval rules (top < base, no overlap, 1 mm grain) - "
        "CRUD validation like elevation_rollback, not modelling IP. Owner's call to "
        "promote."
    ),
    "groundmodel.domain.services.track_preference": (
        "Pure, but outside the named engine scope (rulings 5-6): which track of a "
        "kind the consumers use (manual > newest edited > date order). A ranking "
        "rule, not modelling IP. Owner's call to promote."
    ),
    "__init__": (
        "Package __init__ markers ship as source — compiling them breaks package "
        "importability and hides no logic."
    ),
}


def compiled_module_count() -> int:
    """Return the number of modules compiled to native ``.pyd``.

    Returns
    -------
    int
        Length of :data:`COMPILED_MODULES`.
    """
    return len(COMPILED_MODULES)


if __name__ == "__main__":
    # Convenience: `python scripts/native_compile_manifest.py` prints the list
    # one per line (the PowerShell driver reads it this way).
    for _name in COMPILED_MODULES:
        print(_name)
