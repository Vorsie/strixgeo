"""Tests for the pure NAD classifier (spec §5)."""

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
    """Sand + a qualifying clay admixture → secondary variant (spec §5 exact match); qc 8 → NAD 10."""
    admx = (Admixture(soil_code="KL", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 10


def test_gravelly_sand_is_not_a_variant_falls_to_clean():
    """A non-silt/clay admixture on sand has NO NAD variant → clean sand (NAD 6 at qc 8)."""
    admx = (Admixture(soil_code="GR", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 6


def test_sandy_clay_uses_secondary_variant():
    """Clay + a sand admixture (XZ = DOV zand code) → secondary variant (spec §5).

    qc 2.0 MPa is in the zandhoudend-klei matig-vast band [1.5, 3) → NAD 26.
    """
    admx = (Admixture(soil_code="XZ", amount="M"),)
    assert classify_nad("KLEI", admx, 2.0) == 26


def test_lithology_is_hard_truth_qc_never_changes_soil():
    """A clay at sand-like qc (12 MPa) stays clay — densest clay class, not sand."""
    assert classify_nad("KLEI", (), 12.0) == 24
