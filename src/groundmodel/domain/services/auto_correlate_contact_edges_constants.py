"""Constants for the contact-level auto-correlate algorithm (#133 Phase 2+3).

Mirror the formation-level defaults from #127 where they apply.  The
Theil-Sen dip transfer is intentionally absent here (per the spec — the
simpler depth-window algorithm caught the Accept-flow safety net).
"""

from __future__ import annotations

# Maximum planar distance (metres) between two investigations for the
# algorithm to consider their contacts as a candidate pair.  Mirrors the
# formation-level cap from #127; beyond this distance lateral facies
# changes dominate over true correlation signal and we refuse to guess.
MAX_COLUMN_DISTANCE_M: float = 200.0

# Base depth window (metres) below which two contacts are eligible to be
# paired before any distance-driven relaxation.  Calibrated against the
# typical contact-pick precision of borehole logs + Robertson-segmented
# CPTs (~0.3–0.5 m).  Inputs are absolute depth residuals.
BASE_DEPTH_THRESHOLD_M: float = 0.5

# Linear relaxation of the depth window per metre of horizontal column
# separation — the allowable bed DIP between two tests.  History: 0.002
# (near-flat, dropped obvious dipping correlations) → 0.05 (#163, 2026-05-29,
# 5%) → 0.04 (dogfeed 2026-06-02).  Owner directive: 5% drew steep diagonals
# nobody would suggest — a same-lithology contact ~8 m deeper over 150 m (a
# ~5% dip) got a confident straight edge where a LENS (pinch-out) is the
# honest interpretation.  4% is the ceiling for "ordinary dip we'll auto-draw
# a flat correlation for"; steeper boundaries fall through and are surfaced as
# lens candidates instead.  At 50 m the window is 2.5 m, at the 200 m cap 8.5 m.
# The relative-neighbourhood-graph adjacency gate (#163a) still restricts
# pairing to adjacent tests, so this only decides whether ADJACENT boundaries
# pair, never whether distant ones do.
DISTANCE_FACTOR: float = 0.04

# Ranking penalty (metres) added to the depth residual of a same-soil contact
# pair whose ADMIXTURES mismatch (owner ruling 2026-09-06).  Two candidates on
# the same adjacent column-pair, at near-equal depth, are separated by their
# admixture composition: a matching admixture ranks above a mismatching one.
# The value is half of BASE_DEPTH_THRESHOLD_M (0.5 -> 0.25) deliberately:
#   * large enough to REORDER ties between near-equal residuals: two candidates
#     whose raw depth residuals differ by less than 0.25 m, so the matching-
#     admixture one wins even when it sits slightly deeper;
#   * smaller than the smallest possible depth window (BASE_DEPTH_THRESHOLD_M =
#     0.5 m at zero distance) so the penalty can never, on its own, exceed the
#     window.  This matters because the penalty affects ONLY the ranking /
#     mutual-nearest-neighbour residual, never the window admission test (which
#     stays on the RAW residual), so a mismatch never blocks a tie; it
#     only demotes it behind a matching alternative.
ADMIXTURE_MISMATCH_PENALTY_M: float = 0.25

# Provenance tag written to ``litho_contact_correlation_edge.source`` for
# rows produced by this algorithm.  Mirrors the formation-level "auto"
# tag from #127 so consumers (inspector badges, filters) treat them
# identically.
AUTO_SOURCE: str = "auto"
