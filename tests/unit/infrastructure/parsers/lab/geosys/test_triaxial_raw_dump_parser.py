"""Unit tests for TriaxialRawDumpParser — Geosys triaxial per-point dumps.

The raw dumps (``cd.txt`` / ``cu.txt`` for the TX module, ``advtx*.txt`` for
the Advanced TX module) share ONE layout: a sample header, then one block per
sub-specimen ("deelmonster" a / b / c) with its own metadata and a fixed-width
table of every measuring point of the shear phase. The owner's rule
(2026-09-28): "we need to get the raw data in the db" — so these tests pin
that every measuring point of every specimen comes out, with the measured
channels (force, displacement, cell pressure, pore pressure, volume change)
kept apart from the channels the lab software derived.

Fixtures are the five real dumps in ``tests/fixtures/lab/triaxial/``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.lab.geosys.triaxial_raw_dump_parser import (
    TriaxialRawDumpParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

_FIXTURES = Path(__file__).resolve().parents[5] / "fixtures" / "lab" / "triaxial"
_CD = _FIXTURES / "tx_cd.txt"
_CU = _FIXTURES / "tx_cu.txt"
_ADV_CD = _FIXTURES / "advtxtxt.txt"
_ADV_CU = _FIXTURES / "advtxcutxt.txt"
_ADV_UU = _FIXTURES / "advtxuutxt.txt"


def _codes(result) -> list[str]:
    """Return the issue codes of a result, in order."""
    return [i.code for i in result.issues]


# ---------------------------------------------------------------------------
# Sample identity and specimen blocks
# ---------------------------------------------------------------------------


def test_sample_identity_comes_from_the_dump_header() -> None:
    """The sample header names the test type, job, borehole, sample number and
    sampling depth — the dump carries one sample, several specimens."""
    r = TriaxialRawDumpParser().parse(_CD)
    assert r.test_type == "CD"
    assert r.job_number == "GEO-25/022"
    assert r.borehole_name == "B17"
    assert r.sequence_number == "N003"
    assert r.sample_number == "25/0389"
    assert r.depth_top_m == pytest.approx(5.00)
    assert r.depth_base_m == pytest.approx(5.50)
    assert r.visual_description == "glauconieth. zand"


def test_every_specimen_block_comes_out_with_every_measuring_point() -> None:
    """cd.txt holds three specimens (a, b, c) of 1130 / 1139 / 1133 points;
    the first point is the lab's chosen zero reading (60 / 51 / 57)."""
    r = TriaxialRawDumpParser().parse(_CD)
    assert [s.specimen_id for s in r.specimens] == ["a", "b", "c"]
    assert [len(s.point_numbers) for s in r.specimens] == [1130, 1139, 1133]
    assert [s.point_numbers[0] for s in r.specimens] == [60, 51, 57]


def test_specimen_metadata_is_passed_through() -> None:
    """Initial dimensions, strain rate and consolidation data per specimen come
    out as the lab reported them."""
    a = TriaxialRawDumpParser().parse(_CD).specimens[0]
    assert a.initial_height_mm == pytest.approx(88.1)
    assert a.initial_diameter_mm == pytest.approx(38.1)
    assert a.initial_wet_mass_g == pytest.approx(188.110)
    assert a.strain_rate_mm_per_min == pytest.approx(0.020)
    assert a.consolidation_stress_kpa == pytest.approx(96.1)
    assert a.consolidation_volume_change_cm3 == pytest.approx(-1.789)
    assert a.press_id == "PE-GDS-Aai2-14671"
    assert a.calibration_file == "Normalised"


# ---------------------------------------------------------------------------
# Measured vs lab-derived channels
# ---------------------------------------------------------------------------


def test_measured_channels_are_kept_apart_from_lab_derived_channels() -> None:
    """Force, displacement, cell pressure, pore pressure and volume change are
    the machine's measurements; strain and the stress columns are what the lab
    software derived — the specimen keeps the two sets separate."""
    a = TriaxialRawDumpParser().parse(_CD).specimens[0]
    assert set(a.measured) == {
        "force_n",
        "displacement_um",
        "cell_pressure_kpa",
        "pore_pressure_kpa",
        "volume_change_cm3",
    }
    assert set(a.lab_derived) == {
        "axial_strain_pct",
        "deviator_stress_kpa",
        "sigma3_eff_kpa",
        "sigma1_eff_kpa",
    }
    assert a.measured["force_n"][1] == pytest.approx(3.277802)
    assert a.measured["displacement_um"][1] == pytest.approx(10.0)
    assert a.measured["cell_pressure_kpa"][0] == pytest.approx(595.4404)
    assert a.lab_derived["axial_strain_pct"][1] == pytest.approx(1.142367e-02)


def test_undrained_dump_has_no_volume_channel_but_total_stress_columns() -> None:
    """A CU dump carries no dV column; it carries total stresses and the two
    stress ratios instead."""
    a = TriaxialRawDumpParser().parse(_CU).specimens[0]
    assert "volume_change_cm3" not in a.measured
    assert {
        "sigma3_total_kpa",
        "sigma1_total_kpa",
        "eff_stress_ratio",
        "total_stress_ratio",
    } <= set(a.lab_derived)


def test_uu_dump_drops_the_blank_effective_stress_columns() -> None:
    """The UU dump prints blank header slots where the effective stresses would
    sit; those empty columns are not returned as channels."""
    r = TriaxialRawDumpParser().parse(_ADV_UU)
    assert r.test_type == "UU"
    [a] = r.specimens
    assert len(a.point_numbers) == 399
    assert "sigma3_eff_kpa" not in a.lab_derived
    assert "sigma3_total_kpa" in a.lab_derived


def test_every_channel_has_one_value_per_measuring_point() -> None:
    """All channels of a specimen are the same length as its point list."""
    for path in (_CD, _CU, _ADV_CD, _ADV_CU, _ADV_UU):
        for s in TriaxialRawDumpParser().parse(path).specimens:
            n = len(s.point_numbers)
            assert all(len(v) == n for v in s.measured.values())
            assert all(len(v) == n for v in s.lab_derived.values())


# ---------------------------------------------------------------------------
# Findings the parser reports
# ---------------------------------------------------------------------------


def test_missing_specimen_letter_is_reported() -> None:
    """The Advanced-TX CD dump carries specimens a and c only (the listing says
    one of three was set inactive) — the gap is reported as INFO."""
    r = TriaxialRawDumpParser().parse(_ADV_CD)
    assert [s.specimen_id for s in r.specimens] == ["a", "c"]
    gap = [i for i in r.issues if i.code == "SPECIMEN_LETTER_GAP"]
    assert gap and gap[0].level == ValidationLevel.INFO


def test_deviator_offset_at_zero_force_is_flagged_on_cu_dumps() -> None:
    """Every CU specimen starts with sigma1-3 = -10 kPa at zero force (a lab
    correction applied from the first point); this is flagged, and the CD
    dump — which starts at 0 — is not."""
    for path in (_CU, _ADV_CU):
        offsets = [
            i
            for i in TriaxialRawDumpParser().parse(path).issues
            if i.code == "DEVIATOR_OFFSET_AT_ZERO_FORCE"
        ]
        assert offsets and all(i.level == ValidationLevel.WARNING for i in offsets)
    assert "DEVIATOR_OFFSET_AT_ZERO_FORCE" not in _codes(TriaxialRawDumpParser().parse(_CD))


def test_strain_offset_at_zero_displacement_is_flagged() -> None:
    """Specimen b of cu.txt reports -0.38 % strain at zero displacement — the
    strain column is not the displacement over the height there."""
    r = TriaxialRawDumpParser().parse(_CU)
    hits = [i for i in r.issues if i.code == "STRAIN_OFFSET_AT_ZERO_DISPLACEMENT"]
    assert len(hits) == 1 and "specimen b" in hits[0].message


def test_absent_time_channel_and_cut_pre_zero_readings_are_reported() -> None:
    """No dump carries a time column (INFO on every file); cd.txt starts each
    specimen at the chosen zero reading, so earlier readings are not in the
    file (INFO)."""
    for path in (_CD, _CU, _ADV_CD, _ADV_CU, _ADV_UU):
        assert "NO_TIME_CHANNEL" in _codes(TriaxialRawDumpParser().parse(path))
    assert "READINGS_BEFORE_ZERO_NOT_IN_FILE" in _codes(TriaxialRawDumpParser().parse(_CD))
    assert "READINGS_BEFORE_ZERO_NOT_IN_FILE" not in _codes(TriaxialRawDumpParser().parse(_ADV_UU))


def test_displacement_never_steps_back_on_the_real_dumps() -> None:
    """Displacement is non-decreasing on every real specimen — no
    ``DISPLACEMENT_NOT_MONOTONIC`` finding."""
    for path in (_CD, _CU, _ADV_CD, _ADV_CU, _ADV_UU):
        assert "DISPLACEMENT_NOT_MONOTONIC" not in _codes(TriaxialRawDumpParser().parse(path))


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_text_without_specimen_block_raises_parse_error() -> None:
    """A text with a sample header but no ``Identificatiegegevens deelmonster``
    block is not a triaxial dump."""
    with pytest.raises(ParseError):
        TriaxialRawDumpParser().parse_text(
            "Gegevens van het monster\nType proef:\t\t\t\tCD\n", source_name="x.txt"
        )


def test_specimen_without_point_table_raises_parse_error() -> None:
    """A specimen block with no ``Meetpunt`` table carries no raw data."""
    text = (
        "Gegevens van het monster\nType proef:\t\t\t\tCD\n\n"
        "Identificatiegegevens deelmonster \ta\nOorspronkelijke hoogte:\t\t\t88,1 mm\n"
    )
    with pytest.raises(ParseError):
        TriaxialRawDumpParser().parse_text(text, source_name="x.txt")


def test_unreadable_value_in_the_table_is_an_error_finding() -> None:
    """A non-numeric cell in the point table is reported as an ERROR with the
    line, and the cell becomes None rather than crashing the parse."""
    lines = _ADV_UU.read_bytes().decode("latin-1").splitlines()
    i = next(k for k, ln in enumerate(lines) if ln.startswith("Meetpunt")) + 3
    lines[i] = lines[i][:18] + "garbage".ljust(18) + lines[i][36:]
    r = TriaxialRawDumpParser().parse_text("\n".join(lines), source_name="bad.txt")
    bad = [x for x in r.issues if x.code == "UNREADABLE_VALUE"]
    assert bad and bad[0].level == ValidationLevel.ERROR
    assert r.specimens[0].measured["force_n"][2] is None


# ---------------------------------------------------------------------------
# Near-miss guards: each sequence check fires when its input is tampered
# ---------------------------------------------------------------------------


def _uu_lines() -> tuple[list[str], int]:
    """Return the UU dump lines and the index of its first table row."""
    lines = _ADV_UU.read_bytes().decode("latin-1").splitlines()
    return lines, next(k for k, ln in enumerate(lines) if ln.startswith("Meetpunt")) + 1


def test_displacement_stepping_back_is_flagged() -> None:
    """A row whose displacement is below its predecessor's is flagged."""
    lines, first = _uu_lines()
    row = lines[first + 5]
    lines[first + 5] = row[:36] + "1".ljust(18) + row[54:]
    r = TriaxialRawDumpParser().parse_text("\n".join(lines), source_name="t.txt")
    assert "DISPLACEMENT_NOT_MONOTONIC" in _codes(r)


def test_a_missing_measuring_point_is_flagged() -> None:
    """Dropping one table row breaks the point-number sequence."""
    lines, first = _uu_lines()
    del lines[first + 5]
    r = TriaxialRawDumpParser().parse_text("\n".join(lines), source_name="t.txt")
    assert "POINT_NUMBER_GAP" in _codes(r)
