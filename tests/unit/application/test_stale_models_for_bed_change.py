"""Unit tests for :func:`mark_models_stale_for_bed_change`.

The rule (owner question 2026-09-13, "must I recompute the strat/geo/litho
models?"): a bed change stales the BUILT models so the engineer is told to
rebuild — every geological model's TIN surfaces (they clip to the ground+bed
line) and every litho / geotech model's voxel solids (the voxel caps at the
bed). A label-only rename does not reach here; the router gates that.

The helper instantiates its repositories from the session, so the repos are
patched with fakes that record which model each stale call named.
"""

from __future__ import annotations

import uuid

import pytest

import groundmodel.application.stale_models_for_bed_change as mod
from groundmodel.application.stale_models_for_bed_change import (
    mark_models_stale_for_bed_change,
)


class _FakeModel:
    """A stand-in for ``GeologicalModelOrm`` carrying only id + kind."""

    def __init__(self, kind: str) -> None:
        self.id = uuid.uuid4()
        self.kind = kind


class _FakeGeologyRepo:
    """Records which models had their surfaces staled."""

    def __init__(self, session: object) -> None:
        self.surfaces_staled: list[uuid.UUID] = []

    async def list_models(self, project_id: uuid.UUID) -> list[_FakeModel]:
        return _FakeGeologyRepo.models

    async def mark_all_surfaces_stale(self, model_id: uuid.UUID) -> int:
        self.surfaces_staled.append(model_id)
        return 7  # a non-zero count so the return total is exercised

    # Populated per-test before the call.
    models: list[_FakeModel] = []


class _FakeLithoRepo:
    """Records which models had their solids staled."""

    def __init__(self, session: object) -> None:
        self.solids_staled: list[uuid.UUID] = []

    async def mark_litho_solids_stale(self, model_id: uuid.UUID) -> int:
        self.solids_staled.append(model_id)
        return 5


@pytest.mark.asyncio
async def test_stales_geological_surfaces_and_litho_geotech_solids(monkeypatch):
    """Geological → surfaces stale; litho + geotech → solids stale."""
    geological = _FakeModel("geological")
    litho = _FakeModel("lithostratigraphic")
    geotech = _FakeModel("geotechnical")
    _FakeGeologyRepo.models = [geological, litho, geotech]

    geo_repo = _FakeGeologyRepo(None)
    litho_repo = _FakeLithoRepo(None)
    monkeypatch.setattr(mod, "GeologyRepository", lambda _s: geo_repo)
    monkeypatch.setattr(mod, "LithoLayerRepository", lambda _s: litho_repo)

    surfaces, solids = await mark_models_stale_for_bed_change(object(), uuid.uuid4())

    # Only the geological model's surfaces were staled.
    assert geo_repo.surfaces_staled == [geological.id]
    # Both non-stratigraphic models' solids were staled.
    assert set(litho_repo.solids_staled) == {litho.id, geotech.id}
    # The returned counts sum the repo rowcounts (one surface call, two solid).
    assert (surfaces, solids) == (7, 5 + 5)


@pytest.mark.asyncio
async def test_no_built_models_is_a_no_op(monkeypatch):
    """An empty project stales nothing and returns zeros (a legal no-op)."""
    _FakeGeologyRepo.models = []
    geo_repo = _FakeGeologyRepo(None)
    litho_repo = _FakeLithoRepo(None)
    monkeypatch.setattr(mod, "GeologyRepository", lambda _s: geo_repo)
    monkeypatch.setattr(mod, "LithoLayerRepository", lambda _s: litho_repo)

    surfaces, solids = await mark_models_stale_for_bed_change(object(), uuid.uuid4())

    assert (surfaces, solids) == (0, 0)
    assert geo_repo.surfaces_staled == []
    assert litho_repo.solids_staled == []
