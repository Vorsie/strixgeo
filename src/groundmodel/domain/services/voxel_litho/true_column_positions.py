"""Move section columns onto their investigations' TRUE map positions (debt #247).

THE DEFECT
----------
:func:`~groundmodel.domain.services.voxel_litho.label_voxels._project_to_section_fence`
ranks sections by perpendicular distance to a polyline through each section's
column ``world_x``/``world_y``, and its docstring describes those as "the
columns' true ``(world_x, world_y)`` positions". They are not. The frontend's
``computeCanonicalColumnWorldPositions`` sets each column to *"the projected
position on the DENSEST section that contains it"* — deliberately, so a test
drawn on two sections is rendered in one consistent place.

Measured over the dev model's 83 payload columns: the canonical position differs
from the investigation's true location by a **median of 11.08 m, max 64.91 m**,
with **77 of 83 off by more than a metre**.

Everything else in the builder works in TRUE world space: the voxel grid, the
domain footprint (since the footprint fix in ``d3b6c1fd0``..``99c6e023f``) and
the honored investigation columns. So the labeller decided WHICH SECTIONS ARE
NEAREST a voxel in one coordinate space while placing the material in another,
~11 m away. This is the exact twin of that footprint bug — that consumer was
fixed, this one was missed.

What it costs, on real data: at ``GEO-23/125-S12`` the model matches the log, but
two metres away — one horizontal voxel — 1.75 m of the silt base becomes clay,
because a 2-column tie section measures 2.52 m away (weight 0.83) while
Cross-section 1, whose own leg the sample point sits on, measures 12.25 m
(weight 0.17). CS1's own partition there carries no clay at all.

THE FIX (owner ruling 2026-07-29: "rank by true positions")
-----------------------------------------------------------
Move every section column onto its investigation's true location before
labelling. The ranking and the gap-local fraction are then both measured where
the ground actually is, and a test shared by two sections lands on ONE point
instead of two canonical feet that disagree.

This re-measures; it does not re-draw. ``along_m``, the section line endpoints,
the region polygons and the column order are all untouched — the 2-D partition
the engineer validated is not altered in any way.

A column whose investigation has no honored entry (no body-assigned accepted
picks, so no true position is known here) keeps the coordinate it arrived with:
dropping it would move geometry rather than re-measure it.

Pure domain module — no I/O, no framework imports.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    SectionColumnInput,
    SectionPartitionInput,
)

__all__ = ["apply_true_column_positions"]


def apply_true_column_positions(
    sections: list[SectionPartitionInput],
    investigation_columns: tuple[InvestigationColumn, ...],
) -> tuple[list[SectionPartitionInput], int, float]:
    """Re-seat each section column on its investigation's true map position.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The per-section 2-D partitions as POSTed by the frontend, whose columns
        carry the canonical (projected) positions.
    investigation_columns : tuple of InvestigationColumn
        The honored columns, which carry the TRUE ``world_x``/``world_y`` read
        from the investigations themselves.

    Returns
    -------
    tuple of (list of SectionPartitionInput, int, float)
        The re-seated sections, how many columns moved, and the largest shift in
        metres — the last two purely so the caller can log the magnitude of the
        correction. The input is not mutated.
    """
    true_by_id = {c.investigation_id: (c.world_x, c.world_y) for c in investigation_columns}
    if not true_by_id:
        return list(sections), 0, 0.0

    moved = 0
    max_shift = 0.0
    out: list[SectionPartitionInput] = []
    for section in sections:
        columns: list[SectionColumnInput] = []
        for column in section.columns:
            true_xy = true_by_id.get(column.investigation_id)
            if true_xy is None:
                columns.append(column)
                continue
            shift = math.hypot(true_xy[0] - column.world_x, true_xy[1] - column.world_y)
            if shift == 0.0:
                columns.append(column)
                continue
            moved += 1
            max_shift = max(max_shift, shift)
            columns.append(
                SectionColumnInput(
                    investigation_id=column.investigation_id,
                    along_m=column.along_m,
                    world_x=true_xy[0],
                    world_y=true_xy[1],
                )
            )
        out.append(
            SectionPartitionInput(
                start_x=section.start_x,
                start_y=section.start_y,
                end_x=section.end_x,
                end_y=section.end_y,
                columns=tuple(columns),
                regions=section.regions,
            )
        )
    return out, moved, max_shift
