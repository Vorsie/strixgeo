"""The NAD reference manifest is a committed snapshot of the packing-class table.

``docs/reference/nad_reference_manifest.json`` freezes the 1–31 class names +
qc thresholds so a future edit to the classifier constants (or the Task T0 xlsx
swap) can't silently drift: any change must update the manifest too, or these
tests go RED. The manifest also carries owner-reconciliation fields (workbook
sha256 / sheet / row) that are filled when the table is verified against
Daniel's workbook — those are not asserted here.
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
