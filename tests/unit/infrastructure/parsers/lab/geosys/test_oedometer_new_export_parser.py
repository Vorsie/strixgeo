"""Unit tests for OedometerNewExportParser — the newer oedometer module's raw dump.

The lab's newer compression module writes a raw export (``uit_nieuwemodule.csv``,
UTF-8 with a BOM): ``#``-prefixed header lines (dossier, sample number, test
name, specimen height / diameter / mass, lever ratio, initial water content),
then ONE ROW PER DIAL READING between ``#START_METINGEN`` and
``#EINDE_METINGEN``: stage number, absolute timestamp, seconds since the test
start, seconds since the stage start, the dial reading in mm, the cumulative
and the stage deformation in mm, the load on the hanger in kg and the minutes
since the stage start. The format spec is the owner's own library (geolib_rvo,
``gui_03_consolidatie.lees_nieuwe_module``).

Owner rule (2026-09-28): "we need to get the raw data in the db" — so these
tests pin that every reading of every stage comes out with every column, and
that what the export does NOT carry (borehole, sampling depth) is said out
loud rather than guessed.

Fixture: ``tests/fixtures/lab/oedometer_new/uit_nieuwemodule.csv`` (dossier
GEO-23/099, sample 24/1036, 11 stages, 5952 readings).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.lab.geosys.oedometer_new_export_parser import (
    OedometerNewExportParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

_FIXTURE = (
    Path(__file__).resolve().parents[5]
    / "fixtures"
    / "lab"
    / "oedometer_new"
    / "uit_nieuwemodule.csv"
)


def _codes(result) -> list[str]:
    """Return the issue codes of a result, in order."""
    return [i.code for i in result.issues]


def test_identity_is_the_dossier_and_sample_number_from_the_hash_header() -> None:
    """The export names the dossier (lab job) and the lab sample number; it
    names NO borehole and NO sampling depth — those stay None, never guessed."""
    r = OedometerNewExportParser().parse(_FIXTURE)
    assert r.header.job_number == "GEO-23/099"
    assert r.header.sample_number == "24/1036"
    assert r.header.borehole_name is None
    assert r.header.depth_top_m is None and r.header.depth_base_m is None
    assert r.source_format == "geosys_oed_new_module_raw"


def test_specimen_metadata_is_passed_through_from_the_header() -> None:
    """Height, diameter, mass, lever ratio and water content as the module wrote them."""
    h = OedometerNewExportParser().parse(_FIXTURE).header
    assert h.initial_height_mm == pytest.approx(19.94)
    assert h.diameter_mm == pytest.approx(63.54)
    assert h.wet_mass_g == pytest.approx(96.268)
    assert h.lever_ratio == pytest.approx(9.93)
    assert h.water_content_pct == pytest.approx(63.7244587)
    assert h.raw["Proefnaam"] == "1e ingave"


def test_every_reading_of_every_stage_comes_out() -> None:
    """Eleven stages, 5952 readings, grouped by the stage-number column."""
    r = OedometerNewExportParser().parse(_FIXTURE)
    assert [s.stage_number for s in r.stages] == list(range(1, 12))
    assert [len(s.elapsed_min) for s in r.stages] == [
        34,
        220,
        281,
        492,
        947,
        1500,
        1503,
        203,
        228,
        174,
        370,
    ]


def test_a_reading_keeps_every_column_of_the_row() -> None:
    """A reading is (timestamp, dial mm, stage deformation, cumulative
    deformation, minutes since stage start) plus the per-reading load and the
    two seconds columns — exactly the export's row, nothing derived."""
    stage = OedometerNewExportParser().parse(_FIXTURE).stages[0]
    assert stage.timestamps[0] == datetime(2024, 10, 1, 7, 22, 36, 246000)
    assert stage.dial_readings[0] == pytest.approx(-15.326)
    assert stage.settlement_mm[1] == pytest.approx(0.106)
    assert stage.total_settlement_mm[1] == pytest.approx(0.106)
    assert stage.elapsed_min[2] == pytest.approx(0.05)
    assert stage.extra_channels["load_kg"][0] == pytest.approx(0.3017)
    assert stage.extra_channels["elapsed_stage_s"][1] == pytest.approx(1.6)
    assert stage.extra_channels["elapsed_test_s"][-1] == pytest.approx(10257.2)
    n = len(stage.elapsed_min)
    assert all(len(v) == n for v in stage.extra_channels.values())


def test_the_hanger_load_of_each_stage_is_the_logged_load() -> None:
    """The module logs the hanger load per reading; it is constant per stage,
    and the stage carries it (stress is NOT in the export — not computed)."""
    stages = OedometerNewExportParser().parse(_FIXTURE).stages
    assert stages[0].hanger_load_kg == pytest.approx(0.3017)
    assert stages[6].hanger_load_kg == pytest.approx(16.0517)
    assert all(s.stress_kpa is None for s in stages)
    assert "LOAD_CHANGES_IN_STAGE" not in _codes(OedometerNewExportParser().parse(_FIXTURE))


def test_the_missing_borehole_and_depth_are_reported_for_the_preview() -> None:
    """The export has no borehole and no sampling depth: an INFO finding tells
    the import preview to ask for both instead of matching on them."""
    r = OedometerNewExportParser().parse(_FIXTURE)
    hits = [i for i in r.issues if i.code == "NO_BOREHOLE_IN_EXPORT"]
    assert hits and hits[0].level == ValidationLevel.INFO
    assert not r.has_errors


def test_a_load_that_changes_inside_a_stage_is_flagged() -> None:
    """Near-miss guard: one reading of stage 1 with a different load is a
    WARNING — the stage no longer has ONE load step."""
    text = _FIXTURE.read_bytes().decode("utf-8-sig")
    row = "1; 01/10/2024 07:22:37.878;1,6;1,6;-15,432;0,106;0,106;0,3017;0,03"
    assert row in text
    text = text.replace(row, row.replace(";0,3017;", ";0,5517;"), 1)
    r = OedometerNewExportParser().parse_text(text, source_name="t.csv")
    hits = [i for i in r.issues if i.code == "LOAD_CHANGES_IN_STAGE"]
    assert hits and hits[0].level == ValidationLevel.WARNING and "stage 1" in hits[0].message


def test_missing_sample_number_is_an_error_finding() -> None:
    """Without ``Monsternummer`` the test cannot be attached — ERROR finding,
    readings still parsed."""
    text = _FIXTURE.read_bytes().decode("utf-8-sig")
    text = "\n".join(ln for ln in text.splitlines() if not ln.startswith("#Monsternummer"))
    r = OedometerNewExportParser().parse_text(text, source_name="t.csv")
    assert len(r.stages) == 11
    missing = [i for i in r.issues if i.code == "MISSING_SAMPLE_IDENTITY"]
    assert missing and missing[0].level == ValidationLevel.ERROR


def test_text_without_readings_raises_parse_error() -> None:
    """A header with no reading rows is not a raw oedometer export."""
    with pytest.raises(ParseError):
        OedometerNewExportParser().parse_text(
            "#Dossiernummer: GEO-1/1;;\n#START_METINGEN;;\n#EINDE_METINGEN;;\n",
            source_name="x.csv",
        )


def test_an_unreadable_cell_is_an_error_finding_not_a_crash() -> None:
    """A non-numeric cell becomes None with an ERROR finding naming the line."""
    text = _FIXTURE.read_bytes().decode("utf-8-sig")
    row = "1; 01/10/2024 07:22:39.513;3,3;3,3;-15,479;0,153;0,153;0,3017;0,05"
    text = text.replace(row, row.replace("-15,479", "x"), 1)
    r = OedometerNewExportParser().parse_text(text, source_name="t.csv")
    assert r.stages[0].dial_readings[2] is None
    bad = [i for i in r.issues if i.code == "UNREADABLE_VALUE"]
    assert bad and bad[0].level == ValidationLevel.ERROR
