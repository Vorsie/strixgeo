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
family, and the TIN/DEM/lens/correlation geometry) is compiled. The API,
repositories and application layer stay source — a domain module that reaches
into ``infrastructure``/``api``/``application`` (or imports SQLAlchemy /
Pydantic) is by definition NOT pure domain and is carved out with its offending
import as evidence, exactly like ``greedy_mesh`` (numba) below.

Deliberate SOURCE carve-outs, each recorded with its reason in
:data:`SOURCE_CARVEOUTS`:

* ``voxel_litho/greedy_mesh.py`` — its greedy-mesh kernel is a Numba
  ``@njit(cache=True)`` function. Numba needs the function's ``__code__`` object
  and an on-disk ``.py`` next to which it writes its compiled cache; a ``.pyd``
  has neither. The tripwire ``tests/unit/domain/services/voxel_litho/
  test_greedy_mesh.py`` (``test_kernel_compiles_in_numba_nopython_mode``,
  lines 58-77) fails if the kernel ever drops to object-mode, which is exactly
  what compiling it away would cause.
* five top-level ``domain/services`` modules that ship as SOURCE because they
  carry no algorithmic IP (data-shape / token declarations, consistent with
  shipping ``domain/value_objects`` as source) or fall outside the owner's named
  engine scope — ``investigation_kind_constants``, ``litho_body_pick``,
  ``detect_body_extents``, ``elevation_rollback``, ``water_table_rollback``.
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
``*.py`` minus the five source carve-outs; every non-``__init__`` module under
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
    "groundmodel.domain.services.voxel_litho.section_reconciliation",
    "groundmodel.domain.services.voxel_litho.section_reconciliation_constants",
    "groundmodel.domain.services.voxel_litho.smooth_body_solids",
    "groundmodel.domain.services.voxel_litho.smooth_body_solids_constants",
    "groundmodel.domain.services.voxel_litho.snap_grid",
    "groundmodel.domain.services.voxel_litho.true_column_positions",
    "groundmodel.domain.services.voxel_litho.voxel_constants",
    "groundmodel.domain.services.voxel_litho.voxel_grid_budget",
    "groundmodel.domain.services.voxel_litho.voxel_types",
]

# ---------------------------------------------------------------------------
# The engine — top-level domain/services (everything under domain/services
# EXCEPT the voxel_litho subpackage above, its own greedy_mesh carve-out, and
# the five source carve-outs in SOURCE_CARVEOUTS). Grouped by role; alphabetical
# within each group. Every module here was verified pure: it imports only
# stdlib, numpy/scipy, and other domain/services / domain/value_objects /
# shared/* — nothing from infrastructure/api/application, SQLAlchemy or Pydantic.
# ---------------------------------------------------------------------------
_ENGINE_DOMAIN_SERVICES = [
    # NAD packing classifier + lookup constants + representative-statistic
    # aggregator (the original named slice).
    "groundmodel.domain.services.nad_classification_constants",
    "groundmodel.domain.services.nad_classifier",
    "groundmodel.domain.services.representative_statistic",
    # Voxel-builder domain deps the compiled voxel_litho package is built on.
    "groundmodel.domain.services.model_domain",
    "groundmodel.domain.services.surface_bound",
    # CPT segmenter + Robertson SBT classifier chain (the litho suggestion engine).
    "groundmodel.domain.services.cpt_corrections",
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
    "groundmodel.domain.services.body_fact_translation",
    "groundmodel.domain.services.body_geo_label",
    "groundmodel.domain.services.borehole_flank_donors",
    "groundmodel.domain.services.borehole_packing_fill",
    "groundmodel.domain.services.dem_clip",
    "groundmodel.domain.services.dem_clip_constants",
    "groundmodel.domain.services.detect_crossing_pinch_outs",
    "groundmodel.domain.services.formation_age_order",
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
    "groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_client",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_constants",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_client",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser",
    "groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client",
    "groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result",
    "groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row",
    "groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row",
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
    "groundmodel.infrastructure.parsers.cpt.validation.validation_issue",
    "groundmodel.infrastructure.parsers.cpt.validation.validation_level",
    "groundmodel.infrastructure.parsers.dov.dov_common",
    "groundmodel.infrastructure.parsers.dov.dov_fixture_transport",
    "groundmodel.infrastructure.parsers.dov.dov_gml_location",
    "groundmodel.infrastructure.parsers.dov.dov_http",
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
]

#: Dotted module names compiled to native ``.pyd`` in the packaged tree.
#: Order is engine-first (voxel_litho, then the rest of domain/services), then
#: parsers; each block is grouped/alphabetical within itself.
COMPILED_MODULES: list[str] = [*_VOXEL_LITHO, *_ENGINE_DOMAIN_SERVICES, *_PARSERS]

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
    # Five top-level domain/services modules that ship as SOURCE. The first three
    # are data-shape / token declarations (no algorithm to protect — the same
    # rationale that ships every domain/value_objects module as source); the two
    # rollback services carry logic but fall outside the owner's named engine
    # scope (rulings 5-6: partition/fill, voxel builder, NAD classifier, parsers).
    # All five are PURE (stdlib + domain value_objects only) and could be promoted
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
