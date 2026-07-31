"""Which investigations do not own the voxel column they stand in.

A regular grid fills a cell from ONE log. Where two investigations share a station,
``honor_rank`` picks the winner (owner ruling 2026-07-27: has-a-log, then CPT beats
borehole, then deepest, then id) and the other's ground carries its partner's log.

A log is scored WHERE IT STANDS, so what makes it unscoreable is its own cell carrying
someone else's log. That is a sharper test than either alternative:

* proximity is too loose — a 2.0 m rule with transitive grouping flagged 7
  investigations on the owner's model, five of them perfectly scoreable;
* "owns no cell anywhere" is too tight — two logs 1.13 m apart each keep cells further
  out while sharing the one between them, so neither is mute, yet the loser is still
  scored against a column it does not own.

On the owner's model that last case was hiding two of the three residual drilled-gate
failures: GEO-23/125-S5 standing in S5A's cell (1.13 m) and GEO-10/117-B4 standing in
GEO-05/040-S4's (0.49 m). Naming them leaves ONE real failure to chase instead of three.

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
    """The logged investigations that do not own the cell they stand in.

    A log is scored where it stands, so what makes it unscoreable is its OWN cell
    carrying someone else's log — not owning no cell anywhere. Two logs 1.13 m apart
    each keep cells of their own while sharing the one between them, and the loser is
    then scored against a column it does not own. On the owner's model that is exactly
    what the two residual drilled failures were: GEO-23/125-S5 standing in S5A's cell
    and GEO-10/117-B4 standing in GEO-05/040-S4's.

    A log that owns nothing at all is included too, since it certainly does not own its
    own cell.

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
        ``investigation_id`` of every logged investigation standing in a cell owned by
        another. An investigation with no observed intervals is never included: it has
        nothing to honour and nothing to score, so it neither wins nor loses.
    """
    owners = honored_cell_owners(columns, gx, gy, honor_radius_m)
    losers: set[str] = set()
    for column in columns:
        if not column.intervals:
            continue
        cell = (
            int(np.argmin(np.abs(gx - column.world_x))),
            int(np.argmin(np.abs(gy - column.world_y))),
        )
        owner = owners.get(cell)
        if owner is None or owner.investigation_id != column.investigation_id:
            losers.add(column.investigation_id)
    return losers
