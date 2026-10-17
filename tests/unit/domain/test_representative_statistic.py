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

import math
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


class TestRepresentativeQcAgainstTheDefinitions:
    """RS6-RS7 — the numbers themselves, against the textbook formulas.

    RS1-RS5 pin properties: an ordering, a zero rule, a raise. None of them pins a
    VALUE, and RS1 compares the median to ``statistics.median`` — the very function the
    module calls, so it cannot fail. A token wired to the wrong formula would keep the
    ordering (owner's question: *"seems easy to test no? write a test on a qc interval
    for all means and then compare to the output from the app?"*).

    So these compute each mean from its definition, in the test, and require the module
    to agree. Not the same function twice: the definition on one side, the shipped code
    on the other.
    """

    def test_rs6_a_hand_worked_set_pins_all_four(self) -> None:
        """RS6 — [1, 2, 4] chosen because every one of the four is exact by hand.

        median   = 2                       (the middle of three)
        arithmetic = (1 + 2 + 4) / 3 = 7/3 = 2.333...
        geometric  = (1 * 2 * 4) ** (1/3)  = 8 ** (1/3) = 2
        harmonic   = 3 / (1/1 + 1/2 + 1/4) = 3 / 1.75   = 12/7 = 1.714...

        The geometric and the median coincide at 2 on purpose: a set where two answers
        agree is the one that catches a swap between them, because a swapped pair still
        satisfies the ordering RS2 checks.
        """
        values = [1.0, 2.0, 4.0]
        assert representative_qc(values, "median") == pytest.approx(2.0)
        assert representative_qc(values, "arithmetic") == pytest.approx(7 / 3)
        assert representative_qc(values, "geometric") == pytest.approx(2.0)
        assert representative_qc(values, "harmonic") == pytest.approx(12 / 7)

    def test_rs7_real_cone_readings_match_the_definitions(self) -> None:
        """RS7 — 20 real readings, each mean computed from its own formula.

        The slice is 11.63-12.58 m of CPT 019e932e-7c2b on the owner's model — the band
        whose stored class its own extent denied, which is what started this. Real
        ground rather than a tidy set: the readings span 5.25 to 16.99 MPa, so the four
        means genuinely separate and a mapping error cannot hide behind near-equal
        answers.
        """
        qc = [
            7.56,
            12.72,
            15.47,
            15.82,
            14.92,
            13.64,
            13.72,
            14.28,
            11.84,
            9.02,
            5.58,
            5.25,
            5.93,
            7.34,
            9.78,
            13.33,
            16.99,
            16.62,
            14.44,
            11.79,
        ]
        n = len(qc)

        # Arithmetic: the sum over the count.
        expected_arithmetic = sum(qc) / n
        # Harmonic: the count over the sum of reciprocals.
        expected_harmonic = n / sum(1.0 / q for q in qc)
        # Geometric: the n-th root of the product, taken through logs so 20 factors
        # cannot overflow the way a plain product eventually would.
        log_sum = 0.0
        for q in qc:
            log_sum += math.log(q)
        expected_geometric = math.exp(log_sum / n)
        # Median: the mean of the two middle readings, this set being even-sized.
        ordered = sorted(qc)
        expected_median = (ordered[n // 2 - 1] + ordered[n // 2]) / 2

        assert representative_qc(qc, "arithmetic") == pytest.approx(expected_arithmetic)
        assert representative_qc(qc, "harmonic") == pytest.approx(expected_harmonic)
        assert representative_qc(qc, "geometric") == pytest.approx(expected_geometric)
        assert representative_qc(qc, "median") == pytest.approx(expected_median)

        # And the four are genuinely apart on this data, so the assertions above are
        # doing work: a swapped token could not satisfy them by coincidence.
        answers = [expected_harmonic, expected_geometric, expected_arithmetic, expected_median]
        assert len(answers) == len({round(a, 6) for a in answers})
        assert expected_harmonic < expected_geometric < expected_arithmetic
