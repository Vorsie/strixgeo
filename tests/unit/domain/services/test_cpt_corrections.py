"""Unit tests for CPT primitive corrections (qt computation)."""

import pytest

from groundmodel.domain.services.cpt_corrections import calculate_qt_series


class TestCalculateQtSeries:
    def test_basic_correction(self) -> None:
        # qc=2.0, u2=0.1, a=0.75 → qt = 2.0 + 0.1*(1-0.75) = 2.025
        result = calculate_qt_series([2.0], [0.1], 0.75)
        assert result == pytest.approx([2.025])

    def test_multiple_rows(self) -> None:
        result = calculate_qt_series(
            qc_mpa=[1.0, 2.0, 5.0],
            u2_mpa=[0.0, 0.1, 0.2],
            cone_area_ratio=0.80,
        )
        # 1.0 + 0*(0.20) = 1.0
        # 2.0 + 0.1*(0.20) = 2.02
        # 5.0 + 0.2*(0.20) = 5.04
        assert result == pytest.approx([1.0, 2.02, 5.04])

    def test_a_equal_one_means_no_correction(self) -> None:
        # When a = 1, the correction term vanishes — qt == qc.
        result = calculate_qt_series([3.0, 4.5], [0.5, 0.6], 1.0)
        assert result == pytest.approx([3.0, 4.5])

    def test_per_row_none_for_missing_qc(self) -> None:
        result = calculate_qt_series([1.0, None, 3.0], [0.1, 0.1, 0.1], 0.75)
        assert result is not None
        assert result[0] == pytest.approx(1.025)
        assert result[1] is None
        assert result[2] == pytest.approx(3.025)

    def test_per_row_none_for_missing_u2(self) -> None:
        result = calculate_qt_series([1.0, 2.0], [None, 0.1], 0.75)
        assert result is not None
        assert result[0] is None
        assert result[1] == pytest.approx(2.025)


class TestCalculateQtSeriesMissingInputs:
    def test_returns_none_when_u2_column_missing(self) -> None:
        # CPTE has no piezo readings — qt undefined, return None.
        assert calculate_qt_series([1.0, 2.0], None, 0.75) is None

    def test_returns_none_when_a_missing(self) -> None:
        # Without the net area ratio we refuse to invent it; qt is undefined.
        assert calculate_qt_series([1.0, 2.0], [0.1, 0.1], None) is None

    def test_returns_none_when_lengths_mismatch(self) -> None:
        # Defensive — a logged warning, returns None to avoid producing
        # silently-truncated output.
        assert calculate_qt_series([1.0, 2.0, 3.0], [0.1, 0.1], 0.75) is None
