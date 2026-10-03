"""Unit tests for the packing-class key loader (debt #278).

The loader is the single application-layer wiring that reads a project's
``geological_formation`` rows and hands the pure domain builder plain triples.
Both the body recompute and the 3-D voxel build depend on it, and the build's
``_packing_class_key`` adds the model → project lookup (plus the
model-row-gone → identity branch) on top. These tests exercise that wiring with
a mocked session, so the SQL projection is covered without a database.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel
from groundmodel.application.packing_class_key_loader import load_packing_class_key


def _result_with_rows(rows: list[SimpleNamespace]) -> MagicMock:
    """A stub SQLAlchemy result whose ``.all()`` returns ``rows``."""
    result = MagicMock()
    result.all.return_value = rows
    return result


@pytest.mark.asyncio
async def test_load_packing_class_key_projects_rows_to_class_keys() -> None:
    """Both-halves rows key on ``SOIL|CLASS``; a missing half keeps its row id."""
    f1, f2, f3, f4, f5 = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()
    u_zand, u_slm = uuid4(), uuid4()
    rows = [
        SimpleNamespace(
            id=f1, nad_class=6, litho_main_soil_code="ZAND", source_litho_formation_id=None
        ),
        SimpleNamespace(
            id=f2, nad_class=6, litho_main_soil_code="ZAND", source_litho_formation_id=None
        ),
        SimpleNamespace(
            id=f3, nad_class=None, litho_main_soil_code="ZAND", source_litho_formation_id=None
        ),
        SimpleNamespace(
            id=f4, nad_class=6, litho_main_soil_code="ZAND", source_litho_formation_id=u_zand
        ),
        SimpleNamespace(
            id=f5, nad_class=6, litho_main_soil_code="ZAND", source_litho_formation_id=u_slm
        ),
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=_result_with_rows(rows))

    key = await load_packing_class_key(session, uuid4())

    assert key(str(f1)) == "ZAND|6"
    assert key(str(f1)) == key(str(f2)), "twin-class rows share one key"
    assert key(str(f3)) == str(f3), "a skeleton band keeps its row identity"
    assert key("not-a-known-row") == "not-a-known-row"
    # Owner 2026-10-03: two litho units (ZAND, ZAND (SL:M)) never share a key.
    assert key(str(f4)) == f"{u_zand}|ZAND|6"
    assert key(str(f4)) != key(str(f5))


@pytest.mark.asyncio
async def test_load_packing_class_key_on_no_formations_is_the_identity() -> None:
    """A project with no geotech formations yields the identity function."""
    session = MagicMock()
    session.execute = AsyncMock(return_value=_result_with_rows([]))

    key = await load_packing_class_key(session, uuid4())

    assert key("anything") == "anything"


@pytest.mark.asyncio
async def test_build_packing_class_key_delegates_when_the_project_resolves() -> None:
    """_packing_class_key finds the project, then delegates to the loader."""
    project_id, f1 = uuid4(), uuid4()
    model_result = MagicMock()
    model_result.scalar_one_or_none.return_value = project_id
    formation_result = _result_with_rows(
        [
            SimpleNamespace(
                id=f1, nad_class=8, litho_main_soil_code="KLEI", source_litho_formation_id=None
            )
        ]
    )
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[model_result, formation_result])

    key = await BuildVoxelLithoModel(session)._packing_class_key(uuid4())

    assert key(str(f1)) == "KLEI|8"


@pytest.mark.asyncio
async def test_build_packing_class_key_is_identity_when_the_model_row_is_gone() -> None:
    """A model deleted mid-build degrades to the row-keyed merge, never raises."""
    model_result = MagicMock()
    model_result.scalar_one_or_none.return_value = None
    session = MagicMock()
    session.execute = AsyncMock(return_value=model_result)

    key = await BuildVoxelLithoModel(session)._packing_class_key(uuid4())

    assert key("anything") == "anything"
