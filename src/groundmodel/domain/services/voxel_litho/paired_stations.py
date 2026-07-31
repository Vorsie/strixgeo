"""Which investigations own no voxel of their own, because a cell-mate outranks them.

A borehole and its CPT at one station sit centimetres apart — 0.28 m and 0.40 m on the
owner's model. A regular grid fills a cell from ONE log, so ``honor_rank`` picks the
winner (owner ruling 2026-07-27: has-a-log, then CPT beats borehole, then deepest, then
id) and the loser's ground is labelled from its partner's log instead of its own.

That makes the loser UNSCOREABLE against its own log: no change to the builder can make
the model reproduce a log whose cells belong to another investigation. Scoring it anyway
reports a permanent failure that masks real ones — both residual drilled-gate failures
on the dev model were exactly this, which is why the gate could not exceed 56/58
(recorded when #241 shipped).

The test is ownership, not proximity. Two logs 2 m apart usually each keep cells of
their own and are both perfectly scoreable; only a log left with NO cell has nothing to
be scored on. So this replays the builder's own assignment — the same
:func:`_honored_cells` sweep and the same ``honor_rank`` comparison — rather than
guessing a separation threshold. On the dev model a 2.0 m proximity rule flags 7
investigations where ownership finds the 2 that are genuinely mute.

Pure geometry over the value objects — no I/O, no logging, no framework.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from groundmodel.domain.services.voxel_litho.honor_precedence import honor_rank
from groundmodel.domain.services.voxel_litho.voxel_types import InvestigationColumn


def honored_cell_owners(
    columns: Sequence[InvestigationColumn],
    gx: np.ndarray,
    gy: np.ndarray,
    honor_radius_m: float,
) -> dict[tuple[int, int], InvestigationColumn]:
    """Replay the builder's honour assignment: which investigation owns each cell.

    Mirrors the loop in :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`
    exactly — every cell within ``honor_radius_m`` of an investigation is claimed, and
    where two claim the same cell the smaller ``honor_rank`` keeps it.

    Parameters
    ----------
    columns : sequence of InvestigationColumn
        Every investigation with a true map position.
    gx, gy : numpy.ndarray
        The grid's x and y axes, as the builder laid them out.
    honor_radius_m : float
        Radius within which an investigation claims a cell, in metres.

    Returns
    -------
    dict
        Cell ``(i, j)`` to its owning investigation. Cells nobody claims are absent.
    """
    # Imported here rather than at module scope: label_voxels imports this module for
    # nothing today, but keeping the edge one-way avoids a cycle if it ever does.
    from groundmodel.domain.services.voxel_litho.label_voxels import _honored_cells

    owners: dict[tuple[int, int], InvestigationColumn] = {}
    for column in columns:
        if not column.intervals:
            continue
        for cell in _honored_cells(gx, gy, column.world_x, column.world_y, honor_radius_m):
            incumbent = owners.get(cell)
            if incumbent is None or honor_rank(column) < honor_rank(incumbent):
                owners[cell] = column
    return owners


def paired_station_losers(
    columns: Sequence[InvestigationColumn],
    gx: np.ndarray,
    gy: np.ndarray,
    honor_radius_m: float,
) -> set[str]:
    """The logged investigations left owning no cell at all.

    Parameters
    ----------
    columns : sequence of InvestigationColumn
        Every investigation with a true map position.
    gx, gy : numpy.ndarray
        The grid's x and y axes, as the builder laid them out.
    honor_radius_m : float
        The builder's honour radius, in metres.

    Returns
    -------
    set of str
        ``investigation_id`` of every logged investigation that owns no cell. An
        investigation with no observed intervals is never included: it has nothing to
        honour and nothing to score, so it neither wins nor loses.
    """
    owners = honored_cell_owners(columns, gx, gy, honor_radius_m)
    winners = {id(column) for column in owners.values()}
    return {c.investigation_id for c in columns if c.intervals and id(c) not in winners}
