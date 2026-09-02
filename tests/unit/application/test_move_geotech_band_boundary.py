"""The move commit — the drag verb's write path (owner 2026-08-07 "drag/merge").

The RULES are pinned RED-first in ``test_geotech_band_reclassification`` (PM1—
PM6); these tests pin the plumbing: an atomic two-row write, both rows stamped
as the engineer's, the borehole refusal writing nothing, and the revalidation
outcome surfacing on the result.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application import move_geotech_band_boundary as move_module
from groundmodel.application.geotech_band_edit_helpers import (
    EdgeRevalidation,
    GeotechColumnContext,
)
from groundmodel.application.move_geotech_band_boundary import MoveGeotechBandBoundary
from groundmodel.domain.services.geotech_band_reclassification import (
    GeotechBand,
    GeotechBandEditError,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm

LITHO_FID = uuid4()
GEO_FID = uuid4()


class _FakeSession:
    """Minimal AsyncSession stand-in that records what the use case wrote."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.commits = 0
        self.executed: list[object] = []

    @property
    def no_autoflush(self) -> Any:
        """Match ``AsyncSession.no_autoflush`` — a no-op ctx for the lock helper.

        ``lock_body_partition`` runs its lock SELECTs under
        ``with session.no_autoflush:`` so acquiring a lock never flushes a
        pending write first. The double has nothing to flush, so a null context
        is a faithful stand-in.
        """
        from contextlib import nullcontext

        return nullcontext()

    async def execute(self, statement: object, params: object = None) -> object:
        """Record a raw statement (the body-partition advisory lock) and answer.

        The band edits take the lock BEFORE their first write (see
        ``application/body_partition_lock``), so the double has to answer
        ``execute``; recording it lets a test assert the lock was taken.
        """
        self.executed.append((statement, params))

        class _Result:
            @staticmethod
            def scalar_one() -> bool:
                # ``pg_try_advisory_xact_lock`` — the uncontended answer.
                return True

            @staticmethod
            def all() -> list:
                # ``OrphanFormationSweep`` runs before the commit and asks for
                # the project's geotech formations first. This scene has none in
                # the database, so the sweep finds no candidates and stops after
                # this one query.
                return []

        return _Result()

    def add(self, obj: Any) -> None:
        """Record an INSERT."""
        self.added.append(obj)

    async def delete(self, obj: Any) -> None:
        """Record a DELETE."""
        self.deleted.append(obj)

    async def flush(self) -> None:
        """No-op flush."""

    async def commit(self) -> None:
        """Record a COMMIT."""
        self.commits += 1


def _row(row_id: UUID, top: float, base: float, model_id: UUID, cpt_id: UUID) -> LithoLayerOrm:
    """An in-memory geotech band row."""
    return LithoLayerOrm(
        id=row_id,
        model_id=model_id,
        formation_id=uuid4(),
        cpt_id=cpt_id,
        borehole_id=None,
        depth_top_m=top,
        depth_base_m=base,
        status="accepted",
        source="segmenter",
        confidence="medium",
    )


def _band(band_id: str, top: float, base: float, nad_class: int | None) -> GeotechBand:
    """One packing band on the edited column."""
    return GeotechBand(
        band_id=band_id,
        depth_top_m=top,
        depth_base_m=base,
        nad_class=nad_class,
        source_litho_formation_id=str(LITHO_FID),
        source_geo_formation_id=str(GEO_FID),
    )


def _scene(model_id: UUID, cpt_id: UUID, upper_id: UUID, lower_id: UUID):
    """Two adjacent sand bands 0-1 m (loose) / 1-4 m (dense), uniform qc each."""
    depths = [round(0.02 * i, 4) for i in range(201)]  # 0..4 m
    qc: list[float | None] = [5.0 if d < 1.0 else 18.0 for d in depths]
    upper_row = _row(upper_id, 0.0, 1.0, model_id, cpt_id)
    lower_row = _row(lower_id, 1.0, 4.0, model_id, cpt_id)
    context = GeotechColumnContext(
        project_id=uuid4(),
        geotech_model_id=model_id,
        investigation_id=cpt_id,
        anchor_is_cpt=True,
        bands=(
            _band(str(upper_id), 0.0, 1.0, 6),
            _band(str(lower_id), 1.0, 4.0, 8),
        ),
        band_rows={str(upper_id): upper_row, str(lower_id): lower_row},
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
        statistic="median",
        source_litho_formation_id=LITHO_FID,
        source_geo_formation_id=GEO_FID,
    )
    return context, upper_row, lower_row


def _patch(monkeypatch: pytest.MonkeyPatch, context: GeotechColumnContext) -> None:
    monkeypatch.setattr(move_module, "load_geotech_column_context", AsyncMock(return_value=context))
    monkeypatch.setattr(
        move_module,
        "revalidate_layer_edges",
        AsyncMock(return_value=EdgeRevalidation((), (uuid4(),), ())),
    )
    monkeypatch.setattr(
        move_module, "ResolveLithoInstances", MagicMock(return_value=MagicMock(execute=AsyncMock()))
    )
    formation = GeologicalFormationOrm(
        id=uuid4(), app_project_id=uuid4(), name="ZAND (NAD 7)", color="#c2b280", display_order=1
    )
    monkeypatch.setattr(move_module, "formation_for_class", AsyncMock(return_value=formation))


@pytest.mark.asyncio
async def test_mv1_the_move_writes_both_rows_atomically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MV1 — one boundary, two rows: upper.base == lower.top == the new depth."""
    model_id, cpt_id, upper_id, lower_id = uuid4(), uuid4(), uuid4(), uuid4()
    context, upper_row, lower_row = _scene(model_id, cpt_id, upper_id, lower_id)
    _patch(monkeypatch, context)
    session = _FakeSession()
    use_case = MoveGeotechBandBoundary(session)  # type: ignore[arg-type]
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    result = await use_case.execute(
        project_id=uuid4(),
        geotech_model_id=model_id,
        upper_band_id=upper_id,
        lower_band_id=lower_id,
        new_depth_m=1.6,
    )

    assert upper_row.depth_base_m == 1.6
    assert lower_row.depth_top_m == 1.6
    assert session.commits == 1
    assert session.deleted == [] and session.added == []  # a move creates/deletes nothing
    assert result.layer_ids == (upper_row.id, lower_row.id)
    assert result.flagged_edge_ids != ()  # the revalidation outcome surfaces


@pytest.mark.asyncio
async def test_mv2_both_rows_become_the_engineers_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MV2 — provenance: both rows stamp source='manual' (hand-edit counter)."""
    model_id, cpt_id, upper_id, lower_id = uuid4(), uuid4(), uuid4(), uuid4()
    context, upper_row, lower_row = _scene(model_id, cpt_id, upper_id, lower_id)
    _patch(monkeypatch, context)
    session = _FakeSession()
    use_case = MoveGeotechBandBoundary(session)  # type: ignore[arg-type]
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    await use_case.execute(
        project_id=uuid4(),
        geotech_model_id=model_id,
        upper_band_id=upper_id,
        lower_band_id=lower_id,
        new_depth_m=1.6,
    )

    assert upper_row.source == "manual"
    assert lower_row.source == "manual"


@pytest.mark.asyncio
async def test_mv3_a_borehole_is_refused_and_nothing_is_written(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MV3 — ruling A: no qc on a borehole, so the move refuses before writing."""
    model_id, cpt_id, upper_id, lower_id = uuid4(), uuid4(), uuid4(), uuid4()
    context, upper_row, lower_row = _scene(model_id, cpt_id, upper_id, lower_id)
    context = replace(context, anchor_is_cpt=False, depth_m=[], qc_mpa=[])
    _patch(monkeypatch, context)
    session = _FakeSession()
    use_case = MoveGeotechBandBoundary(session)  # type: ignore[arg-type]
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    with pytest.raises(GeotechBandEditError, match="[Mm]ove"):
        await use_case.execute(
            project_id=uuid4(),
            geotech_model_id=model_id,
            upper_band_id=upper_id,
            lower_band_id=lower_id,
            new_depth_m=1.6,
        )

    assert upper_row.depth_base_m == 1.0
    assert lower_row.depth_top_m == 1.0
    assert session.commits == 0
