"""Unit tests for OedometerControlListingParser — incremental-loading oedometer control listing.

The control listing (``*-LstSMControleListing.txt``) is the rawest oedometer
export the lab gives us: per load step it lists every logged reading with its
absolute timestamp, the raw dial-gauge reading, the elapsed time, and the
settlement. The owner's rule (2026-09-28): "we need to get the raw data in the
db" — so these tests pin that EVERY logged reading of EVERY stage comes out,
with its timestamp and dial value, not just the lab's per-stage summary.

Fixtures are the two real listings from the owner's lab export
(``tests/fixtures/lab/oedometer/``): sample 20/0568 (16 stages, 800 readings)
and 20/0569 (17 stages, 848 readings, two dial re-zero events).
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_control_listing_parser import (
    OedometerControlListingParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

_FIXTURES = Path(__file__).resolve().parents[5] / "fixtures" / "lab" / "oedometer"
_S0568 = _FIXTURES / "200568B7-LstSMControleListing.txt"
_S0569 = _FIXTURES / "200569B7-LstSMControleListing.txt"


def _codes(result) -> list[str]:
    """Return the issue codes of a result, in order."""
    return [i.code for i in result.issues]


# ---------------------------------------------------------------------------
# Happy path: the sample identity comes from the labels, not the file name
# ---------------------------------------------------------------------------


def test_sample_identity_is_read_from_the_labelled_header() -> None:
    """The sample is identified by its labelled header lines (job, borehole,
    sequence, sample number, sampling depth) — never by the 8-character file
    name, which truncates the borehole (``B7`` for ``B7A``)."""
    result = OedometerControlListingParser().parse(_S0568)
    h = result.header
    assert h.job_number == "GEO-19/122"
    assert h.borehole_name == "B7A"
    assert h.sequence_number == "N002"
    assert h.sample_number == "20/0568"
    assert h.depth_top_m == pytest.approx(14.50)
    assert h.depth_base_m == pytest.approx(15.00)
    assert h.visual_description == "sterk kalkh. weinig kleih. zand"


def test_specimen_and_apparatus_metadata_are_passed_through() -> None:
    """Specimen dimensions and apparatus settings are carried as the lab
    reported them (pass-through, Data Integrity rule 2)."""
    h = OedometerControlListingParser().parse(_S0568).header
    assert h.initial_height_mm == pytest.approx(19.96)
    assert h.diameter_mm == pytest.approx(63.54)
    assert h.wet_mass_g == pytest.approx(124.11)
    assert h.water_content_pct == pytest.approx(24.49)
    assert h.grain_density_t_m3 == pytest.approx(2.65)
    assert h.apparatus_number == "43"
    assert h.lever_ratio == pytest.approx(9.91)
    assert h.dial_coefficient_mm_per_unit == pytest.approx(-1.0)
    assert h.mounting_date == date(2020, 6, 3)


def test_source_stamp_names_the_native_lab_file_and_program_version() -> None:
    """The listing is a rendering of a native ``.OCT`` file; the stamp is kept
    so a re-import can tell which lab file and program version produced it."""
    h = OedometerControlListingParser().parse(_S0568).header
    assert h.source_filename == r"I:\geo\data\19122\200568B7.OCT"
    assert h.program_version == "v2.1.78 (12/10/2022 10:51:47)"
    assert h.created_mark == "Aangemaakt door labuser op 2/07/2020 11:10:06"


# ---------------------------------------------------------------------------
# Raw readings: every reading of every stage, with timestamp and dial value
# ---------------------------------------------------------------------------


def test_every_logged_reading_of_every_stage_is_returned() -> None:
    """All 16 load steps come out, and every reading the listing logged —
    800 for 20/0568 and 848 for 20/0569 (stages are NOT always 50 readings)."""
    r68 = OedometerControlListingParser().parse(_S0568)
    r69 = OedometerControlListingParser().parse(_S0569)
    assert [s.stage_number for s in r68.stages] == list(range(1, 17))
    assert sum(len(s.elapsed_min) for s in r68.stages) == 800
    assert len(r69.stages) == 17
    assert sum(len(s.elapsed_min) for s in r69.stages) == 848
    assert sorted({len(s.elapsed_min) for s in r69.stages}) == [46, 50, 51]


def test_first_stage_reading_keeps_timestamp_dial_time_and_settlement() -> None:
    """A reading is (absolute timestamp, raw dial reading, elapsed minutes,
    stage settlement, cumulative settlement) — exactly the listing's row."""
    stage = OedometerControlListingParser().parse(_S0568).stages[0]
    assert stage.timestamps[0] == datetime(2020, 6, 3, 7, 58, 47, 282000)
    assert stage.dial_readings[0] == pytest.approx(-8.742)
    assert stage.elapsed_min[0] == pytest.approx(0.0)
    assert stage.settlement_mm[1] == pytest.approx(0.670)
    assert stage.total_settlement_mm[-1] == pytest.approx(0.751)
    assert (
        len(
            {
                len(stage.timestamps),
                len(stage.dial_readings),
                len(stage.elapsed_min),
                len(stage.settlement_mm),
                len(stage.total_settlement_mm),
            }
        )
        == 1
    )


def test_stage_header_carries_direction_load_and_stress_as_reported() -> None:
    """Each stage keeps the lab's own direction token (Belasting = loading,
    Ontlasting = unloading), the dead load on the hanger and the stress."""
    stages = OedometerControlListingParser().parse(_S0568).stages
    assert stages[0].direction == "Belasting"
    assert stages[0].hanger_load_kg == pytest.approx(3.05)
    assert stages[0].stress_kpa == pytest.approx(93.568)
    assert stages[1].direction == "Ontlasting"
    assert stages[11].stress_kpa == pytest.approx(982.652)


def test_stage_footer_carries_start_height_settlement_and_lab_coefficient() -> None:
    """The ``hi,0= … Zetting= … A=/C= …`` footer is kept per stage: the height
    at the stage start, the stage settlement and the lab's C or A value."""
    stages = OedometerControlListingParser().parse(_S0568).stages
    assert stages[0].height_at_start_mm == pytest.approx(19.960)
    assert stages[0].stage_settlement_mm == pytest.approx(0.751)
    assert stages[0].lab_coefficient_label is None
    assert stages[1].lab_coefficient_label == "A"
    assert stages[1].lab_coefficient == pytest.approx(1271.0)
    assert stages[3].lab_coefficient_label == "C"


def test_elapsed_time_never_steps_back_inside_a_stage() -> None:
    """Within one stage the elapsed-time column is non-decreasing on both real
    files — no ``ELAPSED_TIME_NOT_MONOTONIC`` finding."""
    for path in (_S0568, _S0569):
        result = OedometerControlListingParser().parse(path)
        assert "ELAPSED_TIME_NOT_MONOTONIC" not in _codes(result)


# ---------------------------------------------------------------------------
# Cross-checks the parser runs on the raw readings
# ---------------------------------------------------------------------------


def test_dial_rezero_is_flagged_where_the_dial_jumps_but_settlement_does_not() -> None:
    """20/0569 carries two gauge re-zero events: a duplicated timestamp whose
    dial value jumps (0.086 mm in stage 10, 1.669 mm in stage 13) while the
    settlement column does not move. Each is flagged; 20/0568 has none."""
    r69 = OedometerControlListingParser().parse(_S0569)
    rezero = [i for i in r69.issues if i.code == "DIAL_REZERO"]
    assert len(rezero) == 2
    assert "stage 10" in rezero[0].message
    assert "stage 13" in rezero[1].message
    assert all(i.level == ValidationLevel.WARNING for i in rezero)
    assert "DIAL_REZERO" not in _codes(OedometerControlListingParser().parse(_S0568))


def test_stress_is_reproduced_from_hanger_load_lever_ratio_and_area() -> None:
    """stress = hanger load × lever ratio × g / (π d² / 4) matches the listed
    stress on every stage of both files — no ``STRESS_NOT_REPRODUCED``."""
    for path in (_S0568, _S0569):
        assert "STRESS_NOT_REPRODUCED" not in _codes(OedometerControlListingParser().parse(path))


def test_height_chain_is_consistent_between_stages() -> None:
    """Stage n+1 starts at the height stage n started at minus its settlement —
    holds on both files, so no ``HEIGHT_CHAIN_BROKEN``."""
    for path in (_S0568, _S0569):
        assert "HEIGHT_CHAIN_BROKEN" not in _codes(OedometerControlListingParser().parse(path))


def test_lab_summary_table_is_read_once_despite_the_duplicated_tail() -> None:
    """The listing prints the per-stage summary table twice (once before the
    chart axis dump, once after); the parser keeps the first copy only."""
    summary = OedometerControlListingParser().parse(_S0568).lab_summary
    assert [row.stage_number for row in summary] == list(range(0, 17))
    assert summary[0].void_ratio == pytest.approx(0.682)
    assert summary[12].stress_kpa == pytest.approx(982.65)
    assert summary[16].height_mm == pytest.approx(18.189)


# ---------------------------------------------------------------------------
# Variants and error paths
# ---------------------------------------------------------------------------


def test_tab_delimited_variant_parses_to_the_same_readings() -> None:
    """The lab ships the same listing both ``;``- and tab-delimited (the
    extension does not tell which); both parse to identical readings."""
    text = _S0568.read_bytes().decode("latin-1").replace(";", "\t")
    tab = OedometerControlListingParser().parse_text(text, source_name="tab.txt")
    semi = OedometerControlListingParser().parse(_S0568)
    assert [len(s.elapsed_min) for s in tab.stages] == [len(s.elapsed_min) for s in semi.stages]
    assert tab.header.sample_number == "20/0568"


def test_file_without_any_stage_raises_parse_error() -> None:
    """A text with no ``TRAP :`` stage block is not an oedometer listing."""
    with pytest.raises(ParseError):
        OedometerControlListingParser().parse_text(
            "ControlelistingSamendrukkingsproef\nOpdrachtnummer :;GEO-1/1\n", source_name="x.txt"
        )


def test_missing_identity_labels_are_flagged_not_fatal() -> None:
    """A listing whose borehole and sample-number lines are gone still parses
    its readings, and flags the missing identity as an ERROR finding (the
    import cannot attach it to a sample)."""
    text = "\n".join(
        line
        for line in _S0568.read_bytes().decode("latin-1").splitlines()
        if not line.startswith(("Boringnummer", "Monsternummer"))
    )
    result = OedometerControlListingParser().parse_text(text, source_name="stripped.txt")
    assert len(result.stages) == 16
    missing = [i for i in result.issues if i.code == "MISSING_SAMPLE_IDENTITY"]
    assert missing and missing[0].level == ValidationLevel.ERROR


# ---------------------------------------------------------------------------
# Near-miss guards: each cross-check fires when its input is tampered
# ---------------------------------------------------------------------------


def _tampered(old: str, new: str) -> str:
    """Return the 20/0568 listing text with the first ``old`` replaced."""
    text = _S0568.read_bytes().decode("latin-1")
    assert old in text
    return text.replace(old, new, 1)


def test_a_mistyped_stage_stress_is_flagged() -> None:
    """Stage 1 listed at 99 kPa instead of 93,568 no longer matches
    3,05 kg × 9,91 × g / area → ``STRESS_NOT_REPRODUCED`` on stage 1."""
    text = _tampered("93,568 kPa op het monster", "99,000 kPa op het monster")
    result = OedometerControlListingParser().parse_text(text, source_name="t.txt")
    hits = [i for i in result.issues if i.code == "STRESS_NOT_REPRODUCED"]
    assert len(hits) == 1 and "stage 1:" in hits[0].message


def test_a_broken_height_chain_is_flagged() -> None:
    """Stage 2 starting at 19,309 mm instead of 19,209 (= 19,960 − 0,751)
    breaks the chain → ``HEIGHT_CHAIN_BROKEN``."""
    text = _tampered("hi,0= 19,209 mm", "hi,0= 19,309 mm")
    result = OedometerControlListingParser().parse_text(text, source_name="t.txt")
    assert "HEIGHT_CHAIN_BROKEN" in _codes(result)


def test_elapsed_time_stepping_back_is_flagged() -> None:
    """A reading whose elapsed time is below its predecessor's is flagged."""
    text = _tampered(";-9,412;0,05;0,670;0,670", ";-9,412;9,05;0,670;0,670")
    result = OedometerControlListingParser().parse_text(text, source_name="t.txt")
    assert "ELAPSED_TIME_NOT_MONOTONIC" in _codes(result)


# ---------------------------------------------------------------------------
# Review findings (2026-09-29): short stages, end-of-stage step-back, re-zero
# duplicates marked so no stored series counts the reading twice
# ---------------------------------------------------------------------------


def test_a_stage_with_fewer_readings_than_the_files_usual_count_is_reported() -> None:
    """20/0569 stage 2 lists 46 readings where the file's usual count is 50:
    reported as STAGE_SHORT (INFO), naming the stage and both counts. The
    re-zero stages (51 readings) are longer, not shorter, and 20/0568 (all 50)
    has no short stage."""
    r69 = OedometerControlListingParser().parse(_S0569)
    short = [i for i in r69.issues if i.code == "STAGE_SHORT"]
    assert len(short) == 1
    assert short[0].level == ValidationLevel.INFO
    assert "stage 2" in short[0].message and "46" in short[0].message and "50" in short[0].message
    assert "STAGE_SHORT" not in _codes(OedometerControlListingParser().parse(_S0568))


def test_a_stage_whose_last_reading_steps_back_one_print_step_is_info() -> None:
    """20/0569 stage 7 (unloading) swells to -0,026 mm and its last reading
    reads -0,025: the stage ends one 0,001 mm print step back from its own
    peak. Print rounding, so SETTLEMENT_STEPS_BACK is INFO, not a warning."""
    r69 = OedometerControlListingParser().parse(_S0569)
    hits = [i for i in r69.issues if i.code == "SETTLEMENT_STEPS_BACK"]
    assert any("stage 7:" in i.message for i in hits)
    assert all(i.level == ValidationLevel.INFO for i in hits)


def test_a_stage_ending_well_back_from_its_peak_is_a_warning() -> None:
    """Over-shoot guard: a last reading 0,050 mm back from the stage's peak is
    no print rounding — the same code at WARNING."""
    text = _S0568.read_bytes().decode("latin-1")
    stage1_last = ";-9,493;165,33;0,751;0,751"
    assert stage1_last in text
    text = text.replace(stage1_last, ";-9,443;165,33;0,701;0,701", 1)
    result = OedometerControlListingParser().parse_text(text, source_name="t.txt")
    hits = [
        i for i in result.issues if i.code == "SETTLEMENT_STEPS_BACK" and "stage 1:" in i.message
    ]
    assert hits and hits[0].level == ValidationLevel.WARNING


def test_a_loading_stage_ending_on_its_peak_is_not_reported() -> None:
    """Near miss: 20/0568 stage 1 ends on its largest settlement (0,751 mm)."""
    r68 = OedometerControlListingParser().parse(_S0568)
    assert not any(
        i.code == "SETTLEMENT_STEPS_BACK" and "stage 1:" in i.message for i in r68.issues
    )


def test_the_rezero_duplicate_reading_is_kept_and_marked_on_its_stage() -> None:
    """The dial re-zero duplicate (stages 10 and 13 of 20/0569 carry 51
    readings; the extra one repeats the timestamp) is stored as read but its
    index is marked in ``rezero_indices`` so no series counts it twice, and
    the DIAL_REZERO message says so."""
    r69 = OedometerControlListingParser().parse(_S0569)
    by_number = {s.stage_number: s for s in r69.stages}
    for number in (10, 13):
        stage = by_number[number]
        assert len(stage.elapsed_min) == 51
        [index] = stage.rezero_indices
        assert stage.timestamps[index] == stage.timestamps[index - 1]
    assert all(not s.rezero_indices for n, s in by_number.items() if n not in (10, 13))
    rezero = [i for i in r69.issues if i.code == "DIAL_REZERO"]
    assert all("rezero_indices" in i.message or "marked" in i.message for i in rezero)
