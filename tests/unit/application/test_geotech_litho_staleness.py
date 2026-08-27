"""What the geotech model tells the engineer about the ground under it (#266).

The domain pins in ``tests/unit/domain/test_litho_column_digest.py`` state the
RULE — which columns count as moved.  These pin the READ the section view and
the coming export guard both go through: that it names the column rather than a
uuid, that it never counts a column with nothing on it, and that it separates
"verified current" from "cannot say".
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.geotech_litho_staleness import GeotechLithoStaleness
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

GEOTECH_MODEL_ID = uuid4()
LITHO_MODEL_ID = uuid4()
S17 = uuid4()
S9 = uuid4()
B1 = uuid4()


class _FakeSession:
    """AsyncSession stand-in that hands back one geotech model row."""

    def __init__(self, model: GeologicalModelOrm | None) -> None:
        self._model = model

    async def get(self, _cls: type[Any], _pk: UUID) -> GeologicalModelOrm | None:
        """Answer the single ``session.get(GeologicalModelOrm, ...)`` lookup."""
        return self._model


def _model(
    *,
    parent_model_id: UUID | None = LITHO_MODEL_ID,
    digests: dict[str, str] | None = None,
) -> GeologicalModelOrm:
    """A geotech model row carrying *digests* as its recorded provenance."""
    model = GeologicalModelOrm()
    model.id = GEOTECH_MODEL_ID
    model.kind = "geotechnical"
    model.parent_model_id = parent_model_id
    model.derived_from_litho_digests = digests
    return model


def _use_case(
    model: GeologicalModelOrm | None,
    *,
    banded: set[str],
    current: dict[str, str],
    names: dict[UUID, str] | None = None,
    monkeypatch: pytest.MonkeyPatch,
) -> GeotechLithoStaleness:
    """Wire the use case to a fixed answer for each of its three reads."""
    use_case = GeotechLithoStaleness(_FakeSession(model))  # type: ignore[arg-type]
    use_case._repo.banded_column_ids = AsyncMock(return_value=banded)  # type: ignore[method-assign]
    use_case._repo.load_column_digests = AsyncMock(return_value=current)  # type: ignore[method-assign]
    monkeypatch.setattr(
        "groundmodel.application.geotech_litho_staleness.load_investigation_names",
        AsyncMock(return_value=names or {}),
    )
    return use_case


@pytest.mark.asyncio
async def test_gs1_a_moved_column_is_reported_by_the_name_on_the_engineers_screen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ "S17's litho changed after its bands were made" — not a uuid.

    The engineer has to know WHICH column to re-press.  A stale count with no
    name is a warning he cannot act on.
    """
    use_case = _use_case(
        _model(digests={str(S17): "v1:as-built", str(S9): "v1:as-built"}),
        banded={str(S17), str(S9)},
        current={str(S17): "v1:moved", str(S9): "v1:as-built"},
        names={S17: "GEO-23/125-S17"},
        monkeypatch=monkeypatch,
    )

    result = await use_case.execute(geotech_model_id=GEOTECH_MODEL_ID)

    assert [(c.investigation_id, c.label) for c in result.stale_columns] == [
        (S17, "GEO-23/125-S17")
    ]
    assert result.banded_column_count == 2
    assert result.unstamped_column_count == 0


@pytest.mark.asyncio
async def test_gs2_a_model_whose_litho_has_not_moved_says_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The quiet case stays quiet — this is read on every geotech render."""
    use_case = _use_case(
        _model(digests={str(S17): "v1:as-built"}),
        banded={str(S17)},
        current={str(S17): "v1:as-built"},
        monkeypatch=monkeypatch,
    )

    result = await use_case.execute(geotech_model_id=GEOTECH_MODEL_ID)

    assert result.stale_columns == ()
    assert result.unstamped_column_count == 0


@pytest.mark.asyncio
async def test_gs3_bands_made_before_this_shipped_are_counted_apart_not_alarmed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ "Cannot say" is a different answer from "the ground moved".

    Every project banded before the stamp existed is in this state.  Flagging
    them stale would light up the owner's whole model on first open and teach
    him the indicator means nothing — but an export guard still has to be able
    to tell a verified column from one nobody can vouch for, so the count is
    reported separately rather than dropped.
    """
    use_case = _use_case(
        _model(digests={str(S17): "v1:as-built"}),
        banded={str(S17), str(S9), str(B1)},
        current={str(S17): "v1:as-built", str(S9): "v1:x", str(B1): "v1:y"},
        monkeypatch=monkeypatch,
    )

    result = await use_case.execute(geotech_model_id=GEOTECH_MODEL_ID)

    assert result.stale_columns == ()
    assert result.banded_column_count == 3
    assert result.unstamped_column_count == 2


@pytest.mark.asyncio
async def test_gs4_a_column_with_no_bands_left_is_never_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stamp outliving its bands must not send him to press an empty column.

    Bands can leave a column without a press (clearing it), so the read filters
    on what actually carries bands rather than trusting the stored map alone.
    """
    use_case = _use_case(
        _model(digests={str(S17): "v1:as-built", str(S9): "v1:as-built"}),
        banded={str(S9)},
        current={str(S17): "v1:moved", str(S9): "v1:as-built"},
        monkeypatch=monkeypatch,
    )

    result = await use_case.execute(geotech_model_id=GEOTECH_MODEL_ID)

    assert result.stale_columns == ()
    assert result.banded_column_count == 1


@pytest.mark.asyncio
async def test_gs5_a_model_with_no_litho_parent_answers_rather_than_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """There is nothing to compare against, and that is an answer.

    ``parent_model_id`` is nullable at the schema level (only creation enforces
    it), so a malformed row must not take the section view down with it — it
    reports every banded column as unvouched-for and logs why.
    """
    use_case = _use_case(
        _model(parent_model_id=None, digests=None),
        banded={str(S17), str(S9)},
        current={},
        monkeypatch=monkeypatch,
    )

    result = await use_case.execute(geotech_model_id=GEOTECH_MODEL_ID)

    assert result.litho_model_id is None
    assert result.stale_columns == ()
    assert result.unstamped_column_count == 2


@pytest.mark.asyncio
async def test_gs6_an_unknown_model_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing model is a caller error, not an empty answer."""
    use_case = _use_case(None, banded=set(), current={}, monkeypatch=monkeypatch)

    with pytest.raises(ValueError, match="not found"):
        await use_case.execute(geotech_model_id=GEOTECH_MODEL_ID)
