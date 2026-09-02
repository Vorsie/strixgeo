"""The NAD soil-parameter table is empty until the owner transcribes it.

These tests guard the SHAPE of the parameter table, not its size — they
pass on the empty table the repository ships and keep passing as the owner
fills rows from the workbook "Correlaties uit S en NAD_NEN_v2.xlsx"
(NEN 9997-1 Tabel 2.b characteristic values). What they refuse is a row
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

    Transcribed 2026-09-02 from the owner's workbook (sheet NAD-NEN, rows per the
    reference manifest); a missing or surplus class here means the transcript
    and the classifier drifted apart.
    """
    assert set(NAD_SOIL_PARAMETERS) == set(NAD_CLASSES), sorted(
        set(NAD_SOIL_PARAMETERS) ^ set(NAD_CLASSES)
    )


def test_undrained_strength_is_absent_for_granular_and_present_for_cohesive() -> None:
    """The workbook carries a dash for cu on every GRIND / ZAND row (classes
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
    assert "NAD" in SOURCE_LABEL and "2.b" in SOURCE_LABEL
