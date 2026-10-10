"""ImportBoreholePdf: the ticked boreholes of a triaged borehole-log report into a project.

The rules, in the brief's and the owner's words (2026-10-08 rulings, 2026-10-10
phase 2):

* the chosen boreholes go through "the SAME persistence as ImportBoreholeFile
  uses for a DOV XML borehole": header, the description track with the
  description VERBATIM (no codes: "the user codes it there"), samples with the
  id verbatim + ``sample_label``, the water level, a provenance JSON on the
  borehole stamped ``pdf-digitised``;
* ruling 3/4: an assumed CRS or water unit is "never silent": the import
  REFUSES (422) a borehole whose ``CRS_ASSUMED`` / ``WATER_UNIT_ASSUMED``
  finding was not confirmed; a confirmation is "this test", "every test of the
  report" or "another CRS from a list";
* ruling 5: a differing repeat print is never merged: "the user chooses which
  to withhold", so two prints of one borehole in one import are refused;
* the consented-refresh rule of the XML import: a borehole already in the
  project answers with the diff and NOTHING is written; with
  ``confirm_refresh`` the SAME borehole id is refreshed, a manual elevation and
  a track the engineer edited by hand are kept.

The DB is mocked (repository + refresh loader); the triage and the parse are
real, on the parser tests' synthetic reports.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pymupdf
import pytest

from groundmodel.application.borehole_pdf_import_request import BoreholePdfImportRequest
from groundmodel.application.import_borehole_pdf import ImportBoreholePdf
from groundmodel.application.stale_investigation_caches import StaleCacheCounts
from groundmodel.application.triage_borehole_pdf_report import TriageBoreholePdfReport
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.exceptions import (
    BoreholePdfImportRefusedError,
    BoreholeRefreshConfirmationRequiredError,
    CptPdfReportNotFoundError,
)

from ..infrastructure.parsers.borehole.pdf import _synthetic_borehole_pdf as synth

PROJECT = uuid4()
B_T1 = "B-T1@p1"
B_T2 = "B-T2@p1"


def _triaged(tmp_path: Path, doc: pymupdf.Document) -> tuple[PdfReportStore, str]:
    """Store ``doc`` and triage it; return the store and the report sha."""
    store = PdfReportStore(tmp_path)
    data = bytes(doc.tobytes())
    sha = hashlib.sha256(data).hexdigest()
    spooled = store.project_dir(PROJECT) / "upload.part"
    spooled.parent.mkdir(parents=True, exist_ok=True)
    spooled.write_bytes(data)
    store.put_file(PROJECT, sha, spooled)
    TriageBoreholePdfReport(store, lambda: BoreholePdfTriager(ocr=None)).run(
        PROJECT, sha, "report.pdf"
    )
    return store, sha


def _use_case(
    store: PdfReportStore, existing: list[BoreholeOrm] | None = None
) -> ImportBoreholePdf:
    """ImportBoreholePdf with a mocked session, repository and refresh loader."""
    session = MagicMock()
    session.commit = AsyncMock()
    session.add = MagicMock()
    uc = ImportBoreholePdf(session, store)
    existing = existing or []
    uc._repo.find_existing_test_ids = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda project_id, test_ids, app_project_id=None: {
            orm.test_id: orm.id
            for orm in existing
            if orm.project_id == project_id and orm.test_id in test_ids
        }
    )
    uc._repo.save = AsyncMock()  # type: ignore[method-assign]
    uc._load_existing = AsyncMock(  # type: ignore[method-assign]
        return_value={orm.id: orm for orm in existing}
    )
    return uc


async def _run(uc: ImportBoreholePdf, sha: str, requests, *, confirm: bool = False):
    """Run the use case with no stale-cache DB work."""
    with patch("groundmodel.application.import_borehole_pdf.StaleInvestigationCaches") as stale:
        stale.return_value.execute = AsyncMock(return_value=StaleCacheCounts(0, 0, 0))
        return await uc.execute(PROJECT, sha, requests, confirm_refresh=confirm)


def _added(uc: ImportBoreholePdf, kind: type) -> list:
    """Every row of ``kind`` the use case handed to ``session.add``."""
    return [c.args[0] for c in uc._session.add.call_args_list if isinstance(c.args[0], kind)]


# ---------------------------------------------------------------------------
# A new borehole
# ---------------------------------------------------------------------------


async def test_a_new_borehole_is_stored_with_its_header_description_track_samples_and_water(
    tmp_path,
):
    """B-T1: header as printed, seven layers VERBATIM and uncoded, two samples, water 2.00 m."""
    store, sha = _triaged(tmp_path, synth.build_boorstaat_pdf())
    uc = _use_case(store)

    result = await _run(uc, sha, [BoreholePdfImportRequest(key=B_T1)])

    saved: BoreholeOrm = uc._repo.save.await_args.args[0]
    assert saved.name == "B-T1"
    assert saved.test_id == "B-T1"
    assert saved.project_id == "00.00-000 TEST-001"
    assert saved.app_project_id == PROJECT
    assert (saved.location_x, saved.location_y, saved.epsg) == (68000.5, 224000.25, 31370)
    assert saved.elevation_m == pytest.approx(6.5)
    assert saved.z_epsg == 5710
    assert saved.elevation_source == ElevationSource.PDF.value
    assert saved.water_table_depth_m == pytest.approx(2.0)
    assert saved.total_depth_m == pytest.approx(7.28)
    assert saved.executor == "Ploeg A"
    assert saved.start_date.isoformat() == "2024-01-09"

    [track] = _added(uc, ObservationOrm)
    assert track.observation_type == "lithological_description"
    assert track.source == "pdf-digitised"
    assert track.borehole_id == saved.id
    assert [layer.description for layer in track.layers][:2] == [
        "Asfalt, Asfaltboor",
        "Volledig puingranulaat, standaard oranjegrijs, Sonic Drill",
    ]
    assert all(layer.main_soil_codes == [] for layer in track.layers)
    assert [(layer.top_m, layer.base_m) for layer in track.layers][-1] == (5.0, 7.28)

    samples = sorted(_added(uc, SampleOrm), key=lambda s: s.depth_top_m)
    assert [s.sample_number for s in samples] == ["1-0000000002", "S1-0000000001"]
    assert [s.sample_label for s in samples] == ["1", "S1"]
    assert [s.sample_type for s in samples] == ["geroerd", "ongeroerd"]
    assert {s.borehole_id for s in samples} == {saved.id}

    provenance = saved.import_provenance
    assert provenance["source"] == "pdf-digitised"
    assert provenance["report_sha256"] == sha
    assert provenance["sampled_intervals_m"] == [[4.5, 5.0]]
    assert provenance["confirmations"] == {"crs": None, "water_unit_confirmed": False}

    uc._session.commit.assert_awaited_once()
    [boring] = result.boreholes
    assert (boring.imported, boring.refreshed, boring.borehole_id) == (True, False, saved.id)


# ---------------------------------------------------------------------------
# Rulings 3 and 4: an assumption is confirmed, never silent
# ---------------------------------------------------------------------------


async def test_an_unconfirmed_assumed_crs_and_water_unit_are_refused_and_nothing_is_written(
    tmp_path,
):
    """B-T2 prints X/Y without a system and "GWS: 380": unconfirmed = 422, no row."""
    store, sha = _triaged(tmp_path, synth.build_boorprofiel_pdf(water="380"))
    uc = _use_case(store)

    with pytest.raises(BoreholePdfImportRefusedError) as refused:
        await _run(uc, sha, [BoreholePdfImportRequest(key=B_T2)])

    assert refused.value.code == "borehole_pdf_assumption_unconfirmed"
    assert refused.value.boreholes == [
        {"key": B_T2, "name": "B-T2", "codes": ["CRS_ASSUMED", "WATER_UNIT_ASSUMED"]}
    ]
    uc._repo.save.assert_not_awaited()
    uc._session.commit.assert_not_awaited()


async def test_a_confirmed_lambert_72_and_cm_below_ground_are_stored_with_the_confirmation(
    tmp_path,
):
    """ "This test is Lambert 72" + "cm below ground": stored, and the provenance says so."""
    store, sha = _triaged(tmp_path, synth.build_boorprofiel_pdf(water="380"))
    uc = _use_case(store)

    await _run(
        uc,
        sha,
        [
            BoreholePdfImportRequest(
                key=B_T2, crs_epsg=31370, crs_scope="this", water_unit_confirmed=True
            )
        ],
    )

    saved: BoreholeOrm = uc._repo.save.await_args.args[0]
    assert saved.epsg == 31370
    assert saved.water_table_depth_m == pytest.approx(3.80)
    assert saved.import_provenance["confirmations"] == {
        "crs": {"epsg": 31370, "scope": "this"},
        "water_unit_confirmed": True,
    }


async def test_another_crs_chosen_from_the_list_replaces_the_assumed_one(tmp_path):
    """ "Another CRS" + a dropdown: the printed X/Y stay, the system is the user's."""
    store, sha = _triaged(tmp_path, synth.build_boorprofiel_pdf(water="380"))
    uc = _use_case(store)

    await _run(
        uc,
        sha,
        [
            BoreholePdfImportRequest(
                key=B_T2, crs_epsg=28992, crs_scope="this", water_unit_confirmed=True
            )
        ],
    )

    saved: BoreholeOrm = uc._repo.save.await_args.args[0]
    assert saved.epsg == 28992
    assert (saved.location_x, saved.location_y) == (67800.0, 224500.0)


async def test_a_crs_outside_the_list_is_refused(tmp_path):
    """The dropdown offers the systems the map can draw; any other code is refused."""
    store, sha = _triaged(tmp_path, synth.build_boorprofiel_pdf(water="380"))
    uc = _use_case(store)

    with pytest.raises(BoreholePdfImportRefusedError) as refused:
        await _run(
            uc,
            sha,
            [
                BoreholePdfImportRequest(
                    key=B_T2, crs_epsg=4326, crs_scope="this", water_unit_confirmed=True
                )
            ],
        )

    assert refused.value.code == "borehole_pdf_crs_unsupported"
    uc._repo.save.assert_not_awaited()


async def test_a_crs_confirmed_for_every_test_of_the_report_covers_a_row_without_its_own(
    tmp_path,
):
    """ "All tests in this report are Lambert 72" on one row covers the others."""
    doc = synth.build_boorprofiel_pdf(water="380")
    second = synth.build_boorprofiel_pdf(water="380")
    # The same layout printed for a second borehole: a renamed copy.
    for block in second[0].search_for("B-T2"):
        second[0].add_redact_annot(block)
    second[0].apply_redactions()
    second[0].insert_text((110.0, 60.0), "B-T3", fontsize=11.0, fontname="helv")
    doc.insert_pdf(second)
    store, sha = _triaged(tmp_path, doc)
    uc = _use_case(store)

    await _run(
        uc,
        sha,
        [
            BoreholePdfImportRequest(
                key=B_T2, crs_epsg=31370, crs_scope="report", water_unit_confirmed=True
            ),
            BoreholePdfImportRequest(key="B-T3@p2", water_unit_confirmed=True),
        ],
    )

    saved = [c.args[0] for c in uc._repo.save.await_args_list]
    assert [s.name for s in saved] == ["B-T2", "B-T3"]
    assert saved[1].import_provenance["confirmations"]["crs"] == {
        "epsg": 31370,
        "scope": "report",
    }


# ---------------------------------------------------------------------------
# Rows not offered, ruling 5
# ---------------------------------------------------------------------------


async def test_a_borehole_the_triage_did_not_offer_is_refused(tmp_path):
    """A key that is not one of the report's parsed boreholes imports nothing."""
    store, sha = _triaged(tmp_path, synth.build_boorstaat_pdf())
    uc = _use_case(store)

    with pytest.raises(BoreholePdfImportRefusedError) as refused:
        await _run(uc, sha, [BoreholePdfImportRequest(key="B-X@p9")])

    assert refused.value.code == "borehole_pdf_borehole_not_offered"
    uc._repo.save.assert_not_awaited()


async def test_two_prints_of_one_borehole_in_one_import_are_refused_never_merged(tmp_path):
    """Ruling 5: "the user chooses which to withhold": both ticked = refused."""
    store, sha = _triaged(tmp_path, synth.build_findings_pdf(reprint_tube_text="Steek mislukt"))
    keys = [b.key for b in store.recall(PROJECT, sha).digest.boreholes]
    assert len(keys) == 2
    uc = _use_case(store)

    with pytest.raises(BoreholePdfImportRefusedError) as refused:
        await _run(uc, sha, [BoreholePdfImportRequest(key=k) for k in keys])

    assert refused.value.code == "borehole_pdf_repeat_choose_one"
    uc._repo.save.assert_not_awaited()


async def test_an_untriaged_report_is_the_not_found_error(tmp_path):
    """A restarted backend forgets the triage: the dialog picks the report again."""
    uc = _use_case(PdfReportStore(tmp_path))
    with pytest.raises(CptPdfReportNotFoundError):
        await _run(uc, "b" * 64, [BoreholePdfImportRequest(key=B_T1)])


# ---------------------------------------------------------------------------
# Consented refresh
# ---------------------------------------------------------------------------


def _stored_b_t1(*, elevation_source: str = ElevationSource.PDF.value) -> BoreholeOrm:
    """B-T1 already in the project from an earlier import of the same report."""
    orm = BoreholeOrm(
        id=uuid4(),
        name="B-T1",
        app_project_id=PROJECT,
        project_id="00.00-000 TEST-001",
        test_id="B-T1",
        location_x=1.0,
        location_y=2.0,
        elevation_m=9.99,
        elevation_source=elevation_source,
        epsg=31370,
        total_depth_m=3.0,
        import_provenance={"source": "pdf-digitised", "report_sha256": "0" * 64},
    )
    orm.drill_segments = []
    orm.field_log_intervals = []
    orm.samples = [
        SampleOrm(
            id=uuid4(),
            borehole_id=orm.id,
            sample_number="S1-0000000001",
            depth_top_m=4.503,
            depth_base_m=5.003,
            description="",
            grain_sizes=[],
        )
    ]
    orm.observations = [
        ObservationOrm(
            id=uuid4(),
            borehole_id=orm.id,
            observation_type="lithological_description",
            source="pdf-digitised",
            layers=[ObservationLayerOrm(id=uuid4(), top_m=0.0, base_m=3.0, layer_index=0)],
        )
    ]
    return orm


async def test_a_borehole_already_in_the_project_answers_with_the_diff_and_writes_nothing(
    tmp_path,
):
    """No ``confirm_refresh``: the XML import's 409 code + the old-vs-new numbers."""
    store, sha = _triaged(tmp_path, synth.build_boorstaat_pdf())
    stored = _stored_b_t1()
    uc = _use_case(store, [stored])

    with pytest.raises(BoreholeRefreshConfirmationRequiredError) as asked:
        await _run(uc, sha, [BoreholePdfImportRequest(key=B_T1)])

    [diff] = asked.value.diffs
    assert diff["borehole_id"] == str(stored.id)
    assert (diff["old_total_depth_m"], diff["new_total_depth_m"]) == (3.0, 7.28)
    assert (diff["old_n_litho_layers"], diff["new_n_litho_layers"]) == (1, 7)
    uc._session.commit.assert_not_awaited()
    assert stored.total_depth_m == 3.0


async def test_a_consented_refresh_keeps_the_id_and_replaces_the_pdf_track_and_header(
    tmp_path,
):
    """``confirm_refresh``: same id, header + track + provenance from the fresh parse."""
    store, sha = _triaged(tmp_path, synth.build_boorstaat_pdf())
    stored = _stored_b_t1()
    track_id = stored.observations[0].id
    sample_id = stored.samples[0].id
    uc = _use_case(store, [stored])

    result = await _run(uc, sha, [BoreholePdfImportRequest(key=B_T1)], confirm=True)

    [boring] = result.boreholes
    assert (boring.borehole_id, boring.refreshed) == (stored.id, True)
    assert stored.total_depth_m == pytest.approx(7.28)
    assert (stored.location_x, stored.location_y) == (68000.5, 224000.25)
    assert stored.elevation_m == pytest.approx(6.5)
    assert stored.import_provenance["report_sha256"] == sha
    [track] = stored.observations
    assert track.id == track_id
    assert len(track.layers) == 7
    by_number = {s.sample_number: s for s in stored.samples}
    assert by_number["S1-0000000001"].id == sample_id
    assert by_number["S1-0000000001"].sample_label == "S1"
    assert "1-0000000002" in by_number
    uc._repo.save.assert_not_awaited()
    uc._session.commit.assert_awaited_once()


async def test_a_refresh_keeps_a_manual_elevation_and_a_track_edited_by_hand(tmp_path):
    """The engineer's collar and his coding of the description survive a re-import."""
    store, sha = _triaged(tmp_path, synth.build_boorstaat_pdf())
    stored = _stored_b_t1(elevation_source=ElevationSource.MANUAL.value)
    edited_at = datetime(2026, 10, 9, tzinfo=UTC)
    stored.observations[0].edited_manually_at = edited_at
    uc = _use_case(store, [stored])

    result = await _run(uc, sha, [BoreholePdfImportRequest(key=B_T1)], confirm=True)

    assert stored.elevation_m == pytest.approx(9.99)
    [track] = stored.observations
    assert track.edited_manually_at == edited_at
    assert len(track.layers) == 1
    [boring] = result.boreholes
    assert "PDF_BOREHOLE_EDITED_TRACK_KEPT" in {i.code for i in boring.issues}
