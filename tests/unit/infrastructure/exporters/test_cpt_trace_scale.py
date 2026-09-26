"""The section-wide qc full scale for the DXF CPT curves — the app's rule, ported.

``cptChannels.pickQcFullScaleMpa`` (renderer) picks the smallest step in
40, 60, 80, 100, 150, 200, +50… such that no CPT has 20 consecutive samples
above the MIDPOINT to the next step. The exported curves must read on the same
scale as the section on screen (owner 2026-09-26: "it should literally look
like litho fill in app"), so the rule lives here too, pinned in the same cases.
"""

from __future__ import annotations

from groundmodel.infrastructure.exporters.cpt_trace_scale import (
    longest_consecutive_above,
    qc_full_scale_mpa,
)


def test_qs1_an_empty_section_reads_on_the_dov_default_of_40_mpa() -> None:
    """An empty section reads on the DOV default of 40 MPa."""
    assert qc_full_scale_mpa([]) == 40.0


def test_qs2_a_short_spike_above_40_does_not_bump_the_scale() -> None:
    """A 19-sample spike above 40 is one short of the rule and does not bump the scale."""
    # 19 samples at 55 MPa: one short of the 20-sample rule.
    trace = [5.0] * 100 + [55.0] * 19 + [5.0] * 100
    assert qc_full_scale_mpa([trace]) == 40.0


def test_qs3_twenty_samples_above_the_midpoint_step_the_scale_up_once() -> None:
    """Twenty samples above the 40/60 midpoint step the scale up to 60, not further."""
    # 20 samples at 55 MPa > 50 (the 40/60 midpoint) → 60; but not > 70 → stays 60.
    trace = [5.0] * 100 + [55.0] * 20 + [5.0] * 100
    assert qc_full_scale_mpa([trace]) == 60.0


def test_qs4_values_just_above_the_scale_but_under_the_midpoint_do_not_bump() -> None:
    """Values just above 40 but under the midpoint keep the 40 MPa scale."""
    # Dogfeed 2026-05-31: "barely values above 30, why is it 60?" — 41-45 fits 40.
    trace = [43.0] * 50
    assert qc_full_scale_mpa([trace]) == 40.0


def test_qs5_beyond_the_table_it_keeps_stepping_by_50() -> None:
    """Past the table the scale keeps stepping by 50."""
    trace = [260.0] * 50  # above 225 (the 200/250 midpoint) → 250; not above 275.
    assert qc_full_scale_mpa([trace]) == 250.0


def test_qs6_one_hard_cpt_sets_the_scale_for_the_whole_section() -> None:
    """One hard CPT sets the scale for the whole section."""
    soft = [3.0] * 200
    # 95 > 90 (the 80/100 midpoint) → 100; not > 125.
    hard = [95.0] * 30
    assert qc_full_scale_mpa([soft, hard]) == 100.0


def test_qs7_none_breaks_a_run() -> None:
    """A None sample breaks a run."""
    assert longest_consecutive_above([60.0, 60.0, None, 60.0], 50.0) == 2
