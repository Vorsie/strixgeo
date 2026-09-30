"""Unit tests for the lab-series tree builder (parse result → ORM tree, no DB).

Owner rules the tree must honour:

* 2026-09-28 "we need to get the raw data in the db": every reading of every
  stage / specimen becomes a channel value; nothing is thinned.
* 2026-09-29, Q1 "what we have is what we have": the triaxial dumps carry no
  time channel, so a triaxial stage stores the lab's POINT NUMBERS as its axis.
* Q3 "don't use default values, you can list them but we'll be doing our own
  interpretations": the lab's summary values are stored as pass-through
  ``lab_reported`` rows, never as channels Strix computes with.
* "can we add delta_h/h0 from il-oedometer?": every oedometer stage carries a
  DERIVED vertical-strain channel with its formula and h0 recorded.
* Review 2026-09-29: the dial re-zero duplicate is stored as read but marked
  on its stage (``rezero_indices``) so no series counts it twice.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.application.lab_series_tree_builder import (
    build_lab_series_test,
    lab_series_identity,
)
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_reader import (
    LabExportReader,
)

_LAB = Path(__file__).resolve().parents[2] / "fixtures" / "lab"


def _tree(relative: str):
    """Parse a fixture and build its ORM tree."""
    raw = (_LAB / relative).read_bytes()
    result = LabExportReader().read(raw, source_name=Path(relative).name)
    return build_lab_series_test(result, source_file_name=Path(relative).name, source_sha256="x")


def _channels(stage) -> dict:
    """Channels of a stage by key."""
    return {c.channel_key: c for c in stage.channels}


# ---------------------------------------------------------------------------
# Oedometer (incremental-loading control listing)
# ---------------------------------------------------------------------------


def test_oedometer_listing_becomes_one_specimen_with_one_stage_per_load_step() -> None:
    """20/0568: one specimen, 16 load steps, 800 readings — every one stored."""
    test = _tree("oedometer/200568B7-LstSMControleListing.txt")
    assert test.kind == "oedometer"
    assert test.lab_sample_number == "20/0568"
    assert test.lab_borehole_name == "B7A"
    assert test.sampling_depth_top_m == pytest.approx(14.5)
    assert test.source_format == "oed_control_listing"
    assert test.source_native_file == r"I:\geo\data\19122\200568B7.OCT"
    [specimen] = test.specimens
    assert test.n_specimens == 1
    assert len(specimen.stages) == 16
    assert specimen.n_points == 800
    assert specimen.initial_height_mm == pytest.approx(19.96)
    assert specimen.lever_ratio == pytest.approx(9.91)
    first = specimen.stages[0]
    assert first.stage_index == 1 and first.stage_kind == "load_step"
    assert first.direction_token == "Belasting"
    assert first.target_stress_kpa == pytest.approx(93.568)
    assert len(first.reading_timestamps) == 50 == first.n_readings
    assert first.point_numbers is None


def test_every_oedometer_reading_column_is_a_measured_channel() -> None:
    """Elapsed time, dial, stage and cumulative settlement: measured, with the
    lab's own column label and unit, one value per reading."""
    stage = _tree("oedometer/200568B7-LstSMControleListing.txt").specimens[0].stages[0]
    ch = _channels(stage)
    for key in ("elapsed_min", "dial_reading", "settlement_mm", "total_settlement_mm"):
        assert ch[key].provenance == "measured"
        assert len(ch[key].series_values) == 50
    assert ch["settlement_mm"].source_label == "Zetting"
    assert ch["dial_reading"].unit == "gauge unit"
    assert ch["total_settlement_mm"].series_values[-1] == pytest.approx(0.751)


def test_every_oedometer_stage_carries_the_derived_vertical_strain() -> None:
    """delta_h / h0: provenance 'derived', formula and h0 recorded, 0 at the
    first reading, end of the last loading stage = 1,771 / 19,96."""
    specimen = _tree("oedometer/200568B7-LstSMControleListing.txt").specimens[0]
    for stage in specimen.stages:
        strain = _channels(stage)["vertical_strain"]
        assert strain.provenance == "derived"
        assert strain.formula == "epsilon_v = delta_h / h0"
        assert strain.derivation_inputs["h0_mm"] == pytest.approx(19.96)
        assert strain.derivation_inputs["delta_h_channel"] == "total_settlement_mm"
        assert strain.unit == "-"
    assert _channels(specimen.stages[0])["vertical_strain"].series_values[0] == 0.0
    last = _channels(specimen.stages[15])["vertical_strain"].series_values[-1]
    assert last == pytest.approx(1.771 / 19.96, abs=1e-6)


def test_the_lab_summary_becomes_lab_reported_rows_never_channels() -> None:
    """The lab's per-stage table (Druk, Dhi, h, volumemassa droog, e, C (A),
    av, mv, Cc) for stages 0..16 is kept as read-only lab-reported rows."""
    test = _tree("oedometer/200568B7-LstSMControleListing.txt")
    assert {r.provenance for r in test.lab_results} == {"lab_reported"}
    e0 = [r for r in test.lab_results if r.parameter == "e" and r.stage_index == 0]
    assert e0 and e0[0].value_numeric == pytest.approx(0.682)
    assert {r.stage_index for r in test.lab_results} == set(range(0, 17))
    assert all(c.channel_key != "void_ratio" for s in test.specimens[0].stages for c in s.channels)


def test_the_rezero_duplicate_is_kept_and_marked_on_its_stage() -> None:
    """20/0569 stages 10 and 13: 51 readings stored, the duplicate's index in
    ``rezero_indices``; the other stages carry none."""
    stages = _tree("oedometer/200569B7-LstSMControleListing.txt").specimens[0].stages
    by_index = {s.stage_index: s for s in stages}
    assert by_index[10].n_readings == 51 and len(by_index[10].rezero_indices) == 1
    assert by_index[13].n_readings == 51 and len(by_index[13].rezero_indices) == 1
    assert not by_index[1].rezero_indices


def test_the_findings_are_frozen_on_the_test() -> None:
    """The parser findings ride along as plain dicts (code, level, message, rows)."""
    test = _tree("oedometer/200569B7-LstSMControleListing.txt")
    codes = {i["code"] for i in test.import_issues}
    assert {"DIAL_REZERO", "STAGE_SHORT"} <= codes
    assert all(set(i) == {"level", "code", "message", "rows"} for i in test.import_issues)


# ---------------------------------------------------------------------------
# Oedometer (newer module raw export)
# ---------------------------------------------------------------------------


def test_new_module_export_keeps_its_extra_columns_and_dial_in_mm() -> None:
    """The newer module logs the load and two seconds columns per reading —
    each its own measured channel; the dial is in mm; no lab summary."""
    test = _tree("oedometer_new/uit_nieuwemodule.csv")
    assert test.source_format == "oed_new_module_raw"
    assert test.lab_borehole_name is None and test.sampling_depth_top_m is None
    stage = test.specimens[0].stages[0]
    ch = _channels(stage)
    assert ch["dial_reading"].unit == "mm"
    assert ch["load_kg"].provenance == "measured" and ch["load_kg"].unit == "kg"
    assert ch["elapsed_stage_s"].series_values[1] == pytest.approx(1.6)
    assert "vertical_strain" in ch
    assert test.lab_results == []
    assert test.specimens[0].n_points == 5952


# ---------------------------------------------------------------------------
# Triaxial
# ---------------------------------------------------------------------------


def test_triaxial_dump_becomes_one_shear_stage_per_specimen_on_point_numbers() -> None:
    """tx_cd: specimens a, b, c; each one 'shear' stage whose axis is the lab's
    point numbers (the dump has no time column)."""
    test = _tree("triaxial/tx_cd.txt")
    assert test.kind == "triaxial" and test.test_type_token == "CD"
    assert test.source_format == "tx_point_dump"
    assert [s.specimen_label for s in test.specimens] == ["a", "b", "c"]
    assert [s.n_points for s in test.specimens] == [1130, 1139, 1133]
    [stage] = test.specimens[0].stages
    assert stage.stage_kind == "shear"
    assert stage.point_numbers[0] == 60 and len(stage.point_numbers) == 1130
    assert stage.reading_timestamps is None
    assert test.specimens[0].strain_rate_mm_per_min == pytest.approx(0.02)


def test_triaxial_channels_keep_measured_apart_from_lab_derived() -> None:
    """Force / displacement / pressures / dV measured; strain and stresses the
    lab's (``lab_derived``), with units and the lab's labels."""
    ch = _channels(_tree("triaxial/tx_cd.txt").specimens[0].stages[0])
    assert ch["force_n"].provenance == "measured" and ch["force_n"].unit == "N"
    assert ch["displacement_um"].source_label == "Verpl."
    assert ch["volume_change_cm3"].provenance == "measured"
    assert ch["axial_strain_pct"].provenance == "lab_derived"
    assert ch["deviator_stress_kpa"].provenance == "lab_derived"
    assert ch["deviator_stress_kpa"].unit == "kPa"
    assert "vertical_strain" not in ch


def test_triaxial_before_and_after_values_are_lab_reported() -> None:
    """The specimen's before / after table and the failure description are the
    lab's statements: lab-reported rows per specimen."""
    results = _tree("triaxial/tx_cd.txt").lab_results
    a = [r for r in results if r.specimen_label == "a"]
    w_before = [r for r in a if r.parameter == "Watergehalte (voor de proef)"]
    assert w_before and w_before[0].value_numeric == pytest.approx(19.7)
    assert w_before[0].unit == "%"
    failure = [r for r in a if r.parameter == "Type breuk / Afschuifhoek"]
    assert failure and failure[0].value_text == "breuk 2 / 57 °"


# ---------------------------------------------------------------------------
# Identity (the refresh key)
# ---------------------------------------------------------------------------


def test_identity_is_kind_test_type_job_and_sample_number() -> None:
    """The re-import key: (kind, test type, lab job, lab sample number)."""
    raw = (_LAB / "triaxial" / "tx_cd.txt").read_bytes()
    result = LabExportReader().read(raw, source_name="tx_cd.txt")
    assert lab_series_identity(result) == ("triaxial", "CD", "GEO-25/022", "25/0389")
