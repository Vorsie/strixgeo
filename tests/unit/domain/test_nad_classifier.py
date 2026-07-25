"""Tests for the pure NAD classifier (spec §5)."""

import pytest

from groundmodel.domain.services.nad_classifier import classify_nad
from groundmodel.domain.value_objects.admixture import Admixture


def test_clean_sand_band_selection():
    """qc 8 MPa clean sand → matig (NAD 6) per provisional bands (5–10)."""
    assert classify_nad("ZAND", (), 8.0) == 6


def test_clean_sand_densest_when_qc_above_all_bands():
    """qc above every band → densest clean-sand class (NAD 8)."""
    assert classify_nad("ZAND", (), 99.0) == 8


def test_clean_sand_loosest_when_qc_below_all_bands():
    """qc below the first band → nearest = loosest class (NAD 5). Lithology truth."""
    assert classify_nad("ZAND", (), 0.1) == 5


def test_silty_sand_uses_secondary_variant():
    """Sand + a qualifying clay admixture → secondary variant (spec §5); qc 8 → NAD 10."""
    admx = (Admixture(soil_code="KL", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 10


def test_loam_admixture_on_sand_is_silty_secondary():
    """Sand + a leem (LE) admixture → secondary variant (leem == silt geotech).

    qc 8 MPa → silt-/kleihoudend sand matig gp = NAD 10.
    """
    admx = (Admixture(soil_code="LE", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 10


def test_gravelly_sand_is_not_a_variant_falls_to_clean():
    """A non-silt/clay admixture on sand has NO NAD variant → clean sand (NAD 6 at qc 8)."""
    admx = (Admixture(soil_code="GR", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 6


def test_sandy_clay_uses_secondary_variant():
    """Clay + a sand admixture (XZ = DOV zand code) → secondary variant (spec §5).

    qc 2.0 MPa is in the zandhoudend-klei vrij-vast band [2, 4) → NAD 27 (ANB
    Tabel 2.1). The point of the test is that the SECONDARY range (25–28) is used,
    not the clean range (21–24).
    """
    admx = (Admixture(soil_code="XZ", amount="M"),)
    assert classify_nad("KLEI", admx, 2.0) == 27


def test_lithology_is_hard_truth_qc_never_changes_soil():
    """A clay at sand-like qc (12 MPa) stays clay — densest clay class, not sand."""
    assert classify_nad("KLEI", (), 12.0) == 24


# --- invalid-input safety (P0-4) --------------------------------------------
# Owner rule (2026-07-25): the classifier may NEVER turn missing/invalid qc into
# a plausible-but-wrong class. Bad numbers are rejected, not silently classified.
# A legitimate small positive qc (incl. 0.0, the borehole-only sentinel) stays
# valid and maps to the loosest class — only NaN / inf / negative are invalid.


def test_nan_qc_is_rejected_not_silently_classified_densest():
    """A NaN qc is invalid — reject it, never return the densest class.

    The old behaviour silently returned the densest class because ``NaN < x`` is
    always False, so the walk fell through to the open-topped densest band. That
    turns missing data into 'very dense' — exactly backwards for safety.
    """
    with pytest.raises(ValueError, match="qc"):
        classify_nad("ZAND", (), float("nan"))


def test_negative_qc_is_rejected_not_silently_classified_loosest():
    """A negative qc is physically impossible — reject it, don't silently call it loosest."""
    with pytest.raises(ValueError, match="qc"):
        classify_nad("ZAND", (), -5.0)


def test_infinite_qc_is_rejected():
    """An infinite qc is invalid — reject rather than classify densest."""
    with pytest.raises(ValueError, match="qc"):
        classify_nad("ZAND", (), float("inf"))


def test_zero_qc_stays_valid_and_maps_to_loosest():
    """qc 0.0 is the borehole-only fallback sentinel — it must stay valid → loosest class."""
    assert classify_nad("ZAND", (), 0.0) == 5


def test_unknown_soil_code_raises_clear_error_naming_the_soil():
    """An unrecognised soil is a data problem — raise a readable error naming the soil,
    never a raw KeyError and never a guessed class."""
    with pytest.raises(ValueError, match="ROCK"):
        classify_nad("ROCK", (), 5.0)  # type: ignore[arg-type]
