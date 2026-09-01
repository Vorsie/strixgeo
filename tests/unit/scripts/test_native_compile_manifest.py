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
    """The classified union equals the real source set across all three areas.

    real  = every .py in voxel_litho + parsers + domain/services (top level).
    covered = COMPILED_MODULES + the concrete source carve-outs + the __init__
              markers of the three wholesale subtrees.
    Any divergence -- a new unclassified module, a removed/typo'd manifest line,
    or a dangling entry -- breaks this equality.
    """
    real = (
        _py_modules(_VOXEL_LITHO) | _py_modules(_PARSERS) | _top_level_py_modules(_DOMAIN_SERVICES)
    )
    concrete_carveouts = {name for name in SOURCE_CARVEOUTS if name != "__init__"}
    covered = (
        set(COMPILED_MODULES)
        | concrete_carveouts
        | _init_modules(_DOMAIN_SERVICES)  # domain/services + voxel_litho __init__
        | _init_modules(_PARSERS)
    )
    assert covered == real, (
        f"manifest drift -- unclassified/new: {sorted(real - covered)}; "
        f"stale/dangling: {sorted(covered - real)}"
    )
