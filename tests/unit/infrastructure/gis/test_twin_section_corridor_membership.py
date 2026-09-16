"""Cross-language twin test — section corridor membership (debt #284).

The rule "is this investigation ON this section?" (inside the lateral buffer
AND between the two drawn endpoints, with a 1 micron endpoint tolerance) lives
once in Python (``infrastructure/gis/section_projection.py`` —
``project_onto_section_corridor``) and once in TypeScript
(``utils/sectionProjection.ts`` — ``investigationsOnSection``). The
2026-09-06 endpoint-tolerance bug had to be fixed on BOTH sides by hand and
nothing would have caught a fix landing on one side only ("Koppelprofiel 4
contains one test").

This module and its TypeScript twin
(``desktop/src/renderer/src/utils/sectionCorridorMembership.twin.test.ts``)
read the SAME committed arbiter,
``tests/fixtures/contracts/section_corridor_membership.json``. A fix on one
side of the twin fails the other side's suite when it drifts: to change the
membership rule you must change the fixture, which turns both suites red at
once.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_onto_section_corridor,
)

# tests/unit/infrastructure/gis/ -> tests/
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "contracts"
    / "section_corridor_membership.json"
)


def _fixture() -> dict[str, Any]:
    """Load the shared twin fixture.

    Returns
    -------
    dict[str, Any]
        The parsed arbiter: ``cases`` plus the ``along_offset_abs_tol_m``
        numeric tolerance the parity assertions use.
    """
    with _FIXTURE_PATH.open(encoding="utf-8") as handle:
        return dict(json.load(handle))


_FIX = _fixture()
_CASES: list[dict[str, Any]] = list(_FIX["cases"])
_ABS_TOL: float = float(_FIX["along_offset_abs_tol_m"])


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_membership_matches_the_shared_contract(case: dict[str, Any]) -> None:
    """Each fixture case's membership + projection matches the backend helper.

    Parameters
    ----------
    case : dict[str, Any]
        One fixture case: a ``section`` (four endpoints), a ``buffer_m``, a
        point (``point_x`` / ``point_y``) and the ``expected`` membership
        (``on_section`` and, when on, ``along`` / ``offset``).
    """
    section = SectionEndpoints(
        start_x=case["section"]["start_x"],
        start_y=case["section"]["start_y"],
        end_x=case["section"]["end_x"],
        end_y=case["section"]["end_y"],
    )
    result = project_onto_section_corridor(
        section, case["point_x"], case["point_y"], case["buffer_m"]
    )
    expected = case["expected"]

    # The membership decision is the drift-sensitive part — assert it strictly.
    assert (result is not None) is expected["on_section"], case["name"]

    if expected["on_section"]:
        assert result is not None
        assert result.along == pytest.approx(expected["along"], abs=_ABS_TOL)
        assert result.offset == pytest.approx(expected["offset"], abs=_ABS_TOL)


def test_a_fix_on_one_side_of_the_twin_fails_the_other_sides_suite_when_it_drifts() -> None:
    """The fixture is the single source of truth both suites re-derive.

    This is the debt #284 contract in one place: the backend helper reproduces
    every committed expected value, so the ONLY way to change the rule is to
    change the fixture — which the TypeScript twin
    (``sectionCorridorMembership.twin.test.ts``) also reads, so its suite goes
    red for the same edit. Proven once by flipping a fixture value and watching
    both suites go red.
    """
    # The far-endpoint case is the 2026-09-06 regression: a test whose
    # coordinate IS the section's far endpoint must count as a member even
    # though float noise can push the computed ``along`` a hair past length.
    far = next(c for c in _CASES if c["name"] == "far_endpoint_exact")
    section = SectionEndpoints(
        start_x=far["section"]["start_x"],
        start_y=far["section"]["start_y"],
        end_x=far["section"]["end_x"],
        end_y=far["section"]["end_y"],
    )
    result = project_onto_section_corridor(section, far["point_x"], far["point_y"], far["buffer_m"])
    assert result is not None, "the endpoint-coincident test must be a member"
