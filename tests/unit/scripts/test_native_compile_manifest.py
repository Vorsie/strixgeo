"""The native-compile manifest must never drift from the source tree.

``scripts/native_compile_manifest.py`` lists exactly which backend modules ship
as compiled ``.pyd`` in the packaged app (owner ruling 2026-08-31: the engine +
parsers must not leak as readable source). The danger this test guards against
is a NEW engine or parser module being added to the tree and silently shipping
as readable ``.py`` because nobody remembered to list it.

Three areas are compiled *wholesale* and each ``.py`` in them must be accounted
for by exactly one of ``COMPILED_MODULES``, a concrete ``SOURCE_CARVEOUTS`` key,
or the ``__init__`` package-marker rule:

* ``voxel_litho`` (its own subtree) — every module minus the ``greedy_mesh``
  numba carve-out;
* ``infrastructure/parsers`` — every non-``__init__`` module;
* ``domain/services`` **top level** (excluding the ``voxel_litho`` subtree, which
  has its own check) — every engine-class module is compiled, minus five
  recorded source carve-outs (data-shape/token declarations + two rollback
  services outside the owner's engine scope).

The domain/services top-level classification is what gives "a new domain-services
engine module must be manually classified" its teeth: adding a ``.py`` directly
under ``domain/services`` breaks :func:`test_domain_services_subtree_is_fully_classified`
until it is listed in ``COMPILED_MODULES`` or given a ``SOURCE_CARVEOUTS`` reason.

C3 (``geotech_band_reclassification``) has LANDED — it is now compiled with the
rest of the geotech family, no longer a deferred source module.

A FOURTH area is compiled but NOT wholesale: the engine-class modules in
``application/`` (owner ruling "Q1", 2026-09-01 — ``divide_boreholes``,
``subdivide_all_bodies``, ``geotech_edge_derivation``, ``build_voxel_litho_model``
and the other application modules whose algorithm is computed in-module rather
than delegated to a compiled ``domain/services`` service). ``application/`` is a
mixed layer — most of it is use-case orchestration, CRUD, DTOs and infrastructure
that stays source — so there is no "every application module must be classified"
test. Instead the compiled subset is HAND-PICKED and pinned here as
:data:`_ENGINE_APPLICATION_EXPECTED`: it must equal the ``application`` entries in
``COMPILED_MODULES`` exactly (so adding or removing one forces an edit to this
test), and a sample of known orchestration modules is asserted to stay source.
The wholesale-subtree union test excludes the ``application`` prefix for the same
reason.
"""

from __future__ import annotations

from pathlib import Path

from scripts.native_compile_manifest import COMPILED_MODULES, SOURCE_CARVEOUTS

# tests/unit/scripts/test_native_compile_manifest.py -> repo root is parents[3].
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SRC = _REPO_ROOT / "src"

_VOXEL_LITHO = "groundmodel/domain/services/voxel_litho"
_PARSERS = "groundmodel/infrastructure/parsers"
_DOMAIN_SERVICES = "groundmodel/domain/services"

# The five top-level domain/services modules that ship as SOURCE (each recorded
# in SOURCE_CARVEOUTS with a reason). Named here so promoting any to
# COMPILED_MODULES -- or adding a sixth source module -- forces an edit to this
# test in the same commit; it cannot silently drift either way.
_SOURCE_DOMAIN_SERVICES = {
    "groundmodel.domain.services.investigation_kind_constants",
    "groundmodel.domain.services.litho_body_pick",
    "groundmodel.domain.services.detect_body_extents",
    "groundmodel.domain.services.elevation_rollback",
    "groundmodel.domain.services.water_table_rollback",
}

# The dotted prefix of the hand-picked application engine set. application/ is a
# mixed layer (mostly orchestration/CRUD/DTO/infrastructure that stays source),
# so it is NOT classified wholesale; the wholesale union test scopes it out.
_APPLICATION_PREFIX = "groundmodel.application."

# The EXACT application-layer modules compiled to .pyd (owner ruling "Q1",
# 2026-09-01). Pinned here so adding or removing one forces an edit to this test
# in the same commit -- same discipline as _SOURCE_DOMAIN_SERVICES. This must
# equal the application entries in COMPILED_MODULES (asserted below). Every entry
# carries its algorithm IN-MODULE; the band-reclassification hand-edit verbs, the
# body resolution/recompute use cases and the sweep/import/CRUD families are
# deliberately absent because they delegate their algorithm to a compiled
# domain/services module and stay source.
_ENGINE_APPLICATION_EXPECTED = {
    "groundmodel.application.band_planning",
    "groundmodel.application.divide_boreholes",
    "groundmodel.application.subdivide_all_bodies",
    "groundmodel.application.geotech_edge_derivation",
    "groundmodel.application.geotech_band_edit_helpers",
    "groundmodel.application.geotech_tie_reanchor",
    "groundmodel.application.pair_ruling_reanchor",
    "groundmodel.application.build_voxel_litho_model",
    "groundmodel.application.build_section_polygons",
    "groundmodel.application.create_perpendicular_companion",
    "groundmodel.application.materialize_wedge_tips_for_formation",
    "groundmodel.application.stratigraphy_bridge",
    "groundmodel.application.thin_export_units",
}

# A sample of application modules that must NEVER compile -- the delegation-
# boundary GLUE the "algorithm modules only" ruling keeps as source. Names the
# tempting cases: the band-edit verbs (delegate to the compiled domain
# geotech_band_reclassification.plan_*), the body resolution/recompute use cases
# (delegate to the compiled resolve_litho_instances / body_fact_translation), and
# representative CRUD / import / DTO / queue infrastructure. If any of these ever
# lands in COMPILED_MODULES it is either a mistake or an owner decision that must
# update this list explicitly.
_SOURCE_APPLICATION_SAMPLE = {
    "groundmodel.application.merge_geotech_bands",
    "groundmodel.application.split_geotech_band",
    "groundmodel.application.move_geotech_band_boundary",
    "groundmodel.application.preview_geotech_band_edit",
    "groundmodel.application.set_geotech_band_class",
    "groundmodel.application.resolve_litho_instances_use_case",
    "groundmodel.application.recompute_bodies",
    "groundmodel.application.geotech_borehole_materialiser",
    "groundmodel.application.auto_correlate_geotech_edges",
    "groundmodel.application.correlate_litho_contacts",
    "groundmodel.application.import_cpt",
    "groundmodel.application.delete_body",
    "groundmodel.application.section_snapshot",
    "groundmodel.application.task_queue",
    "groundmodel.application.scope_guard",
}


def _dotted(path: Path) -> str:
    """Return the dotted module name for a ``.py`` path under ``src/``."""
    return ".".join(path.relative_to(_SRC).with_suffix("").parts)


def _py_modules(rel_dir: str) -> set[str]:
    """Every ``.py`` under ``src/<rel_dir>`` (recursive) as dotted names."""
    return {_dotted(p) for p in (_SRC / Path(rel_dir)).rglob("*.py")}


def _top_level_py_modules(rel_dir: str) -> set[str]:
    """Every ``.py`` DIRECTLY in ``src/<rel_dir>`` (non-recursive), ``__init__`` included.

    Non-recursive so ``domain/services`` does not swallow the ``voxel_litho``
    subpackage, which is classified by its own test.
    """
    return {_dotted(p) for p in (_SRC / Path(rel_dir)).glob("*.py")}


def _init_modules(rel_dir: str) -> set[str]:
    """Every ``__init__.py`` under ``src/<rel_dir>`` (recursive) as dotted names."""
    return {_dotted(p) for p in (_SRC / Path(rel_dir)).rglob("__init__.py")}


def test_no_duplicate_compiled_modules() -> None:
    """``COMPILED_MODULES`` carries no repeated entry."""
    assert len(COMPILED_MODULES) == len(set(COMPILED_MODULES)), (
        "COMPILED_MODULES has a duplicate entry"
    )


def test_every_compiled_module_exists_on_disk() -> None:
    """No dangling manifest entry: each compiled module is a real ``.py`` in ``src/``."""
    missing = [m for m in COMPILED_MODULES if not (_SRC / (m.replace(".", "/") + ".py")).exists()]
    assert not missing, f"COMPILED_MODULES entries with no source file: {missing}"


def test_voxel_litho_subtree_is_fully_classified() -> None:
    """Every voxel_litho ``.py`` is compiled, the greedy_mesh carve-out, or an ``__init__``."""
    compiled = set(COMPILED_MODULES)
    greedy = "groundmodel.domain.services.voxel_litho.greedy_mesh"
    for module in _py_modules(_VOXEL_LITHO):
        classified = module in compiled or module == greedy or module.endswith(".__init__")
        assert classified, f"unclassified voxel_litho module ships as SOURCE: {module}"


def test_every_parser_module_is_compiled() -> None:
    """Every non-``__init__`` module under infrastructure/parsers is in ``COMPILED_MODULES``."""
    compiled = set(COMPILED_MODULES)
    for module in _py_modules(_PARSERS):
        if module.endswith(".__init__"):
            continue
        assert module in compiled, f"parser module ships as SOURCE, not compiled: {module}"


def test_domain_services_subtree_is_fully_classified() -> None:
    """Every top-level domain/services module is compiled or an explicit source carve-out.

    This is the teeth behind "a new domain-services engine module must be
    manually classified": a ``.py`` added directly under ``domain/services``
    breaks this test until it is either listed in ``COMPILED_MODULES`` or given a
    reason in ``SOURCE_CARVEOUTS``. The ``voxel_litho`` subtree is excluded (its
    own test above); ``__init__`` markers ship as source by the package-marker rule.
    """
    compiled = set(COMPILED_MODULES)
    for module in _top_level_py_modules(_DOMAIN_SERVICES):
        if module.endswith(".__init__"):
            continue
        classified = module in compiled or module in SOURCE_CARVEOUTS
        assert classified, (
            "unclassified domain/services module -- add it to COMPILED_MODULES or "
            f"give it a SOURCE_CARVEOUTS reason: {module}"
        )


def test_source_domain_services_are_carved_out_not_compiled() -> None:
    """The five source domain/services modules are recorded, present, and NOT compiled."""
    compiled = set(COMPILED_MODULES)
    for module in _SOURCE_DOMAIN_SERVICES:
        assert module in SOURCE_CARVEOUTS, f"{module} missing a SOURCE_CARVEOUTS reason"
        assert module not in compiled, f"{module} is both compiled and carved out"
        assert (_SRC / (module.replace(".", "/") + ".py")).exists(), (
            f"{module} no longer exists on disk -- update this test"
        )


def test_c3_geotech_band_reclassification_is_compiled() -> None:
    """C3 landed: geotech_band_reclassification ships compiled, not deferred to source."""
    module = "groundmodel.domain.services.geotech_band_reclassification"
    assert module in set(COMPILED_MODULES), (
        "geotech_band_reclassification must be in COMPILED_MODULES now C3 has landed"
    )
    assert module not in SOURCE_CARVEOUTS, (
        "geotech_band_reclassification must not be a source carve-out any more"
    )


def test_engine_anchors_are_compiled() -> None:
    """The named engine anchors (NAD classifier, geotech subdivision) stay compiled."""
    compiled = set(COMPILED_MODULES)
    anchors = {
        "groundmodel.domain.services.nad_classifier",
        "groundmodel.domain.services.representative_statistic",
        "groundmodel.domain.services.geotech_subdivision",
        "groundmodel.domain.services.litho_segmentation",
        "groundmodel.domain.services.tin_surface",
    }
    assert anchors <= compiled, (
        f"engine anchors missing from COMPILED_MODULES: {anchors - compiled}"
    )


def test_greedy_mesh_carveout_is_source_only() -> None:
    """The greedy_mesh carve-out is recorded and stays OUT of the compiled set."""
    greedy = "groundmodel.domain.services.voxel_litho.greedy_mesh"
    assert greedy in SOURCE_CARVEOUTS, "greedy_mesh missing from SOURCE_CARVEOUTS"
    assert "__init__" in SOURCE_CARVEOUTS, "the __init__ carve-out rule is undocumented"
    assert greedy not in set(COMPILED_MODULES), "greedy_mesh must not be compiled (numba @njit)"


def test_manifest_union_equals_the_real_module_set() -> None:
    """The classified union equals the real source set across the three WHOLESALE areas.

    real  = every .py in voxel_litho + parsers + domain/services (top level).
    covered = COMPILED_MODULES + the concrete source carve-outs + the __init__
              markers of the three wholesale subtrees.
    Any divergence -- a new unclassified module, a removed/typo'd manifest line,
    or a dangling entry -- breaks this equality.

    The application/ engine set is HAND-PICKED, not wholesale, so both its
    COMPILED_MODULES entries and any application-prefixed SOURCE_CARVEOUTS keys
    are scoped OUT here and checked by the application-specific tests below.
    """
    real = (
        _py_modules(_VOXEL_LITHO) | _py_modules(_PARSERS) | _top_level_py_modules(_DOMAIN_SERVICES)
    )
    concrete_carveouts = {
        name
        for name in SOURCE_CARVEOUTS
        if name != "__init__" and not name.startswith(_APPLICATION_PREFIX)
    }
    covered = (
        {m for m in COMPILED_MODULES if not m.startswith(_APPLICATION_PREFIX)}
        | concrete_carveouts
        | _init_modules(_DOMAIN_SERVICES)  # domain/services + voxel_litho __init__
        | _init_modules(_PARSERS)
    )
    assert covered == real, (
        f"manifest drift -- unclassified/new: {sorted(real - covered)}; "
        f"stale/dangling: {sorted(covered - real)}"
    )


def test_engine_application_set_matches_expected() -> None:
    """The application entries in COMPILED_MODULES equal the pinned expectation.

    application/ is hand-picked (owner ruling "Q1", 2026-09-01), so the compiled
    subset is pinned in :data:`_ENGINE_APPLICATION_EXPECTED`. Any drift -- a new
    engine module compiled, or one dropped to a Nuitka carve-out -- must be an
    explicit edit here, exactly like the _SOURCE_DOMAIN_SERVICES discipline.
    """
    compiled_application = {m for m in COMPILED_MODULES if m.startswith(_APPLICATION_PREFIX)}
    assert compiled_application == _ENGINE_APPLICATION_EXPECTED, (
        "compiled application engine set drifted from the pinned expectation -- "
        f"added: {sorted(compiled_application - _ENGINE_APPLICATION_EXPECTED)}; "
        f"removed: {sorted(_ENGINE_APPLICATION_EXPECTED - compiled_application)}"
    )


def test_engine_application_modules_exist_and_are_compiled() -> None:
    """Every pinned application engine module is a real source file and IS compiled."""
    compiled = set(COMPILED_MODULES)
    for module in _ENGINE_APPLICATION_EXPECTED:
        assert module in compiled, f"{module} missing from COMPILED_MODULES"
        assert module not in SOURCE_CARVEOUTS, f"{module} is both compiled and carved out"
        assert (_SRC / (module.replace(".", "/") + ".py")).exists(), (
            f"{module} no longer exists on disk -- update this test and the manifest"
        )


def test_application_orchestration_stays_source() -> None:
    """The delegation-boundary GLUE (band-edit verbs, resolvers, CRUD, DTOs) stays source.

    "algorithm modules only; use-case orchestration stays source" (owner ruling
    Q1). This pins the tempting near-misses -- the band-edit verbs and body
    resolution/recompute use cases that DELEGATE to a compiled domain/services
    service -- as never-compiled, so a future accidental promotion fails loudly.
    """
    compiled = set(COMPILED_MODULES)
    leaked = _SOURCE_APPLICATION_SAMPLE & compiled
    assert not leaked, (
        "orchestration/glue application modules must stay source, "
        f"but these compile: {sorted(leaked)}"
    )
    # The sample and the compiled set are disjoint by construction; guard the
    # sample itself against a typo that would make the assertion vacuous.
    for module in _SOURCE_APPLICATION_SAMPLE:
        assert (_SRC / (module.replace(".", "/") + ".py")).exists(), (
            f"{module} in _SOURCE_APPLICATION_SAMPLE no longer exists -- update this test"
        )
