"""GS — the NAD gradient snap is ON for a project that never chose (owner 2026-08-26).

The owner ruled the gradient snap ON by default: a project opened for the first
time places a packing boundary on the steepest nearby qc gradient rather than on
the bare threshold crossing.  On the reference column that is the difference
between a dense/very-dense contact at 15.27 m and one at 15.10 m.

The ruling has a second half that matters more than the first: a project that
turned the snap OFF keeps it OFF.  A default is what applies in the absence of a
choice — it must never overwrite one.  These pins hold both halves, because the
only thing separating them is a single ``dict.get`` fallback that a future edit
could flip in either direction without any other test noticing.
"""

from __future__ import annotations

from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application import subdivide_all_bodies as sab_module
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies


def _use_case() -> SubdivideAllBodies:
    """Build the use case with a stand-in session; no query is ever issued."""
    return SubdivideAllBodies(cast(AsyncSession, object()))


@pytest.fixture
def stub_view_state(monkeypatch: pytest.MonkeyPatch):
    """Serve a canned ``view_state`` in place of the project lookup."""

    def _install(view_state: dict[str, Any] | None) -> None:
        async def _load(_session: object, _project_id: object) -> dict[str, Any] | None:
            return view_state

        monkeypatch.setattr(sab_module, "load_project_view_state", _load)

    return _install


@pytest.mark.asyncio
async def test_gs1_a_project_that_never_chose_gets_the_snap_on(stub_view_state) -> None:
    """GS1 — no stored choice at all: the snap is on."""
    stub_view_state(None)

    enabled, _window = await _use_case()._read_gradient_snap(uuid4())

    assert enabled is True, (
        "a project with no stored geotech prefs must get the ruled default (snap ON)"
    )


@pytest.mark.asyncio
async def test_gs2_other_geotech_prefs_stored_but_no_snap_choice_gets_the_snap_on(
    stub_view_state,
) -> None:
    """GS2 — the bag exists but carries no snap key: still the default.

    This is the shape a project written before the toggle existed has, and the
    shape any project has after saving a sibling pref — the key's absence is not
    a choice.
    """
    stub_view_state({"geotech_subdivision": {"minimum_layer_thickness_m": 0.5}})

    enabled, _window = await _use_case()._read_gradient_snap(uuid4())

    assert enabled is True, "a missing snap key is the absence of a choice, not a stored OFF"


@pytest.mark.asyncio
async def test_gs3_a_project_that_turned_the_snap_off_keeps_it_off(
    stub_view_state,
) -> None:
    """GS3 — an explicitly saved OFF survives the default."""
    stub_view_state({"geotech_subdivision": {"gradient_snap_enabled": False}})

    enabled, _window = await _use_case()._read_gradient_snap(uuid4())

    assert enabled is False, (
        "a stored OFF is the engineer's own choice; the default must not overwrite it"
    )


@pytest.mark.asyncio
async def test_gs4_a_project_that_turned_the_snap_on_keeps_it_on(
    stub_view_state,
) -> None:
    """GS4 — an explicitly saved ON round-trips too."""
    stub_view_state({"geotech_subdivision": {"gradient_snap_enabled": True}})

    enabled, _window = await _use_case()._read_gradient_snap(uuid4())

    assert enabled is True
