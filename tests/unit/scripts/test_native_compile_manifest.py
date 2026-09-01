"""The native-compile manifest must never drift from the source tree.

``scripts/native_compile_manifest.py`` lists exactly which backend modules ship
as compiled ``.pyd`` in the packaged app (owner ruling 2026-08-31: the engine +
parsers must not leak as readable source). The danger this test guards against
is a NEW engine or parser module being added to the tree and silently shipping
as readable ``.py`` because nobody remembered to list it.

For the two areas that are compiled *wholesale* -- ``voxel_litho`` and
``infrastructure/parsers`` -- every ``.py`` must be accounted for by exactly one
of: ``COMPILED_MODULES``, the ``greedy_mesh`` source carve-out, or the
``__init__`` package-marker rule. A new file in either subtree that is not
classified breaks the equality below.

The named domain-services slice (``nad_classifier`` +
``nad_classification_constants`` + ``representative_statistic``) is hand-picked
rather than a whole directory, so this test can only guard that the named set
stays present and that ``geotech_band_reclassification`` remains the tracked
C3 deferral; it CANNOT auto-detect a brand-new engine service added to
``domain/services`` -- that stays a manual classification call.
"""

from __future__ import annotations

from pathlib import Path

from scripts.native_compile_manifest import COMPILED_MODULES, SOURCE_CARVEOUTS

# tests/unit/scripts/test_native_compile_manifest.py -> repo root is parents[3].
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SRC = _REPO_ROOT / "src"

_VOXEL_LITHO = "groundmodel/domain/services/voxel_litho"
_PARSERS = "groundmodel/infrastructure/parsers"

# The three engine domain-services deliberately in scope (see the manifest).
_NAMED_SERVICES = {
    "groundmodel.domain.services.nad_classifier",
    "groundmodel.domain.services.nad_classification_constants",
    "groundmodel.domain.services.representative_statistic",
}

# The one engine module deferred to SOURCE pending owner decision C3. Named
# explicitly so that landing C3 (moving it into COMPILED_MODULES) forces an edit
# to this test in the same commit -- it cannot silently drift either way.
_C3_DEFERRED = "groundmodel.domain.services.geotech_band_reclassification"


def _dotted(path: Path) -> str:
    """Return the dotted module name for a ``.py`` path under ``src/``."""
    return ".".join(path.relative_to(_SRC).with_suffix("").parts)


def _py_modules(rel_dir: str) -> set[str]:
    """Every ``.py`` under ``src/<rel_dir>`` as dotted names, ``__init__`` included."""
    return {_dotted(p) for p in (_SRC / Path(rel_dir)).rglob("*.py")}


def _init_modules(rel_dir: str) -> set[str]:
    """Every ``__init__.py`` under ``src/<rel_dir>`` as dotted names."""
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


def test_named_services_and_c3_deferral() -> None:
    """The named engine services are compiled; the C3 module is present but deferred."""
    compiled = set(COMPILED_MODULES)
    assert _NAMED_SERVICES <= compiled, (
        f"named engine services missing from COMPILED_MODULES: {_NAMED_SERVICES - compiled}"
    )
    assert (_SRC / (_C3_DEFERRED.replace(".", "/") + ".py")).exists(), (
        "the C3-deferred module no longer exists on disk -- update this test"
    )
    assert _C3_DEFERRED not in compiled, (
        "geotech_band_reclassification is in COMPILED_MODULES -- if C3 landed, update "
        "_C3_DEFERRED in this test to reflect it"
    )


def test_greedy_mesh_carveout_is_source_only() -> None:
    """The greedy_mesh carve-out is recorded and stays OUT of the compiled set."""
    greedy = "groundmodel.domain.services.voxel_litho.greedy_mesh"
    assert greedy in SOURCE_CARVEOUTS, "greedy_mesh missing from SOURCE_CARVEOUTS"
    assert "__init__" in SOURCE_CARVEOUTS, "the __init__ carve-out rule is undocumented"
    assert greedy not in set(COMPILED_MODULES), "greedy_mesh must not be compiled (numba @njit)"


def test_manifest_union_equals_the_real_module_set() -> None:
    """The classified union equals the real source set across all three areas.

    real  = every .py in voxel_litho + parsers, plus the named services + C3.
    covered = COMPILED_MODULES + the concrete source carve-outs + C3 + the
              __init__ markers of the two wholesale subtrees.
    Any divergence -- a new unclassified module, a removed/typo'd manifest line,
    or a dangling entry -- breaks this equality.
    """
    real = _py_modules(_VOXEL_LITHO) | _py_modules(_PARSERS) | _NAMED_SERVICES | {_C3_DEFERRED}
    concrete_carveouts = {name for name in SOURCE_CARVEOUTS if name != "__init__"}
    covered = (
        set(COMPILED_MODULES)
        | concrete_carveouts
        | {_C3_DEFERRED}
        | _init_modules(_VOXEL_LITHO)
        | _init_modules(_PARSERS)
    )
    assert covered == real, (
        f"manifest drift -- unclassified/new: {sorted(real - covered)}; "
        f"stale/dangling: {sorted(covered - real)}"
    )
