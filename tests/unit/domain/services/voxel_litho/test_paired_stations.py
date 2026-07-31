"""A log that owns no voxel is unscoreable, and the gate must be able to say so.

Two investigations at one station — a borehole and its CPT, 0.28 m and 0.40 m apart on
the owner's model — cannot both own a cell on a 2 m grid. ``honor_rank`` picks one
(owner ruling 2026-07-27: has-a-log, then CPT beats borehole, then deepest, then id)
and the other's ground is labelled from its partner's log.

The test is OWNERSHIP, not proximity: two logs 2 m apart usually each keep cells of
their own and are both scoreable. Only a log left with no cell has nothing to be scored
on.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.voxel_litho.paired_stations import paired_station_losers
from groundmodel.domain.services.voxel_litho.voxel_types import InvestigationColumn

# A 2 m grid, 20 cells across, origin at 0 — the owner's horizontal spacing.
GX = np.arange(0.0, 40.0, 2.0)
GY = np.arange(0.0, 40.0, 2.0)


def _column(
    inv: str, x: float, y: float, *, base: float = -10.0, kind: str = "borehole"
) -> InvestigationColumn:
    """One investigation with a single observed interval, at a map position."""
    return InvestigationColumn(
        investigation_id=inv,
        world_x=x,
        world_y=y,
        intervals=(("z", "ZAND", 0.0, base),),
        kind=kind,
    )


def test_two_logs_at_one_station_leave_exactly_one_with_nothing() -> None:
    """Sharing a station, they claim the same cells and one is left mute.

    Placed at the same coordinate so the claim sets coincide exactly. A real station is
    0.28-0.40 m apart, which loses everything on the owner's grid phase but need not on
    an arbitrary one: a log 0.3 m to the left still reaches a cell centre its partner
    cannot, so who is left with NOTHING depends on where the grid happens to fall. That
    is a property of the builder, not of this rule.
    """
    losers = paired_station_losers(
        [_column("cpt", 10.0, 10.0, kind="cpt"), _column("bh", 10.0, 10.0)], GX, GY, 2.0
    )

    assert losers == {"bh"}


def test_the_cone_keeps_the_cell_over_the_borehole() -> None:
    """The owner's ruling in its own terms: at one station the CPT wins."""
    losers = paired_station_losers(
        [_column("bh", 10.0, 10.0), _column("cpt", 10.0, 10.0, kind="cpt")], GX, GY, 2.0
    )

    assert losers == {"bh"}


def test_logs_far_apart_each_keep_cells_of_their_own() -> None:
    """No contest, so nobody is unscoreable."""
    losers = paired_station_losers([_column("a", 6.0, 6.0), _column("b", 30.0, 30.0)], GX, GY, 2.0)

    assert losers == set()


def test_logs_a_couple_of_metres_apart_are_both_still_scoreable() -> None:
    """Why ownership beats proximity.

    A 2 m proximity rule called these a paired station and marked one unscoreable. They
    each keep cells of their own, so both can and should be scored — on the dev model
    that rule flagged 7 investigations where ownership finds the 2 that are genuinely
    mute.
    """
    losers = paired_station_losers(
        [_column("a", 10.0, 10.0), _column("b", 14.0, 10.0)], GX, GY, 2.0
    )

    assert losers == set()


def test_an_investigation_with_no_log_neither_wins_nor_loses() -> None:
    """Nothing to honour and nothing to score."""
    empty = InvestigationColumn(investigation_id="empty", world_x=10.0, world_y=10.0, intervals=())

    losers = paired_station_losers([empty, _column("b", 10.0, 10.0)], GX, GY, 2.0)

    assert losers == set()


def test_a_station_of_three_leaves_two_with_nothing() -> None:
    """Only one log can own a cell however many are crowded onto it."""
    losers = paired_station_losers(
        [
            _column("deep", 10.0, 10.0, base=-30.0),
            _column("mid", 10.0, 10.0, base=-20.0),
            _column("shallow", 10.0, 10.0, base=-5.0),
        ],
        GX,
        GY,
        2.0,
    )

    assert losers == {"mid", "shallow"}
