"""Tests for the hand split/merge write path on the geotech axis.

Owner rulings pinned here (2026-08-01):

* **Recalculation is local** — only the column edited re-derives; the loader
  never reaches past that column's anchor, and the writer never touches another
  column's rows.
* **A connection breaks if the new class no longer matches** — and only then.
* **Cannot answer beats a plausible answer** — a preview over a column with no
  usable qc reports that it cannot answer rather than inventing a class.
* **A borehole is refused outright** (ruling A, 2026-08-01) — it records no cone
  resistance, so there is nothing to re-derive the class from. "Cannot answer"
  is the right outcome for a CPT interval whose qc happens to be unusable; on a
  borehole the gesture itself does not apply, and going ahead would trade the
  class ``DivideBoreholes`` extrapolated onto the column for no class at all.

The DB is mocked out: these pin the decision logic, not SQLAlchemy.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application import merge_geotech_bands as merge_module
from groundmodel.application import preview_geotech_band_edit as preview_module
from groundmodel.application import split_geotech_band as split_module
from groundmodel.application.geotech_band_edit_helpers import (
    EdgeRevalidation,
    EdgeTransferPlan,
    GeotechColumnContext,
    load_geotech_column_context,
)
from groundmodel.application.merge_geotech_bands import MergeGeotechBands
from groundmodel.application.preview_geotech_band_edit import PreviewGeotechBandEdit
from groundmodel.application.split_geotech_band import SplitGeotechBand
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
        #: Advisory-lock statements the use case issued, in order. The band
        #: edits take the body-partition lock BEFORE their first write (see
        #: ``application/body_partition_lock``), so the double has to answer
        #: ``execute`` — and recording it lets a test assert the lock was
        #: taken at all rather than silently swallowing it.
        self.executed: list[Any] = []

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

    async def execute(self, statement: Any, params: Any = None) -> Any:
        """Record a raw statement (the advisory lock) and answer harmlessly."""
        self.executed.append((statement, params))

        class _Result:
            @staticmethod
            def scalar_one() -> bool:
                # ``pg_try_advisory_xact_lock`` — the uncontended answer, so
                # the lock is taken without the blocking second statement.
                return True

            @staticmethod
            def scalar() -> bool:
                return True

            @staticmethod
            def scalar_one_or_none() -> None:
                return None

            @staticmethod
            def all() -> list:
                # ``OrphanFormationSweep`` runs before the commit and asks for
                # the project's geotech formations first. This scene has none in
                # the database, so the sweep finds no candidates and stops after
                # this one query — which is also what makes it a genuine no-op
                # here rather than something the test has to stub out.
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

    async def refresh(self, obj: Any) -> None:
        """No-op refresh."""


def _row(
    row_id: UUID,
    top: float,
    base: float,
    model_id: UUID,
    *,
    cpt_id: UUID | None = None,
    borehole_id: UUID | None = None,
) -> LithoLayerOrm:
    """Build an in-memory geotech band row (no session).

    The anchor is passed by keyword because the table enforces it as an XOR
    (``litho_layer_anchor_xor``): a band hangs off a CPT or off a borehole, never
    off both and never off neither. That column pair is the only thing that says
    which kind of investigation a band belongs to.
    """
    return LithoLayerOrm(
        id=row_id,
        model_id=model_id,
        formation_id=uuid4(),
        cpt_id=cpt_id,
        borehole_id=borehole_id,
        depth_top_m=top,
        depth_base_m=base,
        status="accepted",
        source="segmenter",
        confidence="medium",
    )


def _uniform_series(qc: float, base: float = 4.0) -> tuple[list[float], list[float | None]]:
    """A constant-qc CPT series from 0 m to ``base`` at 0.02 m spacing."""
    depths = [round(0.02 * i, 4) for i in range(int(base / 0.02) + 1)]
    return depths, [qc for _ in depths]


def _context(
    *,
    session_model_id: UUID,
    cpt_id: UUID,
    bands: list[GeotechBand],
    rows: dict[str, LithoLayerOrm],
    depth_m: list[float],
    qc_mpa: list[float | None],
) -> GeotechColumnContext:
    """Assemble a loaded column context without touching a database."""
    return GeotechColumnContext(
        project_id=uuid4(),
        geotech_model_id=session_model_id,
        investigation_id=cpt_id,
        anchor_is_cpt=True,
        bands=tuple(bands),
        band_rows=rows,
        soil="ZAND",
        admixtures=(),
        depth_m=depth_m,
        qc_mpa=qc_mpa,
        min_thickness_m=0.35,
        statistic="median",
        source_litho_formation_id=LITHO_FID,
        source_geo_formation_id=GEO_FID,
    )


def _borehole_context(
    *,
    model_id: UUID,
    borehole_id: UUID,
    bands: list[GeotechBand],
    rows: dict[str, LithoLayerOrm],
) -> GeotechColumnContext:
    """The same column context, anchored on a BOREHOLE instead of a CPT.

    ``depth_m`` / ``qc_mpa`` are empty because that is what the loader produces
    for a borehole anchor: it only reads a ``cpt_series`` row when the band hangs
    off a CPT. The emptiness is the consequence, not the cause — the cause is the
    anchor, and that is what the refusal keys on.
    """
    return replace(
        _context(
            session_model_id=model_id,
            cpt_id=borehole_id,
            bands=bands,
            rows=rows,
            depth_m=[],
            qc_mpa=[],
        ),
        anchor_is_cpt=False,
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


def _patch_common(monkeypatch: pytest.MonkeyPatch, module: Any, context: GeotechColumnContext):
    """Stub the DB-touching collaborators of a commit use case."""
    monkeypatch.setattr(module, "load_geotech_column_context", AsyncMock(return_value=context))
    monkeypatch.setattr(
        module,
        "revalidate_layer_edges",
        AsyncMock(return_value=EdgeRevalidation((), (), ())),
    )
    if hasattr(module, "transfer_accepted_edges"):
        monkeypatch.setattr(
            module,
            "transfer_accepted_edges",
            AsyncMock(return_value=EdgeTransferPlan((), ())),
        )
    monkeypatch.setattr(
        module, "ResolveLithoInstances", MagicMock(return_value=MagicMock(execute=AsyncMock()))
    )
    formation = GeologicalFormationOrm(
        id=uuid4(), app_project_id=uuid4(), name="ZAND (NAD 7)", color="#c2b280", display_order=1
    )
    monkeypatch.setattr(module, "formation_for_class", AsyncMock(return_value=formation))
    return formation


# ---------------------------------------------------------------------------
# Recalculation is local
# ---------------------------------------------------------------------------


async def test_the_context_loads_only_the_edited_columns_bands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only the edited column is read, so only it can be re-derived."""
    model_id, cpt_id, band_id = uuid4(), uuid4(), uuid4()
    target = _row(band_id, 0.0, 4.0, model_id, cpt_id=cpt_id)
    formation = GeologicalFormationOrm(
        id=target.formation_id,
        app_project_id=uuid4(),
        name="ZAND (NAD 6)",
        color="#c2b280",
        display_order=1,
        nad_class=6,
        litho_main_soil_code="ZAND",
        source_litho_formation_id=LITHO_FID,
        source_geo_formation_id=GEO_FID,
    )
    session = MagicMock()
    session.get = AsyncMock(
        side_effect=lambda model, key: {
            LithoLayerOrm: target,
            GeologicalFormationOrm: formation,
        }.get(model)
    )
    repo = MagicMock()
    repo.list_layers = AsyncMock(return_value=[target])
    monkeypatch.setattr(
        "groundmodel.application.geotech_band_edit_helpers.LithoLayerRepository",
        MagicMock(return_value=repo),
    )
    # The view-state read moved behind the shared geotech reader (2026-08-17),
    # so the same three callers cannot drift on the minimum-thickness default.
    monkeypatch.setattr(
        "groundmodel.application.geotech_band_edit_helpers.read_geotech_min_thickness_m",
        AsyncMock(return_value=0.35),
    )

    context = await load_geotech_column_context(
        session,
        MagicMock(),
        project_id=uuid4(),
        geotech_model_id=model_id,
        band_id=band_id,
    )

    repo.list_layers.assert_awaited_once()
    kwargs = repo.list_layers.await_args.kwargs
    assert kwargs["cpt_id"] == cpt_id
    assert kwargs["borehole_id"] is None
    assert [b.band_id for b in context.bands] == [str(band_id)]


async def test_a_split_writes_only_rows_of_the_edited_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A split resizes the band it was asked about and inserts one sibling — no more."""
    model_id, cpt_id, band_id = uuid4(), uuid4(), uuid4()
    target = _row(band_id, 0.0, 4.0, model_id, cpt_id=cpt_id)
    depths, qc = _uniform_series(5.0)
    context = _context(
        session_model_id=model_id,
        cpt_id=cpt_id,
        bands=[_band(str(band_id), 0.0, 4.0, 6)],
        rows={str(band_id): target},
        depth_m=depths,
        qc_mpa=qc,
    )
    _patch_common(monkeypatch, split_module, context)

    session = _FakeSession()
    use_case = SplitGeotechBand(session)
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    result = await use_case.execute(
        project_id=context.project_id,
        geotech_model_id=model_id,
        band_id=band_id,
        split_depth_m=2.0,
    )

    assert len(session.added) == 1
    new_row = session.added[0]
    assert isinstance(new_row, LithoLayerOrm)
    assert new_row.cpt_id == cpt_id  # the edited column, nothing else
    assert new_row.borehole_id is None
    assert new_row.model_id == model_id
    assert (new_row.depth_top_m, new_row.depth_base_m) == (2.0, 4.0)
    assert (target.depth_top_m, target.depth_base_m) == (0.0, 2.0)
    assert session.deleted == []
    assert session.commits == 1
    assert result.investigation_id == cpt_id


async def test_a_merge_extends_the_upper_band_and_deletes_the_lower(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The merged band spans the union; the lower row goes away."""
    model_id, cpt_id = uuid4(), uuid4()
    upper_id, lower_id = uuid4(), uuid4()
    upper = _row(upper_id, 0.0, 2.0, model_id, cpt_id=cpt_id)
    lower = _row(lower_id, 2.0, 4.0, model_id, cpt_id=cpt_id)
    depths, qc = _uniform_series(5.0)
    context = _context(
        session_model_id=model_id,
        cpt_id=cpt_id,
        bands=[_band(str(upper_id), 0.0, 2.0, 6), _band(str(lower_id), 2.0, 4.0, 7)],
        rows={str(upper_id): upper, str(lower_id): lower},
        depth_m=depths,
        qc_mpa=qc,
    )
    _patch_common(monkeypatch, merge_module, context)

    session = _FakeSession()
    use_case = MergeGeotechBands(session)
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    result = await use_case.execute(
        project_id=context.project_id,
        geotech_model_id=model_id,
        upper_band_id=upper_id,
        lower_band_id=lower_id,
    )

    assert (upper.depth_top_m, upper.depth_base_m) == (0.0, 4.0)
    assert session.deleted == [lower]
    assert session.added == []
    assert result.deleted_layer_ids == (lower_id,)
    # Uniform qc → the union is still ZAND matig; the class is derived, not carried.
    assert result.plan.intervals[0].nad_class == 6


# ---------------------------------------------------------------------------
# A connection breaks only when the new class no longer matches
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Cannot answer beats a plausible answer
# ---------------------------------------------------------------------------


async def test_the_preview_reports_that_it_cannot_answer_when_qc_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No usable qc → "cannot answer" with a reason, never a plausible class.

    This is also the control for the borehole refusal below: same empty series,
    CPT anchor. A CPT whose qc happens to be unusable is still answered — with
    "cannot answer" — because the gesture applies there and the qc simply failed.
    The refusal keys on the ANCHOR, not on an empty series, so this case must
    keep going through.
    """
    model_id, cpt_id, band_id = uuid4(), uuid4(), uuid4()
    target = _row(band_id, 0.0, 4.0, model_id, cpt_id=cpt_id)
    context = _context(
        session_model_id=model_id,
        cpt_id=cpt_id,
        bands=[_band(str(band_id), 0.0, 4.0, 6)],
        rows={str(band_id): target},
        depth_m=[],
        qc_mpa=[],
    )
    monkeypatch.setattr(
        preview_module, "load_geotech_column_context", AsyncMock(return_value=context)
    )

    plan = await PreviewGeotechBandEdit(MagicMock()).preview_split(
        project_id=context.project_id,
        geotech_model_id=model_id,
        band_id=band_id,
        split_depth_m=2.0,
    )

    assert [iv.nad_class for iv in plan.intervals] == [None, None]
    assert all(iv.unclassifiable_reason for iv in plan.intervals)


# ---------------------------------------------------------------------------
# A borehole is refused outright — ruling A, 2026-08-01
# ---------------------------------------------------------------------------


def _borehole_column(
    model_id: UUID, borehole_id: UUID, band_ids: list[UUID]
) -> GeotechColumnContext:
    """A borehole column carrying ``len(band_ids)`` contiguous 2 m packing bands."""
    bands = [_band(str(bid), 2.0 * i, 2.0 * (i + 1), 6) for i, bid in enumerate(band_ids)]
    rows = {
        str(bid): _row(bid, 2.0 * i, 2.0 * (i + 1), model_id, borehole_id=borehole_id)
        for i, bid in enumerate(band_ids)
    }
    return _borehole_context(model_id=model_id, borehole_id=borehole_id, bands=bands, rows=rows)


async def test_the_split_preview_refuses_a_band_on_a_borehole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A borehole has no cone resistance, so the split is refused before it is offered."""
    model_id, borehole_id, band_id = uuid4(), uuid4(), uuid4()
    context = _borehole_column(model_id, borehole_id, [band_id])
    monkeypatch.setattr(
        preview_module, "load_geotech_column_context", AsyncMock(return_value=context)
    )

    with pytest.raises(GeotechBandEditError):
        await PreviewGeotechBandEdit(MagicMock()).preview_split(
            project_id=context.project_id,
            geotech_model_id=model_id,
            band_id=band_id,
            split_depth_m=1.0,
        )


async def test_the_merge_preview_refuses_bands_on_a_borehole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same refusal for the other gesture — the preview never says yes where a commit says no."""
    model_id, borehole_id = uuid4(), uuid4()
    upper_id, lower_id = uuid4(), uuid4()
    context = _borehole_column(model_id, borehole_id, [upper_id, lower_id])
    monkeypatch.setattr(
        preview_module, "load_geotech_column_context", AsyncMock(return_value=context)
    )

    with pytest.raises(GeotechBandEditError):
        await PreviewGeotechBandEdit(MagicMock()).preview_merge(
            project_id=context.project_id,
            geotech_model_id=model_id,
            upper_band_id=upper_id,
            lower_band_id=lower_id,
        )


async def test_the_split_commit_refuses_a_band_on_a_borehole_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The commit refuses too, so the API cannot be driven around the UI."""
    model_id, borehole_id, band_id = uuid4(), uuid4(), uuid4()
    context = _borehole_column(model_id, borehole_id, [band_id])
    _patch_common(monkeypatch, split_module, context)

    session = _FakeSession()
    use_case = SplitGeotechBand(session)
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    with pytest.raises(GeotechBandEditError):
        await use_case.execute(
            project_id=context.project_id,
            geotech_model_id=model_id,
            band_id=band_id,
            split_depth_m=1.0,
        )

    # The class DivideBoreholes extrapolated onto this column is still there: the
    # refusal happens before any row is touched, so nothing was skeletonised.
    assert session.added == []
    assert session.deleted == []
    assert session.commits == 0


async def test_the_merge_commit_refuses_bands_on_a_borehole_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """And the merge commit, for the same reason and with the same blast radius: none."""
    model_id, borehole_id = uuid4(), uuid4()
    upper_id, lower_id = uuid4(), uuid4()
    context = _borehole_column(model_id, borehole_id, [upper_id, lower_id])
    _patch_common(monkeypatch, merge_module, context)

    session = _FakeSession()
    use_case = MergeGeotechBands(session)
    use_case._litho_repo = MagicMock()
    use_case._litho_repo.mark_litho_solids_stale = AsyncMock()

    with pytest.raises(GeotechBandEditError):
        await use_case.execute(
            project_id=context.project_id,
            geotech_model_id=model_id,
            upper_band_id=upper_id,
            lower_band_id=lower_id,
        )

    assert session.added == []
    assert session.deleted == []
    assert session.commits == 0


async def test_the_refusal_says_a_borehole_has_no_cone_resistance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The engineer is told the CAUSE, not just that he may not.

    The gesture works one column along, on a CPT. "Not allowed here" would leave
    him guessing; naming the missing cone resistance says why this column is
    different and what the class on it actually came from.
    """
    model_id, borehole_id, band_id = uuid4(), uuid4(), uuid4()
    context = _borehole_column(model_id, borehole_id, [band_id])
    monkeypatch.setattr(
        preview_module, "load_geotech_column_context", AsyncMock(return_value=context)
    )

    with pytest.raises(GeotechBandEditError) as excinfo:
        await PreviewGeotechBandEdit(MagicMock()).preview_split(
            project_id=context.project_id,
            geotech_model_id=model_id,
            band_id=band_id,
            split_depth_m=1.0,
        )

    message = str(excinfo.value).lower()
    assert "borehole" in message
    assert "cone resistance" in message
