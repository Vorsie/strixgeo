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

Scope (owner rulings 5-6, 2026-08-31): the **engine** (partition/fill voxel
builder, NAD classifier, representative statistic) PLUS the **parsers** (all GEF
+ DOV parsing modules). The API, repositories and application layer stay source.

Two deliberate exclusions inside otherwise-compiled directories, recorded in
:data:`SOURCE_CARVEOUTS`:

* ``voxel_litho/greedy_mesh.py`` — its greedy-mesh kernel is a Numba
  ``@njit(cache=True)`` function. Numba needs the function's ``__code__`` object
  and an on-disk ``.py`` next to which it writes its compiled cache; a ``.pyd``
  has neither. The tripwire ``tests/unit/domain/services/voxel_litho/
  test_greedy_mesh.py`` (``test_kernel_compiles_in_numba_nopython_mode``,
  lines 58-77) fails if the kernel ever drops to object-mode, which is exactly
  what compiling it away would cause.
* every ``__init__.py`` — package markers ship as source. Compiling a package's
  ``__init__`` to a ``.pyd`` breaks the package's importability as a namespace
  and buys nothing (they hold no logic worth hiding).

Deliberately NOT in the compiled set, pending an owner decision (C3, still
open 2026-08-31): ``domain/services/geotech_band_reclassification.py``. It is
engine code and would be a natural member of the compiled set, but the geotech
band-reclassification behaviour is still under active dogfeed rulings; it is
left as source until C3 settles so a rebuild is a one-line edit here rather than
a re-derivation of what "the engine" means. Add it to :data:`COMPILED_MODULES`
when C3 lands.

Notes
-----
The dotted names below were enumerated directly from the ``src/groundmodel``
tree (voxel_litho ``*.py`` minus the two carve-outs; the three named domain
services; every non-``__init__`` module under ``infrastructure/parsers``). The
ghost directories ``infrastructure/parsers/cpt/ags`` and
``infrastructure/parsers/cpt/las`` carry no ``.py`` sources yet, so they simply
do not appear here — a dotted name only exists for a real module file.
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
# The engine — named domain services (NAD packing classifier + its lookup
# constants + the representative-statistic aggregator). geotech_band_
# reclassification is intentionally NOT here (see the module docstring, C3).
# ---------------------------------------------------------------------------
_NAMED_SERVICES = [
    "groundmodel.domain.services.nad_classifier",
    "groundmodel.domain.services.nad_classification_constants",
    "groundmodel.domain.services.representative_statistic",
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
#: Order is engine-first, then parsers; each block is alphabetical within itself.
COMPILED_MODULES: list[str] = [*_VOXEL_LITHO, *_NAMED_SERVICES, *_PARSERS]

#: Modules that live inside an otherwise-compiled area but ship as SOURCE, with
#: the reason. Keys are either a dotted module name or the sentinel ``"__init__"``
#: describing the package-marker rule. Consumed by the gates for their assertions
#: and by docs/distribution-build.md for the carve-out table.
SOURCE_CARVEOUTS: dict[str, str] = {
    "groundmodel.domain.services.voxel_litho.greedy_mesh": (
        "Numba @njit(cache=True) kernel — needs __code__ + an on-disk .py to "
        "cache beside; compiling it away drops the hotspot to object-mode. "
        "Pinned by tests/unit/domain/services/voxel_litho/test_greedy_mesh.py:58-77."
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
