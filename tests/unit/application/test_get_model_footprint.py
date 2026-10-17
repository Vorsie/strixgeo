"""Unit tests for ``GetModelFootprint`` — the 3-D viewer footprint-ring read.

The use case re-derives the alpha hull the LAST successful voxel build clipped
to, from the persisted ``LithoBuildGeneration.payload`` (the build's input AS
RECEIVED). No database picks are mutated and no build runs here — this is a
pure read, so every collaborator is mocked at the ``session.execute`` /
``LithoLayerRepository`` boundary, mirroring ``test_get_body_geo_labels.py``.

Four scenarios per the feature spec: happy path (a real ring), no generation
row yet (never built), fewer than 3 non-collinear columns (footprint
unbuildable), and a stored payload that fails to parse (an unreadable
generation). None of the three failure paths may raise past ``execute`` — they
all answer a 200-shaped outcome with ``polygon == []`` and a reason.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest

from groundmodel.application.get_model_footprint import GetModelFootprint

MODEL_ID: UUID = uuid4()
GENERATION_ID: UUID = uuid4()
BUILT_AT = datetime(2026, 8, 26, 12, 0, 0, tzinfo=UTC)

_PATH = "groundmodel.application.get_model_footprint"


def _fake_generation(payload: object) -> SimpleNamespace:
    """A stand-in ``LithoBuildGenerationOrm`` row carrying only what the use case reads."""
    return SimpleNamespace(
        id=GENERATION_ID, model_id=MODEL_ID, payload=payload, created_at=BUILT_AT
    )


def _session_returning(generation: SimpleNamespace | None) -> AsyncMock:
    """A mocked ``AsyncSession`` whose latest-generation query answers ``generation``."""
    session = AsyncMock()
    session.execute = AsyncMock(
        return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(first=lambda: generation))
    )
    return session


def _section_dict(
    *,
    columns: list[dict[str, object]],
    regions: list[dict[str, object]] | None = None,
    end_x: float = 10.0,
    end_y: float = 0.0,
) -> dict[str, object]:
    """A minimal section dict in the exact shape ``_generation_payload`` writes."""
    return {
        "start_x": 0.0,
        "start_y": 0.0,
        "end_x": end_x,
        "end_y": end_y,
        "columns": columns,
        "regions": regions or [],
    }


def _column(investigation_id: str, world_x: float, world_y: float, along_m: float = 0.0) -> dict:
    return {
        "investigation_id": investigation_id,
        "along_m": along_m,
        "world_x": world_x,
        "world_y": world_y,
    }


def _patched_empty_picks():
    """Patch ``LithoLayerRepository`` so ``load_body_picks`` answers no picks.

    The footprint-ring tests below all frame the hull from the section columns
    alone (no honored investigation), so the repository is a stub, exactly the
    pattern ``test_build_voxel_litho_model.py`` uses for the same collaborator.
    """
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])
    return patch(f"{_PATH}.LithoLayerRepository", return_value=repo)


@pytest.mark.asyncio
async def test_happy_path_returns_the_alpha_hull_ring() -> None:
    """Three non-collinear columns across two sections → a real ring, no reason."""
    payload = {
        "sections": [
            _section_dict(
                columns=[_column("A", 0.0, 0.0), _column("B", 10.0, 0.0, along_m=10.0)],
                regions=[
                    {
                        "formation_id": "KLEI",
                        "body_id": "body-1",
                        "polygon": [[0.0, 5.0], [1.0, 5.0], [1.0, 0.0], [0.0, 0.0]],
                        "gap_index": 0,
                    }
                ],
            ),
            _section_dict(
                columns=[_column("A", 0.0, 0.0), _column("C", 5.0, 10.0, along_m=10.0)],
                end_x=5.0,
                end_y=10.0,
            ),
        ]
    }
    session = _session_returning(_fake_generation(payload))

    with _patched_empty_picks():
        outcome = await GetModelFootprint(session).execute(MODEL_ID)

    assert outcome.unavailable_reason is None
    assert outcome.generation_id == GENERATION_ID
    assert outcome.built_at == BUILT_AT
    assert len(outcome.polygon) == 3
    assert set(outcome.polygon) == {(0.0, 0.0), (10.0, 0.0), (5.0, 10.0)}


@pytest.mark.asyncio
async def test_no_generation_row_answers_empty_polygon_with_a_reason() -> None:
    """A model that has never been built has no generation row — not an error."""
    session = _session_returning(None)

    outcome = await GetModelFootprint(session).execute(MODEL_ID)

    assert outcome.polygon == []
    assert outcome.generation_id is None
    assert outcome.built_at is None
    assert outcome.unavailable_reason is not None
    assert "built" in outcome.unavailable_reason.lower()
    # Nothing to honor from picks when there is no generation to rehydrate.
    session.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_fewer_than_three_columns_answers_empty_polygon_with_a_reason() -> None:
    """Two columns cannot frame a hull — ``build_domain_from_sections`` raises ValueError."""
    payload = {
        "sections": [
            _section_dict(
                columns=[_column("A", 0.0, 0.0), _column("B", 10.0, 0.0, along_m=10.0)],
            )
        ]
    }
    session = _session_returning(_fake_generation(payload))

    with _patched_empty_picks():
        outcome = await GetModelFootprint(session).execute(MODEL_ID)

    assert outcome.polygon == []
    assert outcome.generation_id == GENERATION_ID
    assert outcome.built_at == BUILT_AT
    assert outcome.unavailable_reason is not None
    assert "footprint" in outcome.unavailable_reason.lower()


@pytest.mark.asyncio
async def test_unreadable_payload_answers_empty_polygon_without_raising() -> None:
    """A generation written by an older/different builder must not 500 the viewer.

    ``payload`` here carries no ``sections`` key at all (a structurally
    different shape) — the use case must catch the parse failure, not let it
    escape ``execute``.
    """
    session = _session_returning(_fake_generation({"legacy_field": True}))

    outcome = await GetModelFootprint(session).execute(MODEL_ID)

    assert outcome.polygon == []
    assert outcome.generation_id == GENERATION_ID
    assert outcome.built_at == BUILT_AT
    assert outcome.unavailable_reason is not None
    assert "could not be read" in outcome.unavailable_reason.lower()


@pytest.mark.asyncio
async def test_unreadable_payload_wrong_sections_type_also_caught() -> None:
    """``sections`` present but not a list is just as unreadable as a missing key."""
    session = _session_returning(_fake_generation({"sections": "not-a-list"}))

    outcome = await GetModelFootprint(session).execute(MODEL_ID)

    assert outcome.polygon == []
    assert outcome.unavailable_reason is not None
    assert "could not be read" in outcome.unavailable_reason.lower()
