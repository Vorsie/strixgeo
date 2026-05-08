"""Unit tests for the GrainSize lab test."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.lab.grain_size import GrainSize


class TestGrainSizeConstruction:
    def test_minimal_construction(self) -> None:
        gs = GrainSize(sample_id=uuid4())
        assert gs.diameters_mm == []
        assert gs.pct_larger == []
        assert gs.method is None
        assert gs.lime_removed is None

    def test_real_dov_sieve_curve(self) -> None:
        # Real curve from the example we probed (monster 2017-137886, sieve test):
        # diameters in mm, pct_larger = "Fractie met grotere diameter" from DOV
        gs = GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.063, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0],
            pct_larger=[95.0, 87.0, 45.0, 8.0, 3.0, 1.0, 0.0],
            method="Zeving",
            lime_removed=False,
            organics_removed=False,
        )
        assert len(gs.diameters_mm) == 7
        assert gs.pct_larger[0] == 95.0
        assert gs.method == "Zeving"

    def test_hydrometer_method_accepted(self) -> None:
        # DOV ``methode`` for hydrometer/areometer test.
        gs = GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.001, 0.002, 0.005, 0.02, 0.063],
            pct_larger=[100.0, 95.0, 80.0, 50.0, 20.0],
            method="Hydrometer",
        )
        assert gs.method == "Hydrometer"

    def test_laser_diffraction_method_accepted(self) -> None:
        # DOV ``methode`` for laser-diffraction analyser.
        gs = GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.001, 0.01, 0.1, 1.0],
            pct_larger=[99.0, 80.0, 30.0, 5.0],
            method="D.m.v. Laserdiffractie",
        )
        assert gs.method == "D.m.v. Laserdiffractie"

    def test_pipette_method_accepted(self) -> None:
        # DOV ``methode`` for pipette method (Stokes-law sedimentation read
        # by pipetting at calibrated times).
        gs = GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.001, 0.005, 0.02, 0.063],
            pct_larger=[100.0, 90.0, 60.0, 25.0],
            method="Pipette",
        )
        assert gs.method == "Pipette"

    def test_sedigraph_method_accepted(self) -> None:
        # DOV ``methode`` for X-ray sedimentation analyser.
        gs = GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.001, 0.005, 0.02, 0.063],
            pct_larger=[100.0, 92.0, 65.0, 30.0],
            method="Sedigraaf",
        )
        assert gs.method == "Sedigraaf"

    def test_hybrid_method_string_accepted(self) -> None:
        # DOV occasionally ships method-specific variants combining the
        # method name with calibration / scope info. The field accepts
        # any string — translation at presentation.
        gs = GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.001, 0.063],
            pct_larger=[100.0, 90.0],
            method="Hydrometer met ijking Geotechniek",
        )
        assert gs.method == "Hydrometer met ijking Geotechniek"


class TestGrainSizeValidation:
    def test_array_length_mismatch_rejected(self) -> None:
        with pytest.raises(ValueError, match="length mismatch"):
            GrainSize(
                sample_id=uuid4(),
                diameters_mm=[0.063, 0.125],
                pct_larger=[95.0],
            )

    def test_percentage_above_100_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            GrainSize(
                sample_id=uuid4(),
                diameters_mm=[0.063],
                pct_larger=[101.0],
            )

    def test_negative_percentage_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            GrainSize(
                sample_id=uuid4(),
                diameters_mm=[0.063],
                pct_larger=[-1.0],
            )

    def test_non_ascending_diameters_rejected(self) -> None:
        with pytest.raises(ValueError, match="strictly ascending"):
            GrainSize(
                sample_id=uuid4(),
                diameters_mm=[0.125, 0.063],
                pct_larger=[87.0, 95.0],
            )

    def test_duplicate_diameters_rejected(self) -> None:
        with pytest.raises(ValueError, match="strictly ascending"):
            GrainSize(
                sample_id=uuid4(),
                diameters_mm=[0.063, 0.063],
                pct_larger=[95.0, 95.0],
            )
