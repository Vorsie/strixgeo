"""Unit tests for the FieldLogInterval value object."""

import pytest

from groundmodel.domain.models.borehole.field_log_interval import FieldLogInterval
from groundmodel.domain.value_objects.field_log_kind import FieldLogKind


class TestFieldLogIntervalConstruction:
    def test_color_interval(self) -> None:
        interval = FieldLogInterval(
            top_m=0.0, base_m=1.5, kind=FieldLogKind.COLOR, value="groenbruin"
        )
        assert interval.kind is FieldLogKind.COLOR
        assert interval.value == "groenbruin"

    def test_moisture_interval(self) -> None:
        interval = FieldLogInterval(
            top_m=4.5, base_m=8.5, kind=FieldLogKind.MOISTURE, value="verzadigd"
        )
        assert interval.kind is FieldLogKind.MOISTURE

    def test_consistency_interval(self) -> None:
        interval = FieldLogInterval(
            top_m=6.0, base_m=7.0, kind=FieldLogKind.CONSISTENCY, value="plastisch"
        )
        assert interval.kind is FieldLogKind.CONSISTENCY

    def test_is_frozen(self) -> None:
        interval = FieldLogInterval(top_m=0.0, base_m=1.0, kind=FieldLogKind.COLOR, value="bruin")
        with pytest.raises(Exception):
            interval.value = "grijs"  # type: ignore[misc]


class TestFieldLogIntervalValidation:
    def test_negative_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="top_m cannot be negative"):
            FieldLogInterval(top_m=-0.1, base_m=1.0, kind=FieldLogKind.COLOR, value="bruin")

    def test_base_equal_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be greater than top_m"):
            FieldLogInterval(top_m=1.0, base_m=1.0, kind=FieldLogKind.COLOR, value="bruin")

    def test_empty_value_rejected(self) -> None:
        with pytest.raises(ValueError, match="value cannot be empty"):
            FieldLogInterval(top_m=0.0, base_m=1.0, kind=FieldLogKind.COLOR, value="")
