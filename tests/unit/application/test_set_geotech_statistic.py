"""SetGeotechStatistic — owner rulings 7 + 8 (docs/debt.md #227).

Ruling 7: the representative statistic is selectable PER GEOTECH MODEL.
Ruling 8: changing it marks the model stale — it does NOT silently re-derive
the bands (only a full "Subdivide all bodies" reclassifies, and that build
stamps ``classified_with_statistic``). So the use case writes exactly ONE
column and touches nothing else; staleness is DERIVED
(classified != representative), never stored.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from groundmodel.application.set_geotech_statistic import SetGeotechStatistic


class _FakeModel:
    """A geological_model row stand-in."""

    def __init__(self) -> None:
        self.id = uuid4()
        self.kind = "geotechnical"
        self.representative_statistic = "median"
        self.classified_with_statistic = "median"


class _FakeSession:
    """Records writes; get() serves the one model row."""

    def __init__(self, model: _FakeModel) -> None:
        self._model = model
        self.commits = 0
        self.added: list[Any] = []

    async def get(self, _orm: Any, _pk: Any) -> _FakeModel:
        return self._model

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1


@pytest.mark.asyncio
async def test_st1_writes_only_the_choice_column_and_derives_stale() -> None:
    """ST1 — the choice changes, the stamp does NOT, staleness is derived."""
    model = _FakeModel()
    session = _FakeSession(model)

    result = await SetGeotechStatistic(session).execute(  # type: ignore[arg-type]
        model_id=model.id, statistic="harmonic"
    )

    assert model.representative_statistic == "harmonic"
    # Ruling 8: the stamp belongs to the BUILD — changing the choice must not
    # touch it, and the mismatch is exactly what reads as "bands stale".
    assert model.classified_with_statistic == "median"
    assert result.representative_statistic == "harmonic"
    assert result.classified_with_statistic == "median"
    assert result.bands_stale is True
    assert session.commits == 1
    assert session.added == []  # no rows created — one UPDATE, nothing else


@pytest.mark.asyncio
async def test_st2_flipping_back_self_clears_the_staleness() -> None:
    """ST2 — choice back to the stamped statistic: stale reads false again."""
    model = _FakeModel()
    session = _FakeSession(model)
    await SetGeotechStatistic(session).execute(model_id=model.id, statistic="harmonic")  # type: ignore[arg-type]

    result = await SetGeotechStatistic(session).execute(  # type: ignore[arg-type]
        model_id=model.id, statistic="median"
    )

    assert result.bands_stale is False


@pytest.mark.asyncio
async def test_st3_unknown_token_refused_before_any_write() -> None:
    """ST3 — an unknown statistic is refused; nothing is written."""
    model = _FakeModel()
    session = _FakeSession(model)

    with pytest.raises(ValueError):
        await SetGeotechStatistic(session).execute(model_id=model.id, statistic="mode")  # type: ignore[arg-type]

    assert model.representative_statistic == "median"
    assert session.commits == 0
