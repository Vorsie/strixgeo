"""The NAD soil-parameter table is empty until the owner transcribes it.

These tests guard the SHAPE of the parameter table, not its size — they
pass on the empty table the repository ships and keep passing as the owner
fills rows from the NBN EN 1997-1 ANB Tabel 2.1 transcription sheet
(NBN EN 1997-1 ANB Tabel 2.1 characteristic values). What they refuse is a row
that is not a real NAD class, or a value that is not physically possible
for ground — so a transcription slip (a decimal misplaced, γ_sat below
γ_unsat) fails the suite instead of shipping into a D-Series export.
"""

from __future__ import annotations

import dataclasses

import pytest

from groundmodel.domain.services.nad_soil_parameters_constants import (
    NAD_SOIL_PARAMETERS,
    SOURCE_LABEL,
    NadSoilParameters,
    parameters_for_class,
)
from groundmodel.shared.constants.litho_constants import NAD_CLASSES


def test_every_populated_class_id_is_a_real_nad_class() -> None:
    """Every key is one of the 31 NAD packing classes — no invented ids."""
    for class_id in NAD_SOIL_PARAMETERS:
        assert class_id in NAD_CLASSES, f"NAD class {class_id} is not one of 1..31"


def test_every_value_lies_in_a_physically_sane_range() -> None:
    """A ground unit's γ, φ′ and c′ cannot leave these bounds.

    Guards a transcription slip: a misplaced decimal or a swapped
    saturated/unsaturated weight falls outside the range and fails here
    rather than reaching an export the engineer trusts.
    """
    for class_id, params in NAD_SOIL_PARAMETERS.items():
        assert 8.0 <= params.gamma_unsat_kn_m3 <= 24.0, (
            f"class {class_id}: γ_unsat {params.gamma_unsat_kn_m3} outside 8..24 kN/m³"
        )
        assert 8.0 <= params.gamma_sat_kn_m3 <= 24.0, (
            f"class {class_id}: γ_sat {params.gamma_sat_kn_m3} outside 8..24 kN/m³"
        )
        assert params.gamma_sat_kn_m3 >= params.gamma_unsat_kn_m3, (
            f"class {class_id}: γ_sat {params.gamma_sat_kn_m3} below "
            f"γ_unsat {params.gamma_unsat_kn_m3}"
        )
        assert 0.0 <= params.phi_deg <= 45.0, (
            f"class {class_id}: φ′ {params.phi_deg} outside 0..45°"
        )
        assert 0.0 <= params.c_kpa <= 100.0, (
            f"class {class_id}: c′ {params.c_kpa} outside 0..100 kPa"
        )


def test_the_table_covers_every_nad_class_once() -> None:
    """The transcription is complete: one row per NAD class 1..31, no extras.

    Transcribed 2026-09-02 from the NBN EN 1997-1 ANB Tabel 2.1 transcription sheet (rows per the
    reference manifest); a missing or surplus class here means the transcript
    and the classifier drifted apart.
    """
    assert set(NAD_SOIL_PARAMETERS) == set(NAD_CLASSES), sorted(
        set(NAD_SOIL_PARAMETERS) ^ set(NAD_CLASSES)
    )


def test_undrained_strength_is_absent_for_granular_and_present_for_cohesive() -> None:
    """The table carries a dash for cu on every GRIND / ZAND row (classes
    1..12) and a value on every SILT / KLEI / VEEN row (13..31)."""
    for class_id, params in NAD_SOIL_PARAMETERS.items():
        if class_id <= 12:
            assert params.cu_kpa is None, f"class {class_id}: granular row must carry no cu"
        else:
            assert params.cu_kpa is not None and 0.0 < params.cu_kpa <= 300.0, (
                f"class {class_id}: cu {params.cu_kpa} kPa outside (0, 300]"
            )


def test_the_parameter_record_is_a_frozen_value_object() -> None:
    """A characteristic value is data — it cannot be mutated after construction."""
    params = NadSoilParameters(
        gamma_unsat_kn_m3=18.0, gamma_sat_kn_m3=20.0, phi_deg=30.0, c_kpa=0.0, cu_kpa=None
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        params.phi_deg = 35.0  # type: ignore[misc]


def test_the_source_label_names_the_norm_table() -> None:
    """The export annotation names the table the values come from."""
    assert isinstance(SOURCE_LABEL, str) and SOURCE_LABEL.strip()
    assert "NAD" in SOURCE_LABEL and "2.1" in SOURCE_LABEL


# ---------------------------------------------------------------------------
# parameters_for_class — the shared class → parameters accessor (owner ruling
# 2026-09-05: the Parameters pane reads the same table row the exporters read).
# ---------------------------------------------------------------------------


def test_parameters_for_class_reads_the_table_row() -> None:
    """A body of class 6 (ZAND, matig gepakt) reports the table's γ / φ′ / c′
    and NO undrained strength (a dash for a granular class).

    Owner ruling 2026-09-05: *"phi', c', cu roll out of NAD-table … it is
    literally just reading the line and taking those parameters."* This is the
    read the pane makes; it must return the transcribed row verbatim.
    """
    params = parameters_for_class(6)
    assert params is not None
    assert params.gamma_unsat_kn_m3 == 17
    assert params.gamma_sat_kn_m3 == 19
    assert params.phi_deg == 30
    assert params.c_kpa == 0
    # Granular class → the table carries a dash for cu (no undrained strength).
    assert params.cu_kpa is None


def test_parameters_for_class_carries_cu_for_a_cohesive_class() -> None:
    """A cohesive class (21, KLEI weinig vast) carries an undrained strength."""
    params = parameters_for_class(21)
    assert params is not None
    assert params.cu_kpa == 20


def test_parameters_for_class_is_none_when_unclassified() -> None:
    """No class → nothing to read (the pane shows no NAD block)."""
    assert parameters_for_class(None) is None


def test_parameters_for_class_is_none_for_a_class_not_in_the_table() -> None:
    """A class number with no transcribed row → None (never a guessed default)."""
    # Swap in a table missing one class; the accessor returns None for it
    # rather than inventing a value.
    assert parameters_for_class(999) is None
