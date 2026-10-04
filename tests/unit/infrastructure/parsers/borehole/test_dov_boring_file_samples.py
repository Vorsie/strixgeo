"""Samples (``<monster>``) in a local DOV borehole XML file.

Rule (brief 2026-10-04): a sample in the file is imported with its boring —
depth interval, sample number, description, its DOV permkey — and a grain-size
curve the file carries inline is read with the SAME parser the bbox import
uses. Nothing is dropped silently: a sample without a depth interval, a sample
naming a boring the file does not hold, and lab observations other than a
grain-size curve are each flagged.

None of the owner's five real files carries a sample, so the sample path runs
on a SYNTHETIC file whose ``<monster>`` shape is copied from a live DOV
download (see the fixture's header comment).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parser import (
    DovBoringFileParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

TESTS = Path(__file__).resolve().parents[4]
SYNTHETIC = TESTS / "fixtures" / "dov_boring_files_synthetic" / "boring_met_monsters.xml"
REAL = TESTS / "fixtures" / "dov_boring_files"
TODAY = date(2026, 10, 4)


def _parse():
    return DovBoringFileParser().parse(SYNTHETIC.read_bytes(), name=SYNTHETIC.name, today=TODAY)


def _flags(entry, code: str):
    return [i for i in entry.issues if i.code == code]


def test_a_sample_with_a_depth_interval_is_kept_with_its_boring():
    """Happy path: sample 1 (linked by permkey) carries every field the file gives."""
    [entry] = _parse().borings
    by_number = {s.sample_number: s for s in entry.samples}
    s1 = by_number["1"]
    assert s1.permkey == "2025-M1"
    assert (s1.depth_top_m, s1.depth_base_m) == (2.0, 2.5)
    assert s1.description == "grijze klei met schelpen"
    # Raw DOV tokens: the last segment of the codelist URI, as the WFS writes it.
    assert s1.sample_type == "ongeroerd"
    assert s1.instrument == "steekbuis"
    assert s1.composition == "Enkelvoudig monster"
    assert s1.sampling_date == date(2025, 6, 14)


def test_a_sample_linked_by_boring_name_only_attaches_and_a_missing_base_is_a_spot_sample():
    """Boundary: no permkey on bemonsterdObject → the identificatie links it; tot absent → top."""
    [entry] = _parse().borings
    s2 = {s.sample_number: s for s in entry.samples}["2"]
    assert s2.permkey is None
    assert (s2.depth_top_m, s2.depth_base_m) == (4.0, 4.0)
    assert s2.sample_type == "geroerd"


def test_a_sample_without_a_depth_interval_is_flagged_and_not_kept():
    """Near miss: sample 3 has no bemonsteringsplaats → SAMPLE_WITHOUT_DEPTH, not imported."""
    [entry] = _parse().borings
    assert "3" not in {s.sample_number for s in entry.samples}
    [flag] = _flags(entry, "SAMPLE_WITHOUT_DEPTH")
    assert flag.level == ValidationLevel.WARNING
    assert flag.params == {"sample": "3"}


def test_a_sample_for_a_boring_not_in_the_file_is_a_file_level_warning():
    """Sample 7 names ELDERS-B9 → file-level SAMPLE_WITHOUT_BORING, never silently dropped."""
    result = _parse()
    [flag] = [i for i in result.issues if i.code == "SAMPLE_WITHOUT_BORING"]
    assert flag.level == ValidationLevel.WARNING
    assert flag.params == {"file": SYNTHETIC.name, "sample": "7", "boring": "ELDERS-B9"}
    assert "7" not in {s.sample_number for s in result.borings[0].samples}


def test_samples_present_is_an_info_flag_with_the_counts():
    """SAMPLES_PRESENT names how many samples come in and how many grain-size curves."""
    [entry] = _parse().borings
    [flag] = _flags(entry, "SAMPLES_PRESENT")
    assert flag.level == ValidationLevel.INFO
    assert flag.params == {"count": 2, "grain_size": 1}


def test_an_inline_grain_size_curve_is_read_with_the_bbox_parser_for_its_sample():
    """The observatie naming sample 2025-M1 becomes that sample's grain-size curve."""
    [entry] = _parse().borings
    s1 = {s.sample_number: s for s in entry.samples}["1"]
    [(permkey, curve)] = s1.grain_sizes
    assert permkey == "2025-O1"
    assert curve.grain_size.sample_id == s1.sample_key
    assert curve.grain_size.diameters_mm == [0.063, 0.25, 2.0]
    assert curve.grain_size.pct_larger == [95.0, 40.0, 0.0]
    assert curve.grain_size.method == "Zeving"


def test_other_lab_observations_are_flagged_not_dropped():
    """A water-content observatie is not read from a file yet: it is named, not lost."""
    [entry] = _parse().borings
    [flag] = _flags(entry, "SAMPLE_OBSERVATIONS_NOT_IMPORTED")
    assert flag.params == {"sample": "1", "count": 1, "parameters": ["Watergehalte"]}


@pytest.mark.parametrize("path", sorted(REAL.glob("*.xml")), ids=lambda p: p.name)
def test_the_owners_real_files_carry_no_sample(path):
    """Guard: the five real files hold no <monster>, so no sample and no sample flag appears."""
    result = DovBoringFileParser().parse(path.read_bytes(), name=path.name, today=TODAY)
    for entry in result.borings:
        assert entry.samples == []
        assert not [i for i in entry.issues if i.code.startswith("SAMPLE")]
