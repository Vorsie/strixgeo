"""Cancel + progress wiring for ``BuildVoxelLithoModel.execute`` (debt #282).

These pins are the application half of the voxel-build Cancel/progress slice,
in the owner's words:

* "The build reports its phase and per-column progress while it runs." — the use
  case emits a ``(phase, done, total)`` event at each CPU-phase boundary and
  relays the labeller's per-column ticks under the ``"label"`` phase.
* "The user can cancel; a cancelled build leaves the model exactly as it was." —
  a ``should_cancel`` predicate raising ``BuildCancelled`` (between phases, or
  from inside the labeller) makes the use case ROLL BACK and re-raise, so
  nothing is committed.

The heavy collaborators (domain build, picks load, labeller, mesher,
persistence) are patched exactly as in ``test_build_voxel_litho_model``; the
assertions read the phase events collected and the session calls made.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import numpy as np
import pytest

from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel
from groundmodel.domain.services.voxel_litho.voxel_types import (
    LabelGrid,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.exceptions import BuildCancelled

_PATH = "groundmodel.application.build_voxel_litho_model"


def _section() -> SectionPartitionInput:
    """A minimal one-gap section with one filled region (the build payload)."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=10.0,
        end_y=0.0,
        columns=(
            SectionColumnInput("A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput("B", along_m=10.0, world_x=10.0, world_y=0.0),
        ),
        regions=(
            RegionInput(
                formation_id="KLEI",
                body_id="body-1",
                polygon=((0.0, 5.0), (1.0, 5.0), (1.0, 0.0), (0.0, 0.0)),
                gap_index=0,
            ),
        ),
    )


def _empty_grid() -> LabelGrid:
    """The LabelGrid the patched labeller returns (the mesher is stubbed too)."""
    return LabelGrid(
        gx=np.array([0.0]),
        gy=np.array([0.0]),
        gz=np.array([0.0]),
        labels=np.full((1, 1, 1), -1, dtype=np.int32),
        body_id_by_index=(),
        formation_by_body={},
    )


def _use_case() -> tuple[BuildVoxelLithoModel, AsyncMock]:
    """A use case whose mocked session records commit/rollback for assertions."""
    session = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: None))
    session.get = AsyncMock(
        return_value=SimpleNamespace(app_project_id=uuid4(), kind=MODEL_KIND_LITHOSTRATIGRAPHIC)
    )
    return BuildVoxelLithoModel(cast(Any, session)), session


def _patches(label_side_effect: Any):
    """The collaborator patch set; ``label_side_effect`` fakes the labeller."""
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])
    return [
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(f"{_PATH}.load_bed_override_polygons", new=AsyncMock(return_value=[])),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", side_effect=label_side_effect),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ]


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_emits_phase_boundaries_and_relays_label_ticks() -> None:
    """Each CPU phase reports a boundary event, and the labeller's ticks relay through.

    The labeller phase is named ``"label"``; the use case wraps its (done, total)
    callback so per-column ticks arrive on the same channel as the phase markers
    for ``reconcile`` and ``extract``.
    """
    events: list[tuple[str, int, int]] = []

    def fake_label(*args: Any, **kwargs: Any) -> LabelGrid:
        # The use case must have handed the labeller a per-column progress
        # adapter; drive it to prove the relay reaches the outer channel.
        cb = kwargs.get("progress")
        assert cb is not None, "the use case did not pass a progress callback to label_voxels"
        cb(0, 5)
        cb(5, 5)
        return _empty_grid()

    use_case, _session = _use_case()
    with _apply(_patches(fake_label)):
        await use_case.execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            force=True,
            progress=lambda phase, done, total: events.append((phase, done, total)),
        )

    phases = [phase for phase, _d, _t in events]
    assert "label" in phases
    assert "reconcile" in phases
    assert "extract" in phases
    # The relayed per-column ticks arrived under the label phase.
    assert ("label", 0, 5) in events
    assert ("label", 5, 5) in events


@pytest.mark.asyncio
async def test_no_progress_callback_is_a_silent_no_op() -> None:
    """Omitting ``progress`` builds exactly as before — no callback, no error (guard)."""
    use_case, _session = _use_case()
    with _apply(_patches(lambda *a, **k: _empty_grid())):
        outcome = await use_case.execute(uuid4(), [_section()], grid_spacing_m=1.0, force=True)
    assert outcome is not None


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_between_phases_rolls_back_and_writes_nothing() -> None:
    """A cancel asked before labelling rolls the session back and commits nothing.

    ``should_cancel`` returns True immediately, so the build stops at the first
    between-phase check. The use case must roll back (so a prior heal is undone)
    and re-raise ``BuildCancelled`` — never commit.
    """
    use_case, session = _use_case()
    with _apply(_patches(lambda *a, **k: _empty_grid())):
        with pytest.raises(BuildCancelled):
            await use_case.execute(
                uuid4(),
                [_section()],
                grid_spacing_m=1.0,
                force=True,
                should_cancel=lambda: True,
            )
    session.rollback.assert_awaited()
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_raised_inside_the_labeller_rolls_back() -> None:
    """A ``BuildCancelled`` from inside the labeller thread rolls back and re-raises.

    The real labeller raises this mid-column when its own ``should_cancel`` flips;
    the use case must treat that identically to a between-phase cancel — roll
    back, commit nothing, propagate.
    """

    def cancelling_label(*args: Any, **kwargs: Any) -> LabelGrid:
        raise BuildCancelled("cancelled mid-column")

    use_case, session = _use_case()
    with _apply(_patches(cancelling_label)):
        with pytest.raises(BuildCancelled):
            await use_case.execute(uuid4(), [_section()], grid_spacing_m=1.0, force=True)
    session.rollback.assert_awaited()
    session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Small ExitStack helper so the patch list applies as one context.
# ---------------------------------------------------------------------------


def _apply(patchers: list[Any]) -> Any:
    """Enter every patcher in *patchers* under one ``ExitStack``."""
    from contextlib import ExitStack

    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack
