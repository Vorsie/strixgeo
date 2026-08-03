"""Tests for the pure NAD classifier (spec §5)."""

import pytest

from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS
from groundmodel.domain.services.nad_classifier import classify_nad
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BASE_LITHOLOGIES


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


def test_sandy_clay_via_zn_core_code_uses_secondary_variant():
    """Clay + the CORE sand admixture code ZN → secondary, same as XZ.

    ``ZN`` is the core "zand" bijmenging code (GL/ZN/SL/KL/VE); the UI offers it
    as "Sand (ZN)" and treats it as sandy, exactly like the generic ``XZ``. A
    zandhoudend clay must land in the secondary range (25–28), not clean (21–24).
    qc 2.0 → NAD 27. (Regression for the ZN-mis-classifies audit finding.)
    """
    admx = (Admixture(soil_code="ZN", amount="M"),)
    assert classify_nad("KLEI", admx, 2.0) == 27


def test_fine_sand_admixture_on_silt_uses_secondary_variant():
    """Silt + a fine-sand admixture (FZ) → zandhoudend silt = secondary.

    FZ/MZ/GZ are grain-size variants of sand; any sand admixture makes a fines
    soil sand-bearing. qc 1.5 → secondary-silt matig-vast band [1,2) → NAD 18
    (clean silt at the same qc would be NAD 14).
    """
    admx = (Admixture(soil_code="FZ", amount="M"),)
    assert classify_nad("SILT", admx, 1.5) == 18


def test_silt_admixture_via_ui_sl_code_makes_sand_secondary():
    """Sand + a UI "Silt (SL)" admixture → silt-/kleihoudend sand = secondary.

    The UI stores ``SL`` for a silt admixture; DOV uses ``SL`` for slib, but slib
    is rare (owner ruling 2026-07-26 — treat SL as silt for NAD). qc 8.0 →
    secondary-sand matig band → NAD 10 (clean sand at the same qc is NAD 6).
    """
    admx = (Admixture(soil_code="SL", amount="M"),)
    assert classify_nad("ZAND", admx, 8.0) == 10


def test_lithology_is_hard_truth_qc_never_changes_soil():
    """A clay at sand-like qc (12 MPa) stays clay — densest clay class, not sand."""
    assert classify_nad("KLEI", (), 12.0) == 24


# --- invalid-input safety (P0-4) --------------------------------------------
# Owner rule (2026-07-25): the classifier may NEVER turn missing/invalid qc into
# a plausible-but-wrong class. Bad numbers are rejected, not silently classified.
# A legitimate small positive qc (incl. a genuinely measured 0.0) stays valid
# and maps to the loosest class — only NaN / inf / negative are invalid.


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
    """A measured qc of 0.0 is physically valid — it must classify, not raise → loosest."""
    assert classify_nad("ZAND", (), 0.0) == 5


def test_unknown_soil_code_raises_clear_error_naming_the_soil():
    """An unrecognised soil is a data problem — raise a readable error naming the soil,
    never a raw KeyError and never a guessed class."""
    with pytest.raises(ValueError, match="ROCK"):
        classify_nad("ROCK", (), 5.0)  # type: ignore[arg-type]


# --- NAD_QC_BANDS table integrity ------------------------------------------
# Structural invariants the ascending-walk classifier relies on. A future edit
# to the threshold table (or the Task T0 xlsx swap) must preserve all of them,
# or classify_nad silently misclassifies. NAD_CLASSES structure is covered
# separately in test_litho_constants.py; this pins the qc-band table itself.


def test_every_band_column_ends_open_top():
    """Every (soil, variant) column ends with a ``(None, class)`` open-top band.

    classify_nad walks ascending bands and relies on the last entry having an
    open (``None``) upper so qc above every finite threshold always resolves to
    the densest class — the invariant documented at nad_classifier.py:80. A
    dropped ``None`` entry would fall through to the type-checker fallback and
    misclassify the densest band.
    """
    for key, bands in NAD_QC_BANDS.items():
        assert bands, f"{key}: empty band list"
        assert bands[-1][0] is None, f"{key}: last band must be open-top (None upper)"


def test_only_the_last_band_is_open_top():
    """No interior band has a ``None`` upper — an interior open bound would make
    the ascending walk short-circuit before reaching the denser bands."""
    for key, bands in NAD_QC_BANDS.items():
        for upper, _cls in bands[:-1]:
            assert upper is not None, f"{key}: only the last band may have a None upper"


def test_finite_thresholds_are_strictly_ascending():
    """Within each column the finite upper bounds strictly ascend, so the
    first-band-whose-upper-exceeds-qc walk is well defined."""
    for key, bands in NAD_QC_BANDS.items():
        finite = [upper for upper, _cls in bands if upper is not None]
        assert finite == sorted(set(finite)), f"{key}: thresholds not strictly ascending: {finite}"


def test_band_keys_are_valid_soil_and_variant():
    """Every column key is a (base lithology, clean|secondary) pair."""
    for soil, variant in NAD_QC_BANDS:
        assert soil in BASE_LITHOLOGIES, f"unknown soil in band key: {soil!r}"
        assert variant in ("clean", "secondary"), f"unknown variant in band key: {variant!r}"


def test_bands_cover_every_nad_class_1_to_31():
    """The qc table assigns every NAD packing class 1–31 (each class is reachable
    from some soil/variant/qc). VEEN clean and secondary intentionally share
    29–31, so classes may repeat across columns — coverage, not uniqueness."""
    classes = {cls for bands in NAD_QC_BANDS.values() for _upper, cls in bands}
    assert classes == set(range(1, 32)), f"NAD_QC_BANDS does not cover 1..31 exactly: {classes}"
