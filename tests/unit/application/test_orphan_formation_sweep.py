"""Unit tests for OrphanFormationSweep — the shared unreferenced-formation sweep.

Why the sweep exists
--------------------
The owner pasted his "Geotech units" pane on 2026-08-26: 94 rows, of which only
32 had any bands.  The other 62 were vocabulary no verb ever deletes — geotech
formations left behind when a re-subdivide, a re-divide or a hand band-edit
stopped producing their packing class, then resurrected wholesale by the
.strix restore.  Nothing referenced them; nothing removed them.

What "unreferenced" has to mean
-------------------------------
Three tables point at a formation with ``ON DELETE CASCADE``, so the survivor
check has to name all three or the sweep destroys data:

* ``litho_layer`` — the bands.
* ``formation_contact`` — the accepted contacts.
* ``body`` — and this one is the trap.  ``ResolveLithoInstances`` deliberately
  KEEPS an orphan body when the engineer has named it, so a formation can hold
  zero bands and zero contacts and still own a named body with a hand-drawn
  boundary.  Deleting the formation would cascade the body, its boundary shape
  and every boundary node away without a word.

All DB interaction is mocked at the ``session.execute`` boundary, mirroring
``test_clear_litho_model.py``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.orphan_formation_sweep import (
    OrphanFormationSweep,
    OrphanFormationSweepResult,
)

PROJECT_ID: UUID = uuid4()

F_ORPHAN: UUID = uuid4()
F_WITH_LAYER: UUID = uuid4()
F_WITH_CONTACT: UUID = uuid4()
F_WITH_BODY: UUID = uuid4()


def _scalars_result(values: list) -> MagicMock:
    """Mock of ``(await session.execute(stmt)).scalars().all()``."""
    scalars = MagicMock()
    scalars.all.return_value = values
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def _rows_result(rows: list[tuple]) -> MagicMock:
    """Mock of ``(await session.execute(stmt)).all()`` returning row tuples."""
    result = MagicMock()
    result.all.return_value = rows
    return result


def _scalar_one_result(value: int) -> MagicMock:
    """Mock of ``(await session.execute(stmt)).scalar_one()``."""
    result = MagicMock()
    result.scalar_one.return_value = value
    return result


def _rowcount_result(n: int) -> MagicMock:
    """Mock of ``result.rowcount``."""
    result = MagicMock()
    result.rowcount = n
    return result


def _effects(
    *,
    candidates: list[tuple[UUID, str]],
    layer_refs: list[UUID],
    contact_refs: list[UUID],
    body_refs: list[UUID],
    stale_solids: int = 0,
    deleted: int | None = None,
) -> list:
    """Ordered ``session.execute`` side-effects for one sweep call.

    The sweep issues, in order:

    1. SELECT (id, name) for the candidate formations in scope.
    2. SELECT DISTINCT litho_layer.formation_id among the candidates.
    3. SELECT DISTINCT formation_contact.formation_id among the candidates.
    4. SELECT DISTINCT body.formation_id among the candidates.
    5. SELECT count(litho_body_solid) about to cascade (orphans only).
    6. DELETE geological_formation (orphans only).

    Steps 2-6 are skipped when there are no candidates; steps 5-6 are skipped
    when every candidate is still referenced.
    """
    effects: list = [_rows_result([(fid, name) for fid, name in candidates])]
    if not candidates:
        return effects
    effects.append(_scalars_result(layer_refs))
    effects.append(_scalars_result(contact_refs))
    effects.append(_scalars_result(body_refs))
    referenced = set(layer_refs) | set(contact_refs) | set(body_refs)
    orphans = [fid for fid, _ in candidates if fid not in referenced]
    if orphans:
        effects.append(_scalar_one_result(stale_solids))
        effects.append(_rowcount_result(deleted if deleted is not None else len(orphans)))
    return effects


# ---------------------------------------------------------------------------
# SW1 — the pure orphan dies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sw1_a_formation_nothing_points_at_is_deleted() -> None:
    """A geotech unit with no bands, no contacts and no bodies is swept.

    This is the 62-row remainder in the owner's pane: vocabulary describing
    ground that no longer exists anywhere in the project.
    """
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_ORPHAN, "ZAND (NAD 6)")],
            layer_refs=[],
            contact_refs=[],
            body_refs=[],
        )
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert isinstance(result, OrphanFormationSweepResult)
    assert result.deleted == 1
    assert result.names == ("ZAND (NAD 6)",)


# ---------------------------------------------------------------------------
# SW2 — every reference spares its formation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sw2_a_formation_with_a_band_in_any_model_survives() -> None:
    """One layer anywhere in the project is enough to keep the unit.

    The survivor query is deliberately NOT scoped to the model being reshaped:
    a unit shared with a sibling geotech model still describes real ground.
    """
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_ORPHAN, "orphan"), (F_WITH_LAYER, "has a band")],
            layer_refs=[F_WITH_LAYER],
            contact_refs=[],
            body_refs=[],
        )
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert result.deleted == 1
    assert result.names == ("orphan",)


@pytest.mark.asyncio
async def test_sw3_a_formation_with_only_a_contact_survives() -> None:
    """A contact with no surviving layer still counts as a reference."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_ORPHAN, "orphan"), (F_WITH_CONTACT, "has a contact")],
            layer_refs=[],
            contact_refs=[F_WITH_CONTACT],
            body_refs=[],
        )
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert result.deleted == 1
    assert result.names == ("orphan",)


@pytest.mark.asyncio
async def test_sw4_a_formation_whose_only_reference_is_a_body_survives() -> None:
    """A body the engineer named must not be cascaded away by the sweep.

    ``ResolveLithoInstances._run_resolver`` keeps an orphan body when it has a
    name, so "no bands and no contacts" is NOT the same as "nothing points at
    it".  ``body.formation_id`` is ON DELETE CASCADE, and the body cascades on
    to ``body_boundary_shape`` and ``body_boundary_node`` — a hand-drawn
    boundary would vanish silently.
    """
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_ORPHAN, "orphan"), (F_WITH_BODY, "named body lives here")],
            layer_refs=[],
            contact_refs=[],
            body_refs=[F_WITH_BODY],
        )
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert result.deleted == 1
    assert result.names == ("orphan",)


# ---------------------------------------------------------------------------
# SW5 — nothing to do
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sw5_no_candidates_is_a_no_op_that_issues_one_query() -> None:
    """A project with no geotech units at all costs one SELECT and nothing else."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(candidates=[], layer_refs=[], contact_refs=[], body_refs=[])
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert result == OrphanFormationSweepResult(deleted=0, names=(), stale_solids_cascaded=0)
    assert session.execute.await_count == 1


@pytest.mark.asyncio
async def test_sw6_every_candidate_referenced_issues_no_delete() -> None:
    """When nothing is orphaned the sweep stops after the three survivor queries."""
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_WITH_LAYER, "kept")],
            layer_refs=[F_WITH_LAYER],
            contact_refs=[],
            body_refs=[],
        )
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert result.deleted == 0
    # 1 candidate SELECT + 3 survivor SELECTs; no solid count, no DELETE.
    assert session.execute.await_count == 4


# ---------------------------------------------------------------------------
# SW7 — the cascade is disclosed, not hidden
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sw7_reports_the_stale_3d_solids_the_delete_cascades() -> None:
    """A built solid for a formation with no ground left is stale by definition.

    It is still a row disappearing through a CASCADE the sweep did not name, so
    the sweep counts them and says so rather than letting them go silently.
    """
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_ORPHAN, "orphan")],
            layer_refs=[],
            contact_refs=[],
            body_refs=[],
            stale_solids=3,
        )
    )

    result = await OrphanFormationSweep(session).sweep_geotech_units(PROJECT_ID)

    assert result.stale_solids_cascaded == 3


# ---------------------------------------------------------------------------
# SW8 — the litho scope is the same machinery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sw8_the_litho_scope_runs_the_same_survivor_rule() -> None:
    """``ClearLithoModel``'s orphan pass is this same sweep under another scope.

    The only difference between the two is the WHERE clause that picks the
    candidates; the survivor rule, the cascade disclosure and the logging are
    one implementation.
    """
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=_effects(
            candidates=[(F_ORPHAN, "orphan"), (F_WITH_BODY, "kept")],
            layer_refs=[],
            contact_refs=[],
            body_refs=[F_WITH_BODY],
        )
    )

    result = await OrphanFormationSweep(session).sweep_litho_vocabulary(PROJECT_ID)

    assert result.deleted == 1
    assert result.names == ("orphan",)
