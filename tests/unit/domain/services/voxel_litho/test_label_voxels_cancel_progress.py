"""Cooperative cancel + per-column progress for ``label_voxels`` (debt #282).

The voxel build's labelling phase runs in an ``asyncio.to_thread`` worker that
Python cannot forcibly kill, so a Build is stopped COOPERATIVELY: the labeller
checks a ``should_cancel`` predicate between voxel columns and raises
:class:`~groundmodel.shared.exceptions.BuildCancelled` the moment it is asked to
stop.  It also reports its progress through a ``progress`` callback so the user
sees the column loop advance.

These pins are phrased in the owner's words for the slice — "the user can
cancel; a cancelled build ... the column loop stops early" and "the build
reports ... per-column progress" — not in labelling-internal terms.

The reused two-section fixture is the same one
``test_label_voxels`` builds its behavioural pins on; it frames a grid several
columns wide (``nx`` rows), which is what makes "stops early" and "advances"
observable.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
from groundmodel.shared.exceptions import BuildCancelled


def _section_a() -> SectionPartitionInput:
    """Section A (y=0): a single KLEI body from +10 to -10."""
    columns = (
        SectionColumnInput("A0", along_m=0.0, world_x=0.0, world_y=0.0),
        SectionColumnInput("A1", along_m=80.0, world_x=80.0, world_y=0.0),
    )
    regions = (
        RegionInput("KLEI", "kleiAll", ((0.0, 10.0), (1.0, 10.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=0.0, end_x=80.0, end_y=0.0, columns=columns, regions=regions
    )


def _section_b() -> SectionPartitionInput:
    """Section B (y=40): a single KLEI body from +10 to -10."""
    columns = (
        SectionColumnInput("B0", along_m=0.0, world_x=0.0, world_y=40.0),
        SectionColumnInput("B1", along_m=80.0, world_x=80.0, world_y=40.0),
    )
    regions = (
        RegionInput("KLEI", "kleiAll", ((0.0, 10.0), (1.0, 10.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=40.0, end_x=80.0, end_y=40.0, columns=columns, regions=regions
    )


def _domain() -> object:
    """A footprint strictly containing both section lines (several columns wide)."""
    tests = [
        DomainTest("F0", 0.0, -5.0, 10.0, -10.0),
        DomainTest("Fmid", 40.0, -5.0, 10.0, -10.0),
        DomainTest("F1", 80.0, -5.0, 10.0, -10.0),
        DomainTest("G0", 0.0, 45.0, 10.0, -10.0),
        DomainTest("Gmid", 40.0, 45.0, 10.0, -10.0),
        DomainTest("G1", 80.0, 45.0, 10.0, -10.0),
    ]
    return build_model_domain(tests)


_SECTIONS = [_section_a(), _section_b()]


def _nx() -> int:
    """Number of x-columns (rows) the labeller will iterate for this fixture."""
    grid = label_voxels(_domain(), 2.0, _SECTIONS)
    return len(grid.gx)


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


def test_should_cancel_stops_the_column_loop_and_raises_build_cancelled() -> None:
    """A cancel asked for mid-build stops the column loop early and raises.

    The predicate flips True after a few rows; the labeller must NOT keep
    labelling to the end — it raises ``BuildCancelled`` at the next column, so
    it is asked far fewer than ``nx`` times.
    """
    nx = _nx()
    assert nx > 6, "fixture must be several columns wide for 'stops early' to mean anything"

    calls = {"n": 0}

    def should_cancel() -> bool:
        calls["n"] += 1
        return calls["n"] >= 3  # ask to stop on the 3rd column

    with pytest.raises(BuildCancelled):
        label_voxels(_domain(), 2.0, _SECTIONS, should_cancel=should_cancel)

    # Stopped early: it stopped asking the instant it was told to stop, rather
    # than walking every one of the nx columns.
    assert calls["n"] == 3
    assert calls["n"] < nx


def test_should_cancel_never_true_builds_the_whole_grid() -> None:
    """A predicate that never asks to stop labels the whole grid, unchanged."""
    grid = label_voxels(_domain(), 2.0, _SECTIONS, should_cancel=lambda: False)
    # A KLEI body was labelled somewhere — the build ran to completion.
    assert grid.body_id_by_index != ()


def test_no_cancel_predicate_is_byte_identical_to_the_default_path() -> None:
    """Omitting ``should_cancel`` leaves the labelling byte-identical (guard)."""
    control = label_voxels(_domain(), 2.0, _SECTIONS)
    with_none = label_voxels(_domain(), 2.0, _SECTIONS, should_cancel=None)
    assert (control.labels == with_none.labels).all()


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------


def test_progress_reports_columns_done_out_of_total_and_reaches_the_end() -> None:
    """The build reports (done, total) ticks that advance and finish at 100%.

    Every tick's total is the column count; done never decreases; and the final
    tick is (nx, nx) so a progress bar reaches the end rather than stalling shy
    of it.
    """
    nx = _nx()
    ticks: list[tuple[int, int]] = []

    def progress(done: int, total: int) -> None:
        ticks.append((done, total))

    label_voxels(_domain(), 2.0, _SECTIONS, progress=progress)

    assert ticks, "the build reported no progress at all"
    assert all(total == nx for _done, total in ticks)
    dones = [done for done, _total in ticks]
    assert dones == sorted(dones), "progress went backwards"
    assert ticks[-1] == (nx, nx), "progress never reached 100%"


def test_progress_and_cancel_default_to_no_op() -> None:
    """Omitting both callbacks changes nothing — the grid still builds (guard)."""
    grid = label_voxels(_domain(), 2.0, _SECTIONS)
    assert grid.body_id_by_index != ()
