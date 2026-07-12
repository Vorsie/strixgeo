"""Unit tests for ``BuildVoxelLithoModel`` — the geo-surface wiring (Task 2).

These tests pin the Task-2 contract WITHOUT a database: the use case must read
the litho model's parent geological model id, load that model's built band
surfaces via the shared
:func:`~groundmodel.application.load_geo_surfaces.load_geo_surfaces` helper, read
the project's ``litho_snap_tolerance_m`` view-state knob, and pass BOTH through
to :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`.

The collaborators that would otherwise need real data (domain build, picks load,
the labeller, the mesher, the persistence) are patched; the assertions read the
keyword arguments ``label_voxels`` actually received.  Phrased in the task's own
vocabulary ("the loaded parent surfaces reach the labeller", "no parent model →
un-bounded ``()`` + a warning") rather than implementation-variable terms.
"""

from __future__ import annotations

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
from groundmodel.domain.services.surface_bound import SurfaceBound
from groundmodel.domain.services.voxel_litho.voxel_types import (
    LabelGrid,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
from groundmodel.domain.value_objects.tin_surface import TinSurface

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


def _surface() -> SurfaceBound:
    """A trivial flat geological band surface as a ``SurfaceBound``."""
    tin = TinSurface(
        vertices=[(0.0, 0.0, 3.0), (10.0, 0.0, 3.0), (5.0, 10.0, 3.0)],
        triangles=[(0, 1, 2)],
    )
    return SurfaceBound.from_tin(tin)


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


def _make_use_case(*, parent_id: Any) -> BuildVoxelLithoModel:
    """A ``BuildVoxelLithoModel`` whose session answers the two Task-2 DB reads.

    ``session.execute`` returns a result whose ``scalar_one_or_none`` is the
    parent geological model id (mirrors ``_read_parent_geo_model_id``).  The
    ``litho_snap_tolerance_m`` knob is injected via the project ``view_state`` in
    :func:`_run`, not here.
    """
    session = AsyncMock()
    session.commit = AsyncMock()

    # _read_parent_geo_model_id: select(...).scalar_one_or_none() → parent id.
    exec_result = SimpleNamespace(scalar_one_or_none=lambda: parent_id)
    session.execute = AsyncMock(return_value=exec_result)

    # _read_*_tolerance: session.get(GeologicalModelOrm, id) → model with project id.
    model = SimpleNamespace(app_project_id=uuid4())
    session.get = AsyncMock(return_value=model)

    use_case = BuildVoxelLithoModel(cast(Any, session))
    return use_case


async def _run(
    use_case: BuildVoxelLithoModel,
    captured: dict[str, Any],
    *,
    parent_id: Any,
    surfaces: tuple[SurfaceBound, ...],
    snap_tol: float | None,
    vertical_spacing_m: float | None = None,
) -> None:
    """Execute the use case with every heavy collaborator patched.

    Records the kwargs ``label_voxels`` was called with into ``captured`` so the
    test can assert on the geo-surface + tolerance pass-through.  When
    ``vertical_spacing_m`` is set, it is forwarded to ``execute`` so the
    anisotropy pass-through can be asserted.
    """
    view_state = {"litho_segmenter": {"litho_snap_tolerance_m": snap_tol}} if snap_tol else {}
    project = SimpleNamespace(view_state=view_state)

    def _capture_label(*args: Any, **kwargs: Any) -> LabelGrid:
        captured["args"] = args
        captured["kwargs"] = kwargs
        return _empty_grid()

    repo = AsyncMock()
    repo.load_body_picks = AsyncMock(return_value=[])
    proj_repo = AsyncMock()
    proj_repo.get_by_id = AsyncMock(return_value=project)

    with (
        patch(f"{_PATH}.load_geo_surfaces", new=AsyncMock(return_value=surfaces)) as load_mock,
        patch(f"{_PATH}.LithoLayerRepository", return_value=repo),
        patch(f"{_PATH}.ProjectRepository", return_value=proj_repo),
        patch(
            f"{_PATH}.build_domain_from_sections",
            return_value=SimpleNamespace(polygon=((0.0, 0.0), (10.0, 0.0), (5.0, 10.0))),
        ),
        patch(f"{_PATH}.label_voxels", side_effect=_capture_label),
        patch(f"{_PATH}.extract_body_solids", return_value=[]),
        patch.object(BuildVoxelLithoModel, "_load_existing", new=AsyncMock(return_value={})),
        patch.object(BuildVoxelLithoModel, "_delete_orphans", new=AsyncMock(return_value=0)),
    ):
        await use_case.execute(
            uuid4(),
            [_section()],
            grid_spacing_m=1.0,
            vertical_spacing_m=vertical_spacing_m,
            force=True,
        )
        captured["load_mock"] = load_mock


@pytest.mark.asyncio
async def test_loaded_parent_surfaces_and_tolerance_reach_label_voxels() -> None:
    """The use case loads the parent geo surfaces and passes them + the tolerance.

    With a parent geological model id set and a built band surface, the loaded
    ``geo_surfaces`` tuple must reach ``label_voxels`` together with the
    project's configured ``litho_snap_tolerance_m`` (0.35 m here).
    """
    parent_id = uuid4()
    surfaces = (_surface(),)
    captured: dict[str, Any] = {}
    use_case = _make_use_case(parent_id=parent_id)

    await _run(use_case, captured, parent_id=parent_id, surfaces=surfaces, snap_tol=0.35)

    # load_geo_surfaces was called with the parent id read from the model.
    load_mock = captured["load_mock"]
    assert load_mock.await_count == 1
    call_args = load_mock.await_args
    assert parent_id in call_args.args or parent_id in call_args.kwargs.values()

    # The loaded surfaces + tolerance reached label_voxels.
    kwargs = captured["kwargs"]
    assert kwargs["geo_surfaces"] == surfaces
    assert kwargs["litho_snap_tolerance_m"] == pytest.approx(0.35)


@pytest.mark.asyncio
async def test_no_parent_model_builds_unbounded_with_default_tolerance() -> None:
    """No parent geological model → un-bounded ``()`` surfaces + default tolerance.

    When the litho model has no parent id, the loader is never called and
    ``label_voxels`` receives the empty surfaces tuple (un-bounded build) and the
    0.20 m default snap tolerance.
    """
    captured: dict[str, Any] = {}
    use_case = _make_use_case(parent_id=None)

    await _run(use_case, captured, parent_id=None, surfaces=(), snap_tol=None)

    load_mock = captured["load_mock"]
    assert load_mock.await_count == 0  # no parent → loader skipped

    kwargs = captured["kwargs"]
    assert kwargs["geo_surfaces"] == ()
    assert kwargs["litho_snap_tolerance_m"] == pytest.approx(0.20)


@pytest.mark.asyncio
async def test_parent_with_no_built_surfaces_builds_unbounded() -> None:
    """A parent id but no built surfaces → un-bounded ``()`` (loader returns empty)."""
    parent_id = uuid4()
    captured: dict[str, Any] = {}
    use_case = _make_use_case(parent_id=parent_id)

    await _run(use_case, captured, parent_id=parent_id, surfaces=(), snap_tol=0.20)

    # The loader WAS called (parent id set) but returned no surfaces → un-bounded.
    assert captured["load_mock"].await_count == 1
    assert captured["kwargs"]["geo_surfaces"] == ()


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
    parent_id = uuid4()
    captured: dict[str, Any] = {}
    use_case = _make_use_case(parent_id=parent_id)

    await _run(
        use_case,
        captured,
        parent_id=parent_id,
        surfaces=(),
        snap_tol=0.20,
        vertical_spacing_m=0.5,
    )

    assert captured["kwargs"]["vertical_spacing_m"] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_cubic_default_passes_no_vertical_spacing_to_label_voxels() -> None:
    """No vertical spacing → the labeller receives ``vertical_spacing_m=None`` (cubic).

    The cubic default must stay byte-identical: omitting the vertical spacing
    forwards ``None``, so the labeller builds Z at ``grid_spacing_m`` exactly as
    before anisotropy existed.
    """
    parent_id = uuid4()
    captured: dict[str, Any] = {}
    use_case = _make_use_case(parent_id=parent_id)

    await _run(use_case, captured, parent_id=parent_id, surfaces=(), snap_tol=0.20)

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
