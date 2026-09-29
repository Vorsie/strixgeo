"""Unit tests for ImportBoreholeFile — a local DOV borehole XML file into a project.

The rules, in the owner's and CLAUDE.md's words:

* every boring of the file becomes its own borehole, with ALL its
  interpretations, in ONE commit per file;
* "Re-importing should refresh existing records, not skip them" — but the
  overwrite is irreversible, so it is CONSENTED (the CPT rule): without
  ``confirm_refresh`` a duplicate answers with the old-vs-new diff and NOTHING
  is written; with it the SAME borehole id is refreshed in place and a manual
  elevation is kept;
* "a broken file must never overwrite good data" — a boring whose fresh parse
  carries errors is refused even when confirmed.

The DB is mocked (the repository + the refresh loader); the parser is real and
reads the owner's fixture files.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.import_borehole_file import ImportBoreholeFile
from groundmodel.application.stale_investigation_caches import StaleCacheCounts
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.exceptions import (
    BoreholeRefreshConfirmationRequiredError,
    BoreholeRefreshRefusedError,
)

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "dov_boring_files"
TODAY = date(2026, 9, 28)
PROJECT = uuid4()
B1_TEST_ID = "1411-BORGEO2600011-21-04-2026-B1"


def _use_case(existing: dict[str, BoreholeOrm] | None = None) -> ImportBoreholeFile:
    """ImportBoreholeFile with a mocked session, repository and refresh loader."""
    session = MagicMock()
    session.commit = AsyncMock()
    session.add = MagicMock()
    uc = ImportBoreholeFile(session)
    existing = existing or {}
    uc._repo.find_existing_test_ids = AsyncMock(  # type: ignore[method-assign]
        return_value={tid: orm.id for tid, orm in existing.items()}
    )
    uc._repo.save = AsyncMock()  # type: ignore[method-assign]
    uc._load_existing = AsyncMock(  # type: ignore[method-assign]
        return_value={orm.id: orm for orm in existing.values()}
    )
    return uc


def _stored_b1(*, elevation_source: str = ElevationSource.DOV.value) -> BoreholeOrm:
    """A B1 already in the project: an older 10 m description, one old segment."""
    orm = BoreholeOrm(
        id=uuid4(),
        name="1411-BORGEO2600011-21-04-2026-B1",
        app_project_id=PROJECT,
        project_id="DOV",
        test_id=B1_TEST_ID,
        location_x=136014.22,
        location_y=205977.40,
        elevation_m=30.0,
        elevation_source=elevation_source,
        epsg=31370,
        z_epsg=5710,
        total_depth_m=10.0,
        drill_method="Meerdere technieken",
    )
    orm.drill_segments = [DrillSegmentOrm(id=uuid4(), top_m=0.0, base_m=10.0, method="spade")]
    orm.field_log_intervals = []
    orm.samples = []
    orm.observations = [
        ObservationOrm(
            id=uuid4(),
            borehole_id=orm.id,
            dov_permkey="2026-410970",  # same permkey as the file's description
            observation_type="lithological_description",
            layers=[
                ObservationLayerOrm(id=uuid4(), top_m=0.0, base_m=10.0, layer_index=0),
            ],
        ),
        ObservationOrm(
            id=uuid4(),
            borehole_id=orm.id,
            dov_permkey="2020-000001",  # a coded lithology the file does not carry
            observation_type="coded_lithology",
            layers=[ObservationLayerOrm(id=uuid4(), top_m=0.0, base_m=10.0, layer_index=0)],
        ),
    ]
    return orm


async def _run(uc: ImportBoreholeFile, filename: str, *, confirm: bool = False):
    """Run the use case on a fixture file with no stale-cache DB work."""
    with patch("groundmodel.application.import_borehole_file.StaleInvestigationCaches") as stale:
        stale.return_value.execute = AsyncMock(return_value=StaleCacheCounts(0, 0, 0))
        return await uc.execute(FIXTURES / filename, PROJECT, confirm_refresh=confirm, today=TODAY)


# ---------------------------------------------------------------------------
# New borings
# ---------------------------------------------------------------------------


async def test_a_new_boring_is_saved_with_every_interpretation_in_one_commit():
    """B1 is new: one borehole saved, its 2 interpretations attached to it, one commit."""
    uc = _use_case()
    result = await _run(uc, "GEO-25-110-B1onbewerkt.xml")

    assert uc._repo.save.await_count == 1
    saved: BoreholeOrm = uc._repo.save.await_args.args[0]
    assert saved.name == "GEO-25/110-B1"
    assert saved.test_id == B1_TEST_ID
    assert saved.project_id == "DOV"
    assert saved.app_project_id == PROJECT
    assert saved.elevation_m == pytest.approx(27.47)
    added = [c.args[0] for c in uc._session.add.call_args_list]
    observations = [a for a in added if isinstance(a, ObservationOrm)]
    assert sorted(o.observation_type for o in observations) == [
        "informal_stratigraphy",
        "lithological_description",
    ]
    assert {o.borehole_id for o in observations} == {saved.id}
    assert {o.dov_permkey for o in observations} == {"2026-410960", "2026-410970"}
    uc._session.commit.assert_awaited_once()

    [boring] = result.boreholes
    assert boring.borehole_id == saved.id
    assert boring.name == "GEO-25/110-B1"
    assert boring.refreshed is False
    assert boring.imported is True
    assert {i.code for i in boring.issues} >= {"NAME_FROM_ALTERNATIVE"}


async def test_a_file_with_four_borings_saves_four_boreholes_in_one_commit():
    """GEO-25-121 → B3..B6, four saves, still ONE commit for the file."""
    uc = _use_case()
    result = await _run(uc, "GEO-25-121-B3-B4-B5-B6-onbewerkt.xml")
    assert uc._repo.save.await_count == 4
    assert sorted(b.name for b in result.boreholes) == [
        "GEO-25/121-B3",
        "GEO-25/121-B4",
        "GEO-25/121-B5",
        "GEO-25/121-B6",
    ]
    uc._session.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# Duplicates — consented refresh
# ---------------------------------------------------------------------------


async def test_a_duplicate_without_consent_answers_the_diff_and_writes_nothing():
    """Re-import without confirm_refresh → the old-vs-new diff, no save, no add, no commit."""
    stored = _stored_b1()
    uc = _use_case({B1_TEST_ID: stored})
    with pytest.raises(BoreholeRefreshConfirmationRequiredError) as exc:
        await _run(uc, "GEO-25-110-B1onbewerkt.xml")

    [diff] = exc.value.diffs
    assert diff["borehole_id"] == str(stored.id)
    assert diff["name"] == "GEO-25/110-B1"
    assert diff["old_total_depth_m"] == 10.0
    assert diff["new_total_depth_m"] == 35.0
    assert diff["old_n_litho_layers"] == 1
    assert diff["new_n_litho_layers"] == 70
    uc._repo.save.assert_not_awaited()
    uc._session.add.assert_not_called()
    uc._session.commit.assert_not_awaited()
    assert stored.total_depth_m == 10.0  # untouched


async def test_a_confirmed_duplicate_is_refreshed_in_place_keeping_its_id():
    """With consent: same borehole id, children replaced from the file, one commit."""
    stored = _stored_b1()
    old_id = stored.id
    old_description_id = stored.observations[0].id
    uc = _use_case({B1_TEST_ID: stored})

    result = await _run(uc, "GEO-25-110-B1onbewerkt.xml", confirm=True)

    [boring] = result.boreholes
    assert boring.refreshed is True
    assert boring.borehole_id == old_id
    assert stored.id == old_id
    assert stored.name == "GEO-25/110-B1"
    assert stored.total_depth_m == 35.0
    assert stored.elevation_m == pytest.approx(27.47)
    assert len(stored.drill_segments) == 6
    assert stored.n_drill_segments == 6
    assert len(stored.field_log_intervals) > 0
    # The description with the same permkey keeps its id (provenance links on
    # accepted contacts survive) and takes the file's 70 layers.
    by_permkey = {o.dov_permkey: o for o in stored.observations}
    assert by_permkey["2026-410970"].id == old_description_id
    assert len(by_permkey["2026-410970"].layers) == 70
    # The file's stratigraphy is new → attached; the coded lithology the file
    # does not carry stays (the file is not the whole DOV record).
    assert "2026-410960" in by_permkey
    assert "2020-000001" in by_permkey
    # The WFS-only summary the file does not carry is kept, not blanked.
    assert stored.drill_method == "Meerdere technieken"
    uc._repo.save.assert_not_awaited()
    uc._session.commit.assert_awaited_once()


async def test_a_refresh_keeps_a_manual_elevation():
    """A manual collar edit outranks the file (ElevationSource.MANUAL)."""
    stored = _stored_b1(elevation_source=ElevationSource.MANUAL.value)
    uc = _use_case({B1_TEST_ID: stored})
    await _run(uc, "GEO-25-110-B1onbewerkt.xml", confirm=True)
    assert stored.elevation_m == 30.0
    assert stored.elevation_source == ElevationSource.MANUAL.value


async def test_a_boring_with_parse_errors_never_overwrites_even_when_confirmed(tmp_path):
    """A duplicate whose fresh parse has no coordinates (ERROR) is refused, nothing written."""
    broken = (FIXTURES / "GEO-25-110-B1onbewerkt.xml").read_bytes()
    broken = broken.replace(b"<gml:pos>136014.22 205977.40 27.47</gml:pos>", b"<gml:pos></gml:pos>")
    path = tmp_path / "broken.xml"
    path.write_bytes(broken)
    stored = _stored_b1()
    uc = _use_case({B1_TEST_ID: stored})
    with (
        patch("groundmodel.application.import_borehole_file.StaleInvestigationCaches"),
        pytest.raises(BoreholeRefreshRefusedError),
    ):
        await uc.execute(path, PROJECT, confirm_refresh=True, today=TODAY)
    uc._session.commit.assert_not_awaited()
    assert stored.total_depth_m == 10.0


async def test_a_new_boring_without_coordinates_is_skipped_and_the_rest_imports(tmp_path):
    """A NEW boring with no usable position is not persisted (flagged), its siblings are."""
    doc = (FIXTURES / "GEO-25-121-B3-B4-B5-B6-onbewerkt.xml").read_bytes()
    doc = doc.replace(b"<gml:pos>69067.91 206379.75 5.56</gml:pos>", b"<gml:pos></gml:pos>", 1)
    path = tmp_path / "one_broken.xml"
    path.write_bytes(doc)
    uc = _use_case()
    with patch("groundmodel.application.import_borehole_file.StaleInvestigationCaches"):
        result = await uc.execute(path, PROJECT, today=TODAY)
    skipped = [b for b in result.boreholes if not b.imported]
    assert [b.name for b in skipped] == ["GEO-25/121-B4"]
    assert skipped[0].borehole_id is None
    assert "NOT_IMPORTED" in {i.code for i in skipped[0].issues}
    assert uc._repo.save.await_count == 3
    uc._session.commit.assert_awaited_once()
