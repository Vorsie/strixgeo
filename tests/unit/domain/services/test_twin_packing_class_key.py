"""Cross-language twin test — geotech packing-class key (debt #284).

The packing-class identity ("same litho and packing density") lives once in
Python (``domain/services/voxel_litho/packing_class_key.py`` —
``packing_class_key_of``) and once in TypeScript
(``utils/geotechHierarchicalFill/packingClassOf.ts`` —
``buildPackingClassOf``). Both collapse a formation row that carries BOTH a
NAD class and a soil code to ``"SOIL|CLASS"`` and keep a row missing either
half at its own row identity, so the backend voxel body merge and the frontend
fill agree on what "same body" means.

This module and its TypeScript twin
(``desktop/src/renderer/src/utils/geotechHierarchicalFill/packingClassKey.twin.test.ts``)
read the SAME committed arbiter,
``tests/fixtures/contracts/packing_class_key.json``. A fix on one side of the
twin fails the other side's suite when it drifts.

The two implementations differ in ONE faithful way: the Python callable folds
the "id not among the rows -> id itself" fallback INTO ``key_of``, whereas the
TypeScript builder returns a ``Map`` with no entry for a missing/unknown id and
the call site applies ``?? id`` (e.g. ``PartitionFillOverlay.tsx``). The
contract therefore compares the EFFECTIVE key — ``key_of(id)`` on this side and
``map.get(id) ?? id`` on the other — which is exactly what both call sites rely
on, so the fixture's ``effective_key`` / ``expected_key`` fields are the shared
truth.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from groundmodel.domain.services.voxel_litho.packing_class_key import packing_class_key_of

# tests/unit/domain/services/ -> tests/
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "contracts" / "packing_class_key.json"
)


def _fixture() -> dict[str, Any]:
    """Load the shared twin fixture.

    Returns
    -------
    dict[str, Any]
        The parsed arbiter: ``rows`` (with an ``effective_key`` per row) and
        ``cases`` (query id -> expected key, including an id not among rows).
    """
    with _FIXTURE_PATH.open(encoding="utf-8") as handle:
        return dict(json.load(handle))


_FIX = _fixture()
_ROWS: list[dict[str, Any]] = list(_FIX["rows"])
_CASES: list[dict[str, Any]] = list(_FIX["cases"])


def _key_of() -> Any:
    """Build the project's packing-class key callable from the fixture rows.

    Returns
    -------
    callable of (str) -> str
        The domain builder's callable, fed the fixture's ``(id, nad_class,
        soil_code)`` triples exactly as the application loader would.
    """
    return packing_class_key_of((r["formation_id"], r["nad_class"], r["soil_code"]) for r in _ROWS)


@pytest.mark.parametrize("row", _ROWS, ids=[r["formation_id"] for r in _ROWS])
def test_effective_key_of_each_row_matches_the_shared_contract(row: dict[str, Any]) -> None:
    """Every fixture row's effective key matches the domain builder.

    Parameters
    ----------
    row : dict[str, Any]
        One fixture row: ``formation_id``, ``nad_class`` (int or null),
        ``soil_code`` (str or null) and the agreed ``effective_key``.
    """
    key_of = _key_of()
    assert key_of(row["formation_id"]) == row["effective_key"], row["formation_id"]


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_query_cases_match_the_shared_contract(case: dict[str, Any]) -> None:
    """Each fixture case (incl. an id absent from the rows) matches the builder.

    Parameters
    ----------
    case : dict[str, Any]
        One fixture case: a ``query_id`` and its ``expected_key``. The
        ``id_absent_from_the_rows`` case pins the "unknown id -> itself"
        fallback the Python callable folds in.
    """
    key_of = _key_of()
    assert key_of(case["query_id"]) == case["expected_key"], case["name"]


def test_a_fix_on_one_side_of_the_twin_fails_the_other_sides_suite_when_it_drifts() -> None:
    """The fixture is the single source of truth both suites re-derive.

    Two rows of the same class and soil under different ids must collapse to
    ONE key (owner 2026-08-21 "one mass one body"); a row missing a half must
    keep its own row identity (two unknowns are not known to be the same
    density). Both facts are pinned in the fixture the TypeScript twin also
    reads, so a drift on either side turns the other side's suite red.
    """
    key_of = _key_of()
    assert key_of("f-sand-6") == key_of("f-sand-6-twin")
    assert key_of("f-no-class") == "f-no-class"
    assert key_of("f-no-soil") == "f-no-soil"
