"""Integration tests for ImportCpt — full parse → store → retrieve cycle.

Requires:
- ``data/cpt/`` directory with the 5 DOV GEF files (gitignored)
- Docker DB running on localhost:5433  (``docker compose up -d``)

Both conditions are checked at collection time; the module is skipped if either
is absent.

Files under test
----------------
1778054387093.gef  CPTE (TE1) — dual depth/length cols, negative fs in top rows
1778056765226.gef  CPTU (TE2) — pre-drill 1.5 m, void u2 in top rows
1778056769825.gef  CPTM (TM4) — 34 rows only
1778056773736.gef  CPTM (TM1) — 1316 rows, zero-qc gap at 25.92–26.08 m
1778056778310.gef  CPTM (TM2) — pre-drill 2.2 m, hybrid electric/mechanical
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.shared.exceptions import DuplicateCptError

DATA_DIR = Path(__file__).parents[3] / "data" / "cpt"

pytestmark = pytest.mark.skipif(
    not DATA_DIR.exists(),
    reason="DOV data files not present (data/cpt/ is gitignored)",
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ALL_FILES = [
    "1778054387093.gef",
    "1778056765226.gef",
    "1778056769825.gef",
    "1778056773736.gef",
    "1778056778310.gef",
]


# ---------------------------------------------------------------------------
# Smoke — every file imports without raising and returns a UUID
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_import_returns_uuid(filename: str, db_session: AsyncSession) -> None:
    """Every supported file imports without raising and returns a UUID."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    assert isinstance(result.cpt_id, UUID)


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_import_has_no_errors(filename: str, db_session: AsyncSession) -> None:
    """No ERROR-level validation issues for any of the five reference DOV files."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    error_codes = {i.code for i in result.issues if i.level == "error"}
    assert not error_codes, f"Unexpected errors in {filename}: {error_codes}"


# ---------------------------------------------------------------------------
# Persistence — CPT and series are retrievable after commit
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_cpt_is_retrievable_by_id(filename: str, db_session: AsyncSession) -> None:
    """Imported CPT can be retrieved from the DB by its UUID."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.id == result.cpt_id


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_series_is_loaded_with_cpt(filename: str, db_session: AsyncSession) -> None:
    """Depth series is eagerly loaded alongside the CPT metadata."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.series is not None
    assert len(cpt.series.depths_m) > 0


# ---------------------------------------------------------------------------
# Summary stats match parser output
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_n_rows_matches_parser(filename: str, db_session: AsyncSession) -> None:
    """Row count stored in the DB matches the parser's output for every file."""
    file_path = DATA_DIR / filename
    parsed = GEFParser().parse_bytes(file_path.read_bytes())
    result = await ImportCpt(db_session).execute(file_path)

    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.n_rows == len(parsed.data)


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_max_depth_matches_parser(filename: str, db_session: AsyncSession) -> None:
    """max_depth_m stored in the DB matches the deepest depth value from the parser."""
    file_path = DATA_DIR / filename
    parsed = GEFParser().parse_bytes(file_path.read_bytes())
    result = await ImportCpt(db_session).execute(file_path)

    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.max_depth_m == pytest.approx(float(parsed.data["depth_m"].max()), rel=1e-6)


# ---------------------------------------------------------------------------
# CPT type is stored correctly
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "filename,expected_type",
    [
        ("1778054387093.gef", "CPTE"),
        ("1778056765226.gef", "CPTU"),
        ("1778056769825.gef", "CPTM"),
        ("1778056773736.gef", "CPTM"),
        ("1778056778310.gef", "CPTM"),
    ],
)
async def test_cpt_type(filename: str, expected_type: str, db_session: AsyncSession) -> None:
    """CPT type detected by the parser is persisted correctly."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.cpt_type == expected_type


# ---------------------------------------------------------------------------
# Series columns — present/absent by CPT type
# ---------------------------------------------------------------------------


async def test_cpte_has_fs_no_u2(db_session: AsyncSession) -> None:
    """CPTE: electric cone — friction yes, pore pressure no."""
    result = await ImportCpt(db_session).execute(DATA_DIR / "1778054387093.gef")
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.series.fs_mpa is not None and len(cpt.series.fs_mpa) > 0
    assert cpt.series.u2_mpa is None


async def test_cptu_has_fs_and_u2(db_session: AsyncSession) -> None:
    """CPTU: piezocone — friction and pore pressure both present."""
    result = await ImportCpt(db_session).execute(DATA_DIR / "1778056765226.gef")
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.series.fs_mpa is not None and len(cpt.series.fs_mpa) > 0
    assert cpt.series.u2_mpa is not None and len(cpt.series.u2_mpa) > 0


@pytest.mark.parametrize(
    "filename",
    [
        "1778056769825.gef",
        "1778056773736.gef",
        "1778056778310.gef",
    ],
)
async def test_cptm_has_no_fs_no_u2(filename: str, db_session: AsyncSession) -> None:
    """CPTM: mechanical cone — qc only, no friction sleeve or pore pressure."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.series.fs_mpa is None
    assert cpt.series.u2_mpa is None


# ---------------------------------------------------------------------------
# PostGIS point — populated because all DOV files carry EPSG 32000
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename", ALL_FILES)
async def test_location_point_is_stored(filename: str, db_session: AsyncSession) -> None:
    """PostGIS geometry point is populated for every DOV file (all carry EPSG 32000)."""
    result = await ImportCpt(db_session).execute(DATA_DIR / filename)
    repo = CptRepository(db_session)
    cpt = await repo.get_by_id(result.cpt_id)
    assert cpt is not None
    assert cpt.location is not None


# ---------------------------------------------------------------------------
# Duplicate detection — same file within a project raises; different projects allowed
# ---------------------------------------------------------------------------


async def test_same_file_same_project_raises_duplicate(db_session: AsyncSession) -> None:
    """Importing the same GEF file into the same project raises DuplicateCptError."""
    file_path = DATA_DIR / "1778056769825.gef"  # TM4 — tiny file, fast
    project_id = uuid7()
    await ImportCpt(db_session).execute(file_path, project_id)
    with pytest.raises(DuplicateCptError):
        await ImportCpt(db_session).execute(file_path, project_id)


async def test_same_file_different_projects_creates_two_rows(db_session: AsyncSession) -> None:
    """The same GEF file imported into two different projects creates two distinct CPTs."""
    file_path = DATA_DIR / "1778056769825.gef"  # TM4 — tiny file, fast
    r1 = await ImportCpt(db_session).execute(file_path, uuid7())
    r2 = await ImportCpt(db_session).execute(file_path, uuid7())
    assert r1.cpt_id != r2.cpt_id
    repo = CptRepository(db_session)
    assert len(await repo.list_all()) == 2
