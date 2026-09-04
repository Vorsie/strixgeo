"""The NAD reference manifest is a committed snapshot of the packing-class table.

``docs/reference/nad_reference_manifest.json`` freezes the 1–31 class names +
qc thresholds so a future edit to the classifier constants (or the Task T0 xlsx
swap) can't silently drift: any change must update the manifest too, or these
tests go RED. The manifest also carries owner-reconciliation fields (workbook
sha256 / sheet / row) that are filled when the table is verified against
the transcription sheet — those are not asserted here.
"""

from __future__ import annotations

import json
from pathlib import Path

from groundmodel.domain.services.nad_classification_constants import NAD_QC_BANDS
from groundmodel.shared.constants.litho_constants import NAD_CLASSES

_MANIFEST_PATH = (
    Path(__file__).resolve().parents[4] / "docs" / "reference" / "nad_reference_manifest.json"
)


def _load() -> dict:
    return json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))


def test_manifest_exists_and_covers_classes_1_to_31() -> None:
    """The committed manifest lists every NAD class 1..31, in order."""
    assert _MANIFEST_PATH.exists(), f"missing NAD reference manifest at {_MANIFEST_PATH}"
    classes = _load()["classes"]
    assert [c["class"] for c in classes] == list(range(1, 32))


def test_manifest_names_and_families_match_nad_classes() -> None:
    """Each manifest row's name + family match the live NAD_CLASSES table."""
    for row in _load()["classes"]:
        name, base = NAD_CLASSES[row["class"]]
        assert row["name"] == name, f"class {row['class']}: manifest name drifted from code"
        assert row["family"] == base, f"class {row['class']}: manifest family drifted from code"


def test_manifest_thresholds_match_nad_qc_bands() -> None:
    """Every (family, class, qc_upper) in NAD_QC_BANDS is reflected in the manifest.

    A threshold edit to the code that doesn't update the manifest fails here — the
    whole point of the committed reference. VEEN clean == secondary shares classes
    29–31 with identical thresholds, so a class may appear in two columns; the
    manifest snapshots one, and the assertion (family + qc_upper) holds for both.
    """
    by_class = {row["class"]: row for row in _load()["classes"]}
    for (soil, _variant), bands in NAD_QC_BANDS.items():
        for upper, cls in bands:
            row = by_class[cls]
            assert row["family"] == soil, f"class {cls}: manifest family {row['family']} != {soil}"
            assert row["qc_upper_mpa"] == upper, (
                f"class {cls}: manifest qc_upper {row['qc_upper_mpa']} != code {upper} "
                "— update docs/reference/nad_reference_manifest.json when the thresholds change"
            )


def test_every_workbook_characteristic_qc_classifies_to_its_own_class() -> None:
    """WB1 — the classifier against the TRANSCRIBED TABLE, never code against code.

    Audit F30's finding was that the strongest classifier test compared the
    implementation to a transcription OF the implementation. The manifest now
    carries each class's characteristic qc as read from the NBN EN 1997-1 ANB transcription sheet
    (the NBN EN 1997-1 ANB Tabel 2.1 transcription sheet, sha256 in _meta) —
    values the code never contained — and every one must classify back to its
    own class. A mis-typed threshold that shifts any band edge past a
    characteristic value goes RED here, whichever copy drifted.

    Verified against the printed NBN EN 1997-1 ANB Tabel 2.1 on 2026-08-11
    (owner-supplied): zand 2/4/10/15, leem+klei 0.4/1/2/4, veen 0.2/0.5/1,
    grind 10/20 — all matching the shipped constants.
    """
    from groundmodel.domain.services.nad_classifier import classify_nad
    from groundmodel.domain.value_objects.admixture import Admixture

    manifest = _load()
    assert manifest["_meta"]["verified_against_workbook"] is True
    for row in manifest["classes"]:
        soil = row["family"]
        admixtures = (
            (
                Admixture(
                    soil_code="SI" if soil in ("GRIND", "ZAND") else "ZN",
                    amount=None,
                    locally=False,
                ),
            )
            if row["variant"] == "secondary"
            else ()
        )
        got = classify_nad(soil, admixtures, row["characteristic_qc_mpa"])
        assert got == row["class"], (
            f"workbook row {row['workbook_row']}: characteristic qc "
            f"{row['characteristic_qc_mpa']} MPa classifies to {got}, not {row['class']}"
        )


def test_open_band_boundaries_are_inclusive_as_the_norm_prints_them() -> None:
    """WB2 — the norm writes ``qc >= X`` for every open band; so does the code.

    Audit F20 asked whether the table's ``>`` shorthand meant the boundary
    value belongs to the looser class. The printed ANB Tabel 2.1 answers: the
    norm's own marker is ``>=`` (zand zeer dicht ``qc >= 15``, grind dicht
    ``qc >= 20``, leem/klei vast ``qc >= 4``, veen vast ``qc >= 1``), so a qc
    exactly on the mark is the DENSER class — the reading the classifier has
    always had, now pinned against the source rather than assumed.
    """
    from groundmodel.domain.services.nad_classifier import classify_nad

    assert classify_nad("ZAND", (), 15.0) == 8
    assert classify_nad("GRIND", (), 20.0) == 2
    assert classify_nad("SILT", (), 4.0) == 16
    assert classify_nad("KLEI", (), 4.0) == 24
    assert classify_nad("VEEN", (), 1.0) == 31
