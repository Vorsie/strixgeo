"""Unit tests for ``BuildVoxelLithoModel`` — the labeller wiring, without a DB.

These tests pin what the use case passes to
:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`: the
honored investigation columns, the grid spacings, and the drilled positions that
frame the footprint.

They also pin what it must NOT pass. The builder used to load the parent
geological model's band surfaces and hand them to the labeller as hard bounds.
Owner ruling 2026-07-30: *"the voids below td are always filled through
correlations from other tests the left or right (as in fill bands) if that is not
the case then you leave it unkown"* — the 2-D partition is the only authority on
lithology, so the geological model reaches the litho labelling nowhere at all.

The collaborators that would otherwise need real data (domain build, picks load,
the labeller, the mesher, the persistence) are patched; the assertions read the
keyword arguments ``label_voxels`` actually received.
"""

from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import replace
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import numpy as np
import pytest

from groundmodel.application.build_voxel_litho_model import (
    BuildVoxelLithoModel,
    _partition_checksum,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    LabelGrid,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_MODEL = "build_voxel_litho_model"
_PATH = f"groundmodel.application.{_MODEL}"


def _section() -> SectionPartitionInput:
    """A minimal one-gap section with one filled region (the build payload)."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=10.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=10.0, world_x=10.0, world_y=0.0),
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
    """A LabelGrid the patched ``label_voxels`` returns (mesher is stubbed too)."""
    return LabelGrid(
        gx=np.array([0.0]),
        gy=np.array([0.0]),
        gz=np.array([0.0]),
        labels=np.full((1, 1, 1), -1, dtype=np.int32),
        body_id_by_index=(),
        formation_by_body={},
    )


def _make_use_case() -> BuildVoxelLithoModel:
    """A ``BuildVoxelLithoModel`` whose session answers the settings read.

    ``session.get(GeologicalModelOrm, id)`` returns a model carrying a project id,
    which is all ``_read_honor_radius_m`` needs.  The parent-geological-model read
    is gone — the builder no longer looks the parent up at all.
    """
    session = AsyncMock()
    session.commit = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: None))
    session.get = AsyncMock(return_value=SimpleNamespace(app_project_id=uuid4()))
    return BuildVoxelLithoModel(cast(Any, session))


async def _run(
    use_case: BuildVoxelLithoModel,
    captured: dict[str, Any],
    *,
    vertical_spacing_m: float | None = None,
) -> None:
    """Execute the use case with every heavy collaborator patched.

    Records the kwargs ``label_voxels`` was called with into ``captured``.  When
    ``vertical_spacing_m`` is set, it is forwarded to ``execute`` so the
    anisotropy pass-through can be asserted.
    """

    def _capture_label(*args: Any, **kwargs: Any) -> LabelGrid:
        captured["args"] = args
        captured["kwargs"] = kwargs
        return _empty_grid()

    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", side_effect=_capture_label),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        await use_case.execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            vertical_spacing_m=vertical_spacing_m,
            force=True,
        )


@pytest.mark.asyncio
async def test_the_geological_model_never_reaches_the_litho_labeller() -> None:
    """No geological surfaces, and no snap tolerance, are passed to the labeller.

    Owner ruling 2026-07-30: below a shallow test's TD the model is filled only
    through correlations from the tests left or right, exactly as Fill bands does,
    and left unknown otherwise. The 2-D partition already decides that, so the
    parent geological model has no say in litho labelling — the builder must not
    hand the labeller anything to bound, clip or snap against.
    """
    captured: dict[str, Any] = {}

    await _run(_make_use_case(), captured)

    kwargs = captured["kwargs"]
    assert "geo_surfaces" not in kwargs
    assert "litho_snap_tolerance_m" not in kwargs


def test_the_builder_module_does_not_import_the_surface_loader() -> None:
    """A structural pin: re-adding the loader import would re-open the coupling.

    Cheaper and more durable than asserting on a call count — it fails the moment
    someone wires ``load_geo_surfaces`` back into the build path, whatever they
    then do with the result.
    """
    import groundmodel.application.build_voxel_litho_model as module

    assert not hasattr(module, "load_geo_surfaces")
    assert not hasattr(module, "digest_surfaces")
    assert not hasattr(BuildVoxelLithoModel, "_read_parent_geo_model_id")


# ---------------------------------------------------------------------------
# Anisotropic spacing (Task 4): the use case forwards the vertical spacing to
# the labeller, and a vertical-spacing change busts the partition checksum.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vertical_spacing_reaches_label_voxels() -> None:
    """An anisotropic ``vertical_spacing_m`` reaches ``label_voxels`` unchanged.

    The use case must thread the fine Z spacing through to the labeller (X/Y stay
    at ``grid_spacing_m``), so a 0.5 m vertical spacing the endpoint resolved
    arrives as the ``vertical_spacing_m`` keyword of ``label_voxels``.
    """
    captured: dict[str, Any] = {}

    await _run(_make_use_case(), captured, vertical_spacing_m=0.5)

    assert captured["kwargs"]["vertical_spacing_m"] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_cubic_default_passes_no_vertical_spacing_to_label_voxels() -> None:
    """No vertical spacing → the labeller receives ``vertical_spacing_m=None`` (cubic).

    The cubic default must stay byte-identical: omitting the vertical spacing
    forwards ``None``, so the labeller builds Z at ``grid_spacing_m`` exactly as
    before anisotropy existed.
    """
    captured: dict[str, Any] = {}

    await _run(_make_use_case(), captured)

    assert captured["kwargs"]["vertical_spacing_m"] is None


def test_cubic_checksum_is_byte_stable_with_pre_anisotropy_form() -> None:
    """A cubic digest (``vertical_spacing_m=None``) equals the no-keyword digest.

    The cubic case must NOT bust the cache: the digest with the vertical keyword
    omitted and with it explicitly ``None`` must be identical, so an existing
    cubic build is not spuriously re-meshed when the parameter is introduced.
    """
    sections = [_section()]
    legacy = _partition_checksum(sections, 2.0)
    explicit_none = _partition_checksum(sections, 2.0, vertical_spacing_m=None)
    assert legacy == explicit_none


def test_changing_vertical_spacing_busts_the_partition_checksum() -> None:
    """Two different vertical spacings (and cubic vs anisotropic) hash differently.

    Toggling anisotropy on (a non-``None`` vertical) or changing the vertical
    spacing must produce a different digest so the on-open ``force=false`` path
    rebuilds the model at the new resolution.
    """
    sections = [_section()]
    cubic = _partition_checksum(sections, 2.0, vertical_spacing_m=None)
    fine = _partition_checksum(sections, 2.0, vertical_spacing_m=0.5)
    finer = _partition_checksum(sections, 2.0, vertical_spacing_m=0.25)

    assert cubic != fine  # toggling anisotropy on busts the cache
    assert fine != finer  # changing the vertical spacing busts the cache


# ---------------------------------------------------------------------------
# The model footprint must reach the drilled positions
# ---------------------------------------------------------------------------
#
# A borehole feeds a cross-section at its PROJECTED FOOT on the section line —
# on real data metres to tens of metres from where it was actually drilled.  The
# builder honors each investigation's own log at its TRUE map position, so the
# footprint that gates labelling has to reach that position too; a footprint
# framed from the projected feet alone leaves boreholes standing outside the
# model they helped build, and the labeller then produces no material at all
# where the ground was drilled.


def _pick(inv_id: str, x_m: float, y_m: float) -> BodyLayerPick:
    """One accepted body-assigned pick for ``inv_id`` at a true map position."""
    return BodyLayerPick(
        investigation_id=inv_id,
        x_m=x_m,
        y_m=y_m,
        surface_elev_m=5.0,
        body_id="body-1",
        formation_id="KLEI",
        top_depth_m=0.0,
        base_depth_m=5.0,
    )


async def _run_capturing_domain(
    picks: list[BodyLayerPick], captured: dict[str, Any], *, grid_spacing_m: float = 1.0
) -> None:
    """Execute the use case, recording the kwargs the footprint builder received."""

    def _capture_domain(*args: Any, **kwargs: Any) -> Any:
        captured["domain_args"] = args
        captured["domain_kwargs"] = kwargs
        return SimpleNamespace(
            polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
        )

    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=picks)
    use_case = _make_use_case()

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(f"{_PATH}.build_domain_from_sections", side_effect=_capture_domain),
        patch(f"{_PATH}.label_voxels", return_value=_empty_grid()),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        await use_case.execute(uuid4(), [_section()], grid_spacing_m=grid_spacing_m, force=True)


@pytest.mark.asyncio
async def test_every_honored_investigations_drilled_position_frames_the_footprint() -> None:
    """The footprint builder receives each honored investigation's TRUE position.

    The section payload places investigation "A" at its projected foot ``(0, 0)``;
    the borehole was actually drilled 60 m north.  Both positions must reach the
    footprint builder, because the fill geometry lives at the foot and the
    honored log lives at the drilled position.
    """
    captured: dict[str, Any] = {}

    await _run_capturing_domain([_pick("A", 0.0, 60.0), _pick("B", 10.0, 40.0)], captured)

    supplied = captured["domain_kwargs"]["investigation_positions"]
    assert set(supplied) == {("A", 0.0, 60.0), ("B", 10.0, 40.0)}


@pytest.mark.asyncio
async def test_a_model_with_no_picks_frames_the_footprint_from_the_sections_alone() -> None:
    """No honored investigation → no extra footprint input (unchanged behaviour).

    A model whose picks are all unaccepted has nothing to honor, so the
    footprint stays exactly the section-fence hull it was before.
    """
    captured: dict[str, Any] = {}

    await _run_capturing_domain([], captured)

    assert captured["domain_kwargs"]["investigation_positions"] == ()


@pytest.mark.asyncio
async def test_investigations_closer_than_one_voxel_are_reported(caplog) -> None:
    """Two investigations inside one voxel are named at WARNING, not silently merged.

    Only ONE investigation per grid column can be honored, so a sub-voxel pair
    means one borehole's drilled log is replaced by its neighbour's at its own
    position — a fidelity loss the build log must surface.
    """
    captured: dict[str, Any] = {}

    with caplog.at_level("WARNING"):
        # 0.4 m apart, well inside a 2 m horizontal voxel.
        await _run_capturing_domain(
            [_pick("near-a", 0.0, 0.0), _pick("near-b", 0.4, 0.0)],
            captured,
            grid_spacing_m=2.0,
        )

    warnings = "\n".join(r.message for r in caplog.records if r.levelname == "WARNING")
    assert "near-a" in warnings and "near-b" in warnings
    assert "0.40 m" in warnings


@pytest.mark.asyncio
async def test_well_separated_investigations_raise_no_contention_warning(caplog) -> None:
    """Investigations more than one voxel apart never trigger the warning."""
    captured: dict[str, Any] = {}

    with caplog.at_level("WARNING"):
        await _run_capturing_domain(
            [_pick("far-a", 0.0, 0.0), _pick("far-b", 40.0, 0.0)],
            captured,
            grid_spacing_m=2.0,
        )

    warnings = "\n".join(r.message for r in caplog.records if r.levelname == "WARNING")
    assert "closer than" not in warnings


@pytest.mark.asyncio
async def test_a_sub_voxel_pair_straddling_a_bucket_boundary_is_still_reported(caplog) -> None:
    """Neighbours either side of a bucket seam are found, not missed.

    The contention scan buckets investigations by voxel to stay linear, so the
    case it can silently miss is a close pair that lands in DIFFERENT buckets.
    These two are 0.20 m apart across the x = 4.0 seam of a 2 m voxel.
    """
    captured: dict[str, Any] = {}

    with caplog.at_level("WARNING"):
        await _run_capturing_domain(
            [_pick("seam-left", 3.9, 7.9), _pick("seam-right", 4.1, 8.1)],
            captured,
            grid_spacing_m=2.0,
        )

    warnings = "\n".join(r.message for r in caplog.records if r.levelname == "WARNING")
    assert "seam-left" in warnings and "seam-right" in warnings


@pytest.mark.asyncio
async def test_each_sub_voxel_pair_is_reported_exactly_once(caplog) -> None:
    """A contending pair is named once, not once per bucket it is seen from."""
    captured: dict[str, Any] = {}

    with caplog.at_level("WARNING"):
        await _run_capturing_domain(
            [_pick("dup-a", 10.0, 10.0), _pick("dup-b", 10.5, 10.0)],
            captured,
            grid_spacing_m=2.0,
        )

    pair_lines = [r.message for r in caplog.records if "sub-voxel pair" in r.message]
    assert len(pair_lines) == 1, pair_lines
    assert "1 investigation pair(s)" in "\n".join(r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# The investigation kind must survive the trip to the labeller
# ---------------------------------------------------------------------------
#
# A regular grid holds one observed log per column, so when two investigations
# share a column the labeller has to choose between them — and it cannot judge a
# column whose provenance it never learns.  See docs/debt.md #241.


@pytest.mark.asyncio
async def test_the_investigation_kind_reaches_the_labeller() -> None:
    """A CPT's picks arrive at the labeller marked as a CPT, not as a borehole."""
    captured: dict[str, Any] = {}
    cpt_pick = replace(_pick("cpt-a", 0.0, 0.0), kind="cpt")
    borehole_pick = replace(_pick("bh-b", 50.0, 50.0), kind="borehole")

    def _capture_label(*args: Any, **kwargs: Any) -> LabelGrid:
        captured["kwargs"] = kwargs
        return _empty_grid()

    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[cpt_pick, borehole_pick])
    use_case = _make_use_case()

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", side_effect=_capture_label),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        await use_case.execute(uuid4(), [_section()], grid_spacing_m=1.0, force=True)

    kinds = {
        column.investigation_id: column.kind
        for column in captured["kwargs"]["investigation_columns"]
    }
    assert kinds == {"cpt-a": "cpt", "bh-b": "borehole"}


def test_the_kind_is_folded_into_the_build_checksum() -> None:
    """Re-typing an anchor must rebuild — the honored winner can change.

    Two models identical but for whether their one investigation is a cone or a
    borehole must not share a cache entry, because the kind decides which log
    survives a shared column.
    """
    as_cpt = (
        InvestigationColumn(
            investigation_id="a",
            world_x=0.0,
            world_y=0.0,
            intervals=(("b", "KLEI", 5.0, 0.0),),
            kind="cpt",
        ),
    )
    as_borehole = (
        InvestigationColumn(
            investigation_id="a",
            world_x=0.0,
            world_y=0.0,
            intervals=(("b", "KLEI", 5.0, 0.0),),
            kind="borehole",
        ),
    )

    assert _partition_checksum([_section()], 1.0, as_cpt) != _partition_checksum(
        [_section()], 1.0, as_borehole
    )


@pytest.mark.asyncio
async def test_investigations_outside_the_footprint_ride_out_on_the_outcome() -> None:
    """A build that models only part of the project must say so to the CLIENT.

    ``build_domain_from_sections`` keeps only the LARGEST alpha-shape ring, so a
    project whose investigations fall into two clusters further apart than the
    alpha distance loses the smaller cluster entirely — those columns get no
    3-D model at all. A server-side WARNING is invisible in a packaged desktop
    build, so the engineer who clicked "Build model" would see an unqualified
    success. The names have to reach the response.
    """
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)),
                uncovered_test_ids=("B#drilled", "A"),
            ),
        ),
        patch(f"{_PATH}.label_voxels", return_value=_empty_grid()),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        outcome = await BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            force=True,
        )

    # The "#drilled" suffix is an internal token of the footprint check, not
    # something the engineer ever typed — the outcome names investigations.
    assert outcome.uncovered_test_ids == ["A", "B"]


# ---------------------------------------------------------------------------
# A build that built NOTHING must say why — it also deleted the model.
#
# Every empty path funnels into ``_handle_empty``, which orphan-deletes every
# stored solid row for the model and commits.  The outcome it returns is
# indistinguishable from a happy build of zero bodies, so the renderer's only
# possible reading is "Built 0 bodies" in green — while the 3-D model the
# engineer had is gone from the database.
# ---------------------------------------------------------------------------


async def _run_empty(
    *, domain: Any, meshes: list[Any], gapless_2d: list[dict[str, Any]] | None = None
) -> Any:
    """Execute the use case with a chosen degenerate domain / mesh result."""
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    domain_patch = (
        patch(f"{_PATH}.build_domain_from_sections", side_effect=domain)
        if isinstance(domain, Exception)
        else patch(f"{_PATH}.build_domain_from_sections", return_value=domain)
    )
    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        domain_patch,
        patch(f"{_PATH}.label_voxels", return_value=_empty_grid()),
        patch(f"{_PATH}.extract_body_solids", return_value=meshes),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        return await BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            force=True,
            gapless_2d=gapless_2d,
        )


@pytest.mark.asyncio
async def test_a_build_on_investigations_that_sit_on_one_line_says_why_it_is_empty() -> None:
    """A linear-works project (road / quay alignment) cannot form a footprint.

    The engineer must be told that, not shown a zero-body result he will read as
    a build that happened.
    """
    outcome = await _run_empty(
        domain=ValueError("need at least 3 non-collinear columns"), meshes=[]
    )

    assert outcome.bodies_built == 0
    assert outcome.empty_reason is not None, "an empty build must name its cause"
    assert "one line" in outcome.empty_reason, "the cause must be said in the engineer's terms"


@pytest.mark.asyncio
async def test_a_labelling_that_produced_no_body_says_why_it_is_empty() -> None:
    """Every voxel came out void — nothing to mesh, and the stored model is cleared."""
    outcome = await _run_empty(
        domain=SimpleNamespace(
            polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
        ),
        meshes=[],
    )

    assert outcome.bodies_built == 0
    assert outcome.empty_reason is not None, "an empty build must name its cause"


@pytest.mark.asyncio
async def test_a_build_that_produced_bodies_carries_no_empty_reason() -> None:
    """The happy path stays unqualified — the marker is only for empty results."""
    mesh = SimpleNamespace(
        body_id=str(uuid4()),
        vertices=[(0.0, 0.0, 0.0)],
        triangles=[(0, 0, 0)],
    )
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", return_value=_empty_grid()),
        patch(f"{_PATH}.extract_body_solids", return_value=[mesh]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
        patch.object(BuildVoxelLithoModel, "_write_generation", new=AsyncMock()),
        patch.object(BuildVoxelLithoModel, "_mesh_rows", return_value=[{}]),
        patch.object(BuildVoxelLithoModel, "_batch_upsert", new=AsyncMock(return_value=1)),
    ):
        outcome = await BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            force=True,
        )

    assert outcome.bodies_built == 1
    assert outcome.empty_reason is None


# ---------------------------------------------------------------------------
# The seven-clause gapless gate rides out on the outcome.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_successful_build_carries_its_gapless_report_into_write_generation() -> None:
    """The assembled report is stored on the SAME generation row it describes."""
    mesh = SimpleNamespace(
        body_id=str(uuid4()),
        vertices=[(0.0, 0.0, 0.0)],
        triangles=[(0, 0, 0)],
    )
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])
    write_generation = AsyncMock()

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", return_value=_empty_grid()),
        patch(f"{_PATH}.extract_body_solids", return_value=[mesh]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
        patch.object(BuildVoxelLithoModel, "_write_generation", new=write_generation),
        patch.object(BuildVoxelLithoModel, "_mesh_rows", return_value=[{}]),
        patch.object(BuildVoxelLithoModel, "_batch_upsert", new=AsyncMock(return_value=1)),
    ):
        outcome = await BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            force=True,
            gapless_2d=[{"key": "area-conservation", "status": "pass", "entries": []}],
        )

    assert outcome.gapless_report is not None
    assert [c["key"] for c in outcome.gapless_report["clauses"]] == [
        "area-conservation",
        "edge-reach",
        "cause-closure",
        "section-closure",
        "column-totality",
        "stack-voids",
        "section-reconciliation",
    ]
    # The exact same dict object reached _write_generation — the row and the
    # returned outcome must never carry two different reports for one build.
    assert write_generation.await_args.kwargs["gapless_report"] is outcome.gapless_report


@pytest.mark.asyncio
async def test_a_build_that_produced_nothing_still_carries_a_verdict() -> None:
    """An erased model is when the engineer MOST needs to know what was checked.

    The degenerate paths clear the stored 3-D model. Returning no verdict there
    leaves the one screen the engineer lands on — the "no geotech body model
    yet" empty state — with nothing to read, in exactly the case the gapless
    guarantee has most obviously not been kept. What the renderer measured is
    still true and is reported; what needed a grid says it had none.
    """
    sent = [{"key": "area-conservation", "status": "pass", "entries": []}]

    # (a) The labelling ran but produced no body. A grid EXISTS here, so the
    #     clauses that read one are genuinely answerable and must be answered.
    no_body = await _run_empty(
        domain=SimpleNamespace(
            polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
        ),
        meshes=[],
        gapless_2d=sent,
    )
    assert no_body.bodies_built == 0
    assert no_body.gapless_report is not None, "an erased model must still say what was checked"
    by_key = {c["key"]: c for c in no_body.gapless_report["clauses"]}
    assert len(by_key) == 7, "every clause is reported, including the ones nobody could measure"
    assert by_key["area-conservation"]["status"] == "pass", "what the renderer measured survives"
    assert by_key["column-totality"]["status"] != "not-evaluated", (
        "a grid was labelled on this path, so the clause that reads one must answer"
    )

    # (b) The footprint could not be built, so no grid was ever labelled. The
    #     three clauses that need one say so — never a fabricated pass.
    no_grid = await _run_empty(
        domain=ValueError("need at least 3 non-collinear columns"),
        meshes=[],
        gapless_2d=sent,
    )
    assert no_grid.gapless_report is not None
    by_key = {c["key"]: c for c in no_grid.gapless_report["clauses"]}
    assert by_key["area-conservation"]["status"] == "pass"
    for key in ("column-totality", "stack-voids", "section-reconciliation"):
        assert by_key[key]["status"] == "not-evaluated"
        assert by_key[key]["not_evaluated_reason"]
    assert no_grid.gapless_report["verdict"] == "incomplete", (
        "nothing failed, but three guarantees went unmeasured — that is not green"
    )


@pytest.mark.asyncio
async def test_a_crash_inside_the_gate_does_not_take_the_build_down_with_it() -> None:
    """The gate fails the REPORT, never the build.

    Clause 7 is a diagnostic that reads the built model. A diagnostic that can
    destroy the artefact it measures is worse than no diagnostic: the engineer
    would lose a good model to a bug in the thing checking it. So a raise inside
    the reconciliation degrades clause 7 to "not checked", names the failure,
    and the solids are written exactly as they would have been.
    """
    mesh = SimpleNamespace(
        body_id=str(uuid4()),
        vertices=[(0.0, 0.0, 0.0)],
        triangles=[(0, 0, 0)],
    )
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", return_value=_empty_grid()),
        patch(f"{_PATH}.extract_body_solids", return_value=[mesh]),
        patch(f"{_PATH}.reconcile_sections", side_effect=ZeroDivisionError("gap width was 0")),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
        patch.object(BuildVoxelLithoModel, "_write_generation", new=AsyncMock()),
        patch.object(BuildVoxelLithoModel, "_mesh_rows", return_value=[{}]),
        patch.object(BuildVoxelLithoModel, "_batch_upsert", new=AsyncMock(return_value=1)),
    ):
        outcome = await BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            force=True,
        )

    # The build completed and the model was written.
    assert outcome.bodies_built == 1
    assert outcome.empty_reason is None
    assert outcome.gapless_report is not None
    by_key = {c["key"]: c for c in outcome.gapless_report["clauses"]}
    # Clause 7 says it could not be checked, and says why in a way that points
    # at the check rather than at the model.
    assert by_key["section-reconciliation"]["status"] == "not-evaluated"
    assert "ZeroDivisionError" in by_key["section-reconciliation"]["not_evaluated_reason"]
    # The two clauses the grid CAN still answer are unaffected by the crash.
    assert by_key["column-totality"]["status"] in ("pass", "fail")
    assert by_key["stack-voids"]["status"] in ("pass", "fail")


@pytest.mark.asyncio
async def test_the_checksum_skip_path_reports_the_3d_clauses_not_evaluated() -> None:
    """No grid is labelled here — clauses 5-7 must say so, never a fabricated pass."""
    from groundmodel.application.build_voxel_litho_model import _partition_checksum
    from groundmodel.application.litho_solid_persistence import _SolidMeta

    section = _section()
    # The default honor radius (no view-state override) is grid_spacing_m itself.
    checksum = _partition_checksum([section], 1.0, (), vertical_spacing_m=None, honor_radius_m=1.0)
    existing = {
        "body-1": _SolidMeta(body_id="body-1", source_pick_checksum=checksum, is_stale=False)
    }
    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value=existing)),
    ):
        outcome = await _make_use_case().execute(
            uuid4(),
            [section],
            grid_spacing_m=1.0,
            force=False,
            gapless_2d=[{"key": "area-conservation", "status": "pass", "entries": []}],
        )

    assert outcome.bodies_skipped_checksum == 1
    assert outcome.gapless_report is not None
    three_d = {
        c["key"]: c
        for c in outcome.gapless_report["clauses"]
        if c["key"] in {"column-totality", "stack-voids", "section-reconciliation"}
    }
    assert len(three_d) == 3
    for clause in three_d.values():
        assert clause["status"] == "not-evaluated"
        assert "no voxel grid was labelled" in clause["not_evaluated_reason"]


# ---------------------------------------------------------------------------
# The app stays usable while a build runs.
#
# The desktop app runs exactly ONE uvicorn worker, and the build's two CPU
# phases were plain synchronous calls inside an ``async def`` route — so every
# other request the engineer made during a build (drag a contact, accept a
# suggestion, Ctrl+S) queued behind the whole build on the single event loop.
# The app appeared hung: no spinner, no error, edits that just did nothing.
# Measured heartbeat counts and the phase split: docs/benchmarks-journal.md →
# "Build responsiveness (2026-08-03)".
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_another_request_is_served_while_the_labelling_runs() -> None:
    """A request arriving mid-build gets a turn instead of queueing behind it."""
    labelling_started = threading.Event()
    other_request_served = threading.Event()

    def _label_until_the_loop_answers(*_args: Any, **_kwargs: Any) -> LabelGrid:
        labelling_started.set()
        assert other_request_served.wait(timeout=5.0), (
            "the event loop never got a turn while the build was labelling — "
            "the whole app is frozen for the duration of a build"
        )
        return _empty_grid()

    async def _another_api_request() -> None:
        """Anything else the engineer does during the build."""
        while not labelling_started.is_set():
            await asyncio.sleep(0.005)
        other_request_served.set()

    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", side_effect=_label_until_the_loop_answers),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        await asyncio.gather(
            BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
                uuid4(), [_section()], grid_spacing_m=1.0, force=True
            ),
            _another_api_request(),
        )

    assert other_request_served.is_set()


# ---------------------------------------------------------------------------
# One build at a time.
#
# ``voxel_grid_budget.MAX_VOXEL_CELLS`` is sized on the peak memory of ONE
# build. Once the two CPU phases moved off the event loop, the loop stopped
# being the thing that serialised them: an engineer who double-clicks Build, or
# builds the litho model and then the geotech model, could run two of them in
# the default thread pool at once and double a budget nothing re-checks.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_second_build_waits_instead_of_labelling_alongside_the_first() -> None:
    """Two builds started together never hold the grid budget at the same time."""
    counter_lock = threading.Lock()
    in_flight = 0
    peak_in_flight = 0

    def _label_slowly(*_args: Any, **_kwargs: Any) -> LabelGrid:
        nonlocal in_flight, peak_in_flight
        with counter_lock:
            in_flight += 1
            peak_in_flight = max(peak_in_flight, in_flight)
        # Long enough that a second build with no lock would overlap this one.
        time.sleep(0.05)
        with counter_lock:
            in_flight -= 1
        return _empty_grid()

    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])

    with (
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.load_project_view_state", new=AsyncMock(return_value={})),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(
                polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0)), uncovered_test_ids=()
            ),
        ),
        patch(f"{_PATH}.label_voxels", side_effect=_label_slowly),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch(f"{_PATH}.reconcile_sections", return_value=()),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
        patch.object(
            BuildVoxelLithoModel, "_packing_class_key", new=AsyncMock(return_value=lambda f: f)
        ),
    ):
        await asyncio.gather(
            BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
                uuid4(), [_section()], grid_spacing_m=1.0, force=True
            ),
            BuildVoxelLithoModel(cast(Any, AsyncMock())).execute(
                uuid4(), [_section()], grid_spacing_m=1.0, force=True
            ),
        )

    assert peak_in_flight == 1
