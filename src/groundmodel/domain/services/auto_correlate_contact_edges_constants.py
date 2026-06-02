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

# Provenance tag written to ``litho_contact_correlation_edge.source`` for
# rows produced by this algorithm.  Mirrors the formation-level "auto"
# tag from #127 so consumers (inspector badges, filters) treat them
# identically.
AUTO_SOURCE: str = "auto"
