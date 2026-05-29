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
# separation — the allowable bed DIP between two tests.  Raised from 0.002
# to 0.05 (dogfeed 2026-05-29, #163): the old 0.2%-gradient tolerance assumed
# near-flat beds and silently dropped obvious correlations where a horizon
# dipped a realistic ~1 m over ~50 m (a ~2% gradient).  5% covers ordinary
# dip with margin; at 50 m the window is ~3 m, at the 200 m cap ~10.5 m.
# Crucially this no longer risks spaghetti: the relative-neighbourhood-graph
# adjacency gate (#163a) already restricts pairing to adjacent tests, so a
# generous window only decides whether ADJACENT boundaries pair, never
# whether distant ones do.
DISTANCE_FACTOR: float = 0.05

# Provenance tag written to ``litho_contact_correlation_edge.source`` for
# rows produced by this algorithm.  Mirrors the formation-level "auto"
# tag from #127 so consumers (inspector badges, filters) treat them
# identically.
AUTO_SOURCE: str = "auto"
