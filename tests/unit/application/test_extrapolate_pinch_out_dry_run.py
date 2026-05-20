"""Unit tests for the ExtrapolatePinchOut dry_run path.

Covers the contract introduced in the pinch-out ghost-preview UX slice:

* ``dry_run=True`` returns tip geometry but creates NO contacts, does NOT
  mark surfaces stale, does NOT seed the section, and does NOT commit.
* Geometry errors (ValueError) still propagate on the dry_run path —
  they map to HTTP 422 so the frontend can show an inline error message.

The DB session and repository are fully mocked so no real DB or network
I/O occurs (unit-test boundary, matching the CreateFormationContact /
AutoPopulateContactsFromStratigraphy test style).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.extrapolate_pinch_out import ExtrapolatePinchOut

PROJECT = uuid4()
MODEL = uuid4()
SECTION = uuid4()
FORMATION = uuid4()
TARGET = uuid4()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_session() -> AsyncMock:
    """Return a minimal async session mock with committed=False tracking."""
    session = AsyncMock()
    session.committed = False

    async def _commit():
        session.committed = True

    session.commit = AsyncMock(side_effect=_commit)
    session.flush = AsyncMock()
    session.add = MagicMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _make_section_orm() -> MagicMock:
    """Return a minimal CrossSectionOrm-shaped mock."""
    s = MagicMock()
    s.id = SECTION
    s.app_project_id = PROJECT
    s.start_x = 0.0
    s.start_y = 0.0
    s.end_x = 100.0
    s.end_y = 0.0
    return s


def _make_surface_orm(vertices: list, triangles: list) -> MagicMock:
    """Return a minimal FormationSurfaceOrm-shaped mock."""
    s = MagicMock()
    s.vertices = vertices
    s.triangles = triangles
    return s


def _scalar_one_or_none(value: object) -> MagicMock:
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dry_run_returns_tip_geometry_no_commit() -> None:
    """dry_run path computes tip geometry and returns it WITHOUT any DB write.

    A pair of non-diverging TIN slices is set up so ``compute_pinch_tip``
    returns a valid tip.  After the call we assert that:
    - ``created_contact_ids`` is empty
    - ``session.commit`` was never called (no DB writes)
    - ``session.add`` was never called (no contact inserts)
    """
    section_orm = _make_section_orm()

    # Minimal triangulated surfaces.  Three vertices each + one triangle —
    # enough to produce non-empty TIN slices in slice_tin after Delaunay.
    # The section runs along x (y=0), so contacts at y=0 are on the line.
    # Pinching surface: z(x,y=0) = 10 at x=0, 5 at x=50.
    # Target surface:   z(x,y=0) =  0 at x=0..100.
    pinching_verts = [(0.0, 0.0, 10.0), (50.0, 0.0, 5.0), (25.0, 10.0, 7.5)]
    pinching_tris = [(0, 1, 2)]
    target_verts = [(0.0, 0.0, 0.0), (100.0, 0.0, 0.0), (50.0, 10.0, 0.0)]
    target_tris = [(0, 1, 2)]

    pinching_surface_orm = _make_surface_orm(pinching_verts, pinching_tris)
    target_surface_orm = _make_surface_orm(target_verts, target_tris)

    session = _make_session()

    # ``session.get`` is the first call (load section), returns section_orm.
    session.get = AsyncMock(return_value=section_orm)

    # ``session.execute`` is called twice: once for the pinching surface,
    # once for the target surface.
    session.execute = AsyncMock(
        side_effect=[
            _scalar_one_or_none(pinching_surface_orm),
            _scalar_one_or_none(target_surface_orm),
        ]
    )

    uc = ExtrapolatePinchOut(session)
    # Swap the repo for a mock — we are not testing GeologyRepository.
    uc._repo = AsyncMock()

    result = await uc.execute(
        project_id=PROJECT,
        model_id=MODEL,
        formation_id=FORMATION,
        target_formation_id=TARGET,
        section_id=SECTION,
        direction="right",
        dry_run=True,
    )

    # The tip must be somewhere to the right of x=50 (the rightmost
    # slice point of the pinching surface) along the section line.
    assert result.created_contact_ids == []
    # `updated_section` removed from PinchOutResult by debt #62 item 3
    # (router owns section seeding now); dry-run has no seeding either.
    assert result.was_idempotent is False
    assert result.tip_along_m > 50.0
    # Elevation at the crossing is between 0 and 5 m (pinching dips toward 0).
    assert 0.0 <= result.tip_elevation_m <= 5.0

    # No DB side effects on a dry run.
    session.commit.assert_not_called()
    session.add.assert_not_called()
    uc._repo.mark_surfaces_stale.assert_not_called()


@pytest.mark.asyncio
async def test_dry_run_geometry_error_propagates() -> None:
    """dry_run propagates ValueError for diverging surfaces (maps to 422).

    The pinching surface rises away from the target — the ray never
    crosses, so ``compute_pinch_tip`` returns None and the use case
    raises ValueError.  This path must remain active on dry_run so
    the frontend can show "can't pinch out here" rather than a crash.
    """
    section_orm = _make_section_orm()

    # Pinching surface RISES to the right (gradient +1, wrong direction):
    # z = 5 + 1*(x-10) so it diverges from the flat target at z=0.
    pinching_verts = [(0.0, 0.0, 5.0), (10.0, 0.0, 15.0), (5.0, 10.0, 10.0)]
    pinching_tris = [(0, 1, 2)]
    target_verts = [(0.0, 0.0, -50.0), (100.0, 0.0, -50.0), (50.0, 10.0, -50.0)]
    target_tris = [(0, 1, 2)]

    pinching_surface_orm = _make_surface_orm(pinching_verts, pinching_tris)
    target_surface_orm = _make_surface_orm(target_verts, target_tris)

    session = _make_session()
    session.get = AsyncMock(return_value=section_orm)
    session.execute = AsyncMock(
        side_effect=[
            _scalar_one_or_none(pinching_surface_orm),
            _scalar_one_or_none(target_surface_orm),
        ]
    )

    uc = ExtrapolatePinchOut(session)
    uc._repo = AsyncMock()

    with pytest.raises(ValueError, match="not cross"):
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            formation_id=FORMATION,
            target_formation_id=TARGET,
            section_id=SECTION,
            direction="right",
            dry_run=True,
        )

    # No DB writes even when an error is raised.
    session.commit.assert_not_called()
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_dry_run_missing_tin_raises_value_error() -> None:
    """dry_run raises ValueError when a TIN surface is missing (no Build yet).

    The router maps this to 422, giving the frontend a clear
    "Build the 3D model first" message instead of a 500.
    """
    section_orm = _make_section_orm()

    session = _make_session()
    session.get = AsyncMock(return_value=section_orm)
    # First execute returns None (pinching surface not built yet).
    session.execute = AsyncMock(return_value=_scalar_one_or_none(None))

    uc = ExtrapolatePinchOut(session)
    uc._repo = AsyncMock()

    with pytest.raises(ValueError, match="No built TIN surface"):
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            formation_id=FORMATION,
            target_formation_id=TARGET,
            section_id=SECTION,
            direction="right",
            dry_run=True,
        )

    session.commit.assert_not_called()
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_commit_path_still_creates_contacts() -> None:
    """Regression: dry_run=False (default) still creates contacts.

    Ensures the dry_run early-exit did not accidentally short-circuit
    the commit path.  We mock the idempotency guard to return [] (no
    pre-existing contacts) and verify session.add is called twice
    (tip + twin) and commit fires.
    """
    section_orm = _make_section_orm()

    pinching_verts = [(0.0, 0.0, 10.0), (50.0, 0.0, 5.0), (25.0, 10.0, 7.5)]
    pinching_tris = [(0, 1, 2)]
    target_verts = [(0.0, 0.0, 0.0), (100.0, 0.0, 0.0), (50.0, 10.0, 0.0)]
    target_tris = [(0, 1, 2)]

    pinching_surface_orm = _make_surface_orm(pinching_verts, pinching_tris)
    target_surface_orm = _make_surface_orm(target_verts, target_tris)

    session = _make_session()
    session.get = AsyncMock(return_value=section_orm)
    session.execute = AsyncMock(
        side_effect=[
            # TIN surfaces (steps 2a, 2b)
            _scalar_one_or_none(pinching_surface_orm),
            _scalar_one_or_none(target_surface_orm),
            # Idempotency guard (step 6) — no existing synthetic contacts.
            SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [])),
        ]
    )
    session.refresh = AsyncMock()

    uc = ExtrapolatePinchOut(session)
    uc._repo = AsyncMock()

    # No CrossSectionRepository patch needed — debt #62 item 3 moved
    # section seeding out of this use case and into the router, so
    # the commit path here is just: insert contacts → mark stale →
    # commit, with no extra repository orchestration to mock.
    result = await uc.execute(
        project_id=PROJECT,
        model_id=MODEL,
        formation_id=FORMATION,
        target_formation_id=TARGET,
        section_id=SECTION,
        direction="right",
        dry_run=False,
    )

    # Two contacts created (tip + twin).
    assert session.add.call_count == 2
    # One commit for the contacts + surface-stale.
    assert session.committed is True
    # Result has the two newly-created ids (not empty).
    assert len(result.created_contact_ids) == 2
