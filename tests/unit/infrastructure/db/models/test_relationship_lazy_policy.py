"""Every ORM ``relationship()`` must route its loader strategy through one switch.

Async SQLAlchemy cannot lazy-load: a relationship a response schema walks
without a ``selectinload`` raises ``MissingGreenlet`` as a runtime 500. Routing
every relationship's ``lazy=`` through ``RELATIONSHIP_LAZY`` (audit M4) makes
that a single, flippable switch — set ``STRIX_ORM_RELATIONSHIP_LAZY=raise`` and
the same mistake becomes an immediate, legible error an integration test catches.

This guard is source-level on purpose: the switch defaults to ``"raise"`` (since 2026-09-03), which
is also SQLAlchemy's default, so a runtime check of ``rel.lazy`` could not tell a
relationship wired to the constant apart from one that simply forgot ``lazy=``.
The AST scan asserts the keyword is literally present and references the constant,
so a relationship added later without it fails here.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

from groundmodel.infrastructure.db.models.orm_relationship_constants import (
    RELATIONSHIP_LAZY,
    RELATIONSHIP_LAZY_ENV_VAR,
)

# __file__ is tests/unit/infrastructure/db/models/<this>.py — parents[5] is the repo root.
_MODELS_DIR = pathlib.Path(__file__).resolve().parents[5] / (
    "src/groundmodel/infrastructure/db/models"
)


def _relationship_calls() -> list[tuple[str, ast.Call]]:
    """Return every ``relationship(...)`` call node found in the models package."""
    calls: list[tuple[str, ast.Call]] = []
    for path in sorted(_MODELS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "relationship"
            ):
                calls.append((path.name, node))
    return calls


def test_there_are_relationship_calls_to_check() -> None:
    """Sanity: the scan actually finds the mapped relationships."""
    assert len(_relationship_calls()) >= 30


def test_every_relationship_call_sets_lazy_from_the_constant() -> None:
    """No ORM relationship may keep SQLAlchemy's default loader strategy.

    Each ``relationship(...)`` must pass ``lazy=RELATIONSHIP_LAZY`` so the whole
    codebase's lazy policy flips from one place.
    """
    offenders = []
    for filename, call in _relationship_calls():
        lazy_kw = next((kw for kw in call.keywords if kw.arg == "lazy"), None)
        if lazy_kw is None or not (
            isinstance(lazy_kw.value, ast.Name) and lazy_kw.value.id == "RELATIONSHIP_LAZY"
        ):
            offenders.append(f"{filename}:{call.lineno}")
    assert not offenders, (
        "these relationship() calls do not route lazy through RELATIONSHIP_LAZY:\n  "
        + "\n  ".join(offenders)
    )


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [(None, "raise"), ("raise", "raise"), ("select", "select")],
)
def test_the_switch_defaults_to_raise_and_honours_the_env_var(
    monkeypatch: pytest.MonkeyPatch, env_value: str | None, expected: str
) -> None:
    """The tripwire ships ON (``raise``, promoted 2026-09-03); the env var can fall back.

    Re-imports the constants module so the module-level read of the env var is
    re-evaluated, proving the documented enable path works.
    """
    import importlib

    if env_value is None:
        monkeypatch.delenv(RELATIONSHIP_LAZY_ENV_VAR, raising=False)
    else:
        monkeypatch.setenv(RELATIONSHIP_LAZY_ENV_VAR, env_value)

    module = importlib.import_module(
        "groundmodel.infrastructure.db.models.orm_relationship_constants"
    )
    reloaded = importlib.reload(module)
    try:
        assert reloaded.RELATIONSHIP_LAZY == expected
    finally:
        # Restore the process-wide module to its real (unset-env) value so the
        # mapped classes keep matching what was configured at first import.
        monkeypatch.delenv(RELATIONSHIP_LAZY_ENV_VAR, raising=False)
        importlib.reload(module)


def test_the_live_constant_is_a_valid_loader_strategy() -> None:
    """Whatever the env produced must be a strategy SQLAlchemy accepts."""
    assert RELATIONSHIP_LAZY in {
        "select",
        "raise",
        "raise_on_sql",
        "selectin",
        "joined",
        "subquery",
    }
