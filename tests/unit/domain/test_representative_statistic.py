"""The representative-qc statistic module — owner ruling 7 (docs/debt.md #227).

The statistic the NAD classifier reads is SELECTABLE per geotech model:
median (the spike-robust default), arithmetic, harmonic, geometric. The four
are ordered harmonic <= geometric <= arithmetic for the same positive series
("the choice systematically shifts classes — harmonic is the conservative
one, weighted toward the low values that govern bearing and settlement").
Every reader — the subdivision classifier AND the band-edit previews — must
go through this ONE function so the warning can never predict a
reclassification that does not happen (ruling 6).
"""

from __future__ import annotations

import statistics

import pytest

from groundmodel.domain.services.representative_statistic import (
    DEFAULT_STATISTIC,
    REPRESENTATIVE_STATISTICS,
    representative_qc,
)


class TestRepresentativeQc:
    """RS1-RS5 — the ruling's own properties, not the implementation's."""

    def test_rs1_median_matches_statistics_median(self) -> None:
        """RS1 — the default statistic is exactly the classifier's median."""
        values = [1.0, 2.0, 30.0, 4.0, 5.0]
        assert DEFAULT_STATISTIC == "median"
        assert representative_qc(values, "median") == statistics.median(values)

    def test_rs2_harmonic_leq_geometric_leq_arithmetic(self) -> None:
        """RS2 — ruling 7's ordering on a positive spread, verbatim."""
        values = [0.5, 2.0, 8.0, 32.0]
        harmonic = representative_qc(values, "harmonic")
        geometric = representative_qc(values, "geometric")
        arithmetic = representative_qc(values, "arithmetic")
        assert harmonic <= geometric <= arithmetic
        # The spread is real — the three genuinely differ on this series.
        assert harmonic < geometric < arithmetic

    def test_rs3_zero_reading_pulls_harmonic_and_geometric_to_zero(self) -> None:
        """RS3 — a 0.0 qc reading is VALID (loosest class, owner 2026-07-25).

        ``harmonic_mean`` returns 0.0 natively; ``geometric_mean`` raises on
        zero and must be guarded to the same conservative answer.
        """
        values = [0.0, 5.0, 10.0]
        assert representative_qc(values, "harmonic") == 0.0
        assert representative_qc(values, "geometric") == 0.0

    def test_rs4_unknown_token_raises(self) -> None:
        """RS4 — an unknown statistic is a programming error, never a default."""
        with pytest.raises(ValueError, match="mode"):
            representative_qc([1.0, 2.0], "mode")

    def test_rs5_single_value_all_four_agree(self) -> None:
        """RS5 — one reading: every statistic returns it unchanged."""
        for statistic in REPRESENTATIVE_STATISTICS:
            assert representative_qc([7.25], statistic) == pytest.approx(7.25)
