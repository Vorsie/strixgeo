"""The absorb-all commit — Ctrl+drag over several packing bands (owner 2026-09-25).

The RULES are pinned RED-first in ``test_geotech_band_reclassification`` (AR1—AR6);
these tests pin the plumbing: the survivor takes the union AND the entered band
takes the remainder in ONE commit, the absorbed rows are deleted, every survivor
is the engineer's decision, and a release on the litho wall touches no other row.
"""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application import absorb_geotech_band_run as absorb_module
from groundmodel.application.absorb_geotech_band_run import AbsorbGeotechBandRun
from groundmodel.application.geotech_band_edit_helpers import (
    EdgeRevalidation,
    EdgeTransferPlan,
    GeotechColumnContext,
)
from groundmodel.domain.services.geotech_band_reclassification import GeotechBand
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

    @property
    def no_autoflush(self) -> Any:
        """A null context — the lock helper's ``with session.no_autoflush:``."""
        return nullcontext()

    async def execute(self, statement: object, params: object = None) -> object:
        """Answer the advisory lock (uncontended) and the orphan sweep (nothing)."""

        class _Result:
            @staticmethod
            def scalar_one() -> bool:
                return True

            @staticmethod
            def all() -> list:
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


def _scene(model_id: UUID, cpt_id: UUID, ids: list[UUID]):
    """Four sand bands 0-1 / 1-2 / 2-3 / 3-6 m over a uniform-qc series."""
    depths = [round(0.02 * i, 4) for i in range(301)]  # 0..6 m
    qc: list[float | None] = [12.0 for _ in depths]
    bounds = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 6.0)]
    rows = [_row(rid, top, base, model_id, cpt_id) for rid, (top, base) in zip(ids, bounds)]
    context = GeotechColumnContext(
        project_id=uuid4(),
        geotech_model_id=model_id,
        investigation_id=cpt_id,
        anchor_is_cpt=True,
        bands=tuple(_band(str(rid), top, base, 7) for rid, (top, base) in zip(ids, bounds)),
        band_rows={str(r.id): r for r in rows},
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
        statistic="median",
        source_litho_formation_id=LITHO_FID,
        source_geo_formation_id=GEO_FID,
    )
    return context, rows


def _patch(monkeypatch: pytest.MonkeyPatch, context: GeotechColumnContext) -> None:
    monkeypatch.setattr(
        absorb_module, "load_geotech_column_context", AsyncMock(return_value=context)
    )
    monkeypatch.setattr(
        absorb_module,
        "revalidate_layer_edges",
        AsyncMock(return_value=EdgeRevalidation((), (uuid4(),), ())),
    )
    monkeypatch.setattr(
        absorb_module,
        "transfer_accepted_edges",
        AsyncMock(return_value=EdgeTransferPlan((), ())),
    )
    monkeypatch.setattr(
        absorb_module,
        "ResolveLithoInstances",
        MagicMock(return_value=MagicMock(execute=AsyncMock())),
    )
    formation = GeologicalFormationOrm(
        id=uuid4(), app_project_id=uuid4(), name="ZAND (NAD 7)", color="#c2b280", display_order=1
    )
    monkeypatch.setattr(absorb_module, "formation_for_class", AsyncMock(return_value=formation))


def _use_case(session: _FakeSession) -> AbsorbGeotechBandRun:
    use_case = AbsorbGeotechBandRun(session)  # type: ignore[arg-type]
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()
    return use_case


@pytest.mark.asyncio
async def test_ab1_the_survivor_takes_the_union_and_the_entered_band_the_remainder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AB1 — b1 dragged through b2 and b3 into b4 at 4.5 m: two rows left, one commit."""
    model_id, cpt_id = uuid4(), uuid4()
    ids = [uuid4() for _ in range(4)]
    context, rows = _scene(model_id, cpt_id, ids)
    _patch(monkeypatch, context)
    session = _FakeSession()

    result = await _use_case(session).execute(
        project_id=uuid4(),
        geotech_model_id=model_id,
        band_ids=[ids[0], ids[1], ids[2]],
        entered_band_id=ids[3],
        new_depth_m=4.5,
    )

    b1, b2, b3, b4 = rows
    assert (b1.depth_top_m, b1.depth_base_m) == (0.0, 4.5)
    assert (b4.depth_top_m, b4.depth_base_m) == (4.5, 6.0)
    assert session.deleted == [b2, b3]
    assert session.added == []
    assert session.commits == 1
    assert result.layer_ids == (b1.id, b4.id)
    assert result.deleted_layer_ids == (b2.id, b3.id)
    assert b1.source == "manual" and b4.source == "manual"
    assert result.flagged_edge_ids != ()  # the revalidation outcome surfaces


@pytest.mark.asyncio
async def test_ab2_an_upward_drag_keeps_the_shallowest_row_of_the_run_as_survivor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AB2 — b4's top dragged up through b3 and b2 into b1 at 0.5 m."""
    model_id, cpt_id = uuid4(), uuid4()
    ids = [uuid4() for _ in range(4)]
    context, rows = _scene(model_id, cpt_id, ids)
    _patch(monkeypatch, context)
    session = _FakeSession()

    result = await _use_case(session).execute(
        project_id=uuid4(),
        geotech_model_id=model_id,
        band_ids=[ids[3], ids[2], ids[1]],
        entered_band_id=ids[0],
        new_depth_m=0.5,
    )

    b1, b2, b3, b4 = rows
    # The survivor is the SHALLOWEST row of the run (the merge rule): b2.
    assert (b2.depth_top_m, b2.depth_base_m) == (0.5, 6.0)
    assert (b1.depth_top_m, b1.depth_base_m) == (0.0, 0.5)
    assert session.deleted == [b3, b4]
    assert result.layer_ids == (b1.id, b2.id)


@pytest.mark.asyncio
async def test_ab3_on_the_litho_wall_there_is_no_entered_band_to_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AB3 — the whole stack absorbed: one row left, nothing else touched."""
    model_id, cpt_id = uuid4(), uuid4()
    ids = [uuid4() for _ in range(4)]
    context, rows = _scene(model_id, cpt_id, ids)
    _patch(monkeypatch, context)
    session = _FakeSession()

    result = await _use_case(session).execute(
        project_id=uuid4(),
        geotech_model_id=model_id,
        band_ids=ids,
        entered_band_id=None,
        new_depth_m=None,
    )

    b1 = rows[0]
    assert (b1.depth_top_m, b1.depth_base_m) == (0.0, 6.0)
    assert session.deleted == rows[1:]
    assert result.layer_ids == (b1.id,)
