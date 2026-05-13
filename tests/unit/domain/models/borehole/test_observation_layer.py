"""Unit tests for the ObservationLayer entity."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.admixture import Admixture


class TestObservationLayerConstruction:
    def test_lithology_layer(self) -> None:
        obs_id = uuid4()
        layer = ObservationLayer(
            observation_id=obs_id,
            top_m=0.0,
            base_m=0.5,
            color="groenbruin",
            main_soil_codes=["FZ"],
            admixtures=[Admixture(soil_code="KL", amount="Z")],
            layer_index=0,
        )
        assert layer.observation_id == obs_id
        assert layer.color == "groenbruin"
        assert layer.main_soil_codes == ["FZ"]
        assert len(layer.admixtures) == 1
        assert layer.description is None
        assert layer.id is not None

    def test_stratigraphy_layer(self) -> None:
        layer = ObservationLayer(
            observation_id=uuid4(),
            top_m=3.0,
            base_m=8.5,
            description="HyEg - Lid van Egem (Formatie van Hyon)",
            layer_index=2,
        )
        assert layer.description == "HyEg - Lid van Egem (Formatie van Hyon)"
        assert layer.color is None
        assert layer.main_soil_codes == []
        assert layer.admixtures == []

    def test_multiple_main_soils(self) -> None:
        # DOV's <hoofdnaam> can repeat — XZ + KL means equally-dominant
        layer = ObservationLayer(
            observation_id=uuid4(),
            top_m=16.0,
            base_m=18.0,
            main_soil_codes=["XZ", "KL"],
        )
        assert layer.main_soil_codes == ["XZ", "KL"]


class TestObservationLayerValidation:
    def test_negative_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="top_m cannot be negative"):
            ObservationLayer(observation_id=uuid4(), top_m=-0.1, base_m=1.0)

    def test_base_equal_top_constructs_successfully(self) -> None:
        # Cross-field invariant lives in the parser per debt #15 +
        # CLAUDE.md Data Integrity §5 — DovInterpretationParser emits
        # a ValidationIssue for inverted intervals before construction.
        layer = ObservationLayer(observation_id=uuid4(), top_m=1.0, base_m=1.0)
        assert layer.top_m == layer.base_m

    def test_base_below_top_constructs_successfully(self) -> None:
        layer = ObservationLayer(observation_id=uuid4(), top_m=2.0, base_m=1.0)
        assert layer.top_m == 2.0
        assert layer.base_m == 1.0

    def test_negative_layer_index_rejected(self) -> None:
        with pytest.raises(ValueError, match="layer_index cannot be negative"):
            ObservationLayer(observation_id=uuid4(), top_m=0.0, base_m=1.0, layer_index=-1)
