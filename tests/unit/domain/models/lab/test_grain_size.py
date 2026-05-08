"""Unit tests for the GrainSize lab test."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.lab.grain_size import GrainSize


class TestGrainSizeConstruction:
    def test_minimal_construction(self) -> None:
        gs = GrainSize(sample_id=uuid4())
        assert gs.sieve_diameters_mm == []
        assert gs.pct_retained == []
        assert gs.method is None
        assert gs.lime_removed is None

    def test_real_dov_curve(self) -> None:
        # Real curve from the example we probed (monster 2017-137886, sieve test):
        # diameters in mm, % retained = "Fractie met grotere diameter" from DOV
        gs = GrainSize(
            sample_id=uuid4(),
            sieve_diameters_mm=[0.063, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0],
            pct_retained=[95.0, 87.0, 45.0, 8.0, 3.0, 1.0, 0.0],
            method="Zeving",
            lime_removed=False,
            organics_removed=False,
        )
        assert len(gs.sieve_diameters_mm) == 7
        assert gs.pct_retained[0] == 95.0
        assert gs.method == "Zeving"


class TestGrainSizeValidation:
    def test_array_length_mismatch_rejected(self) -> None:
        with pytest.raises(ValueError, match="length mismatch"):
            GrainSize(
                sample_id=uuid4(),
                sieve_diameters_mm=[0.063, 0.125],
                pct_retained=[95.0],
            )

    def test_percentage_above_100_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            GrainSize(
                sample_id=uuid4(),
                sieve_diameters_mm=[0.063],
                pct_retained=[101.0],
            )

    def test_negative_percentage_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            GrainSize(
                sample_id=uuid4(),
                sieve_diameters_mm=[0.063],
                pct_retained=[-1.0],
            )

    def test_non_ascending_diameters_rejected(self) -> None:
        with pytest.raises(ValueError, match="strictly ascending"):
            GrainSize(
                sample_id=uuid4(),
                sieve_diameters_mm=[0.125, 0.063],
                pct_retained=[87.0, 95.0],
            )

    def test_duplicate_diameters_rejected(self) -> None:
        with pytest.raises(ValueError, match="strictly ascending"):
            GrainSize(
                sample_id=uuid4(),
                sieve_diameters_mm=[0.063, 0.063],
                pct_retained=[95.0, 95.0],
            )
