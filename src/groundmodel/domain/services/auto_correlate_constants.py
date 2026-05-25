"""Constants for the auto-correlation algorithm (#127).

All values are owner-locked defaults from the debt spec.  Callers that
accept per-project overrides (e.g. Settings dialog thresholds) must pass
them as explicit keyword arguments to ``auto_correlate_litho_bodies``
rather than mutating these constants.

Notes
-----
- ``BASE_DEPTH_THRESHOLD_M`` is the minimum window half-width used when
  comparing contact depths between two columns.  It applies regardless
  of column separation distance.
- ``DISTANCE_FACTOR`` scales the window with column separation: a pair
  300 m apart gets an extra 3.0 m of tolerance on each side beyond the
  base threshold.
- ``MAX_COLUMN_DISTANCE_M`` hard-caps which column pairs are even
  considered.  Pairs beyond this distance share no window at all.
- ``MIN_EDGES_FOR_DIP_TRANSFER`` is the confidence gate: a per-column-
  pair dip estimate is only applied once that pair has accumulated at
  least this many correlated edges.  Below the threshold the algorithm
  falls back to a naïve "same depth" centre, which is correct for
  subhorizontal geology and conservatively avoids contaminating shallow
  Quaternary estimates with a noisy deep-Tertiary dip from only one or
  two data points.
"""

# Minimum depth-comparison window (metres).
# A pair of contacts at the same depth separated by 0 m would use exactly
# this window; closer pairs are impossible by definition.
BASE_DEPTH_THRESHOLD_M: float = 2.0

# Window scaling factor (metres per metre of column separation).
# 5 m apart   → window = 2.0 + 0.01 × 5   = 2.05 m
# 500 m apart → window = 2.0 + 0.01 × 500 = 7.0  m
DISTANCE_FACTOR: float = 0.01

# Hard cap: column pairs beyond this distance are never correlated.
MAX_COLUMN_DISTANCE_M: float = 500.0

# Minimum accumulated edges on a column-pair before the dip-transfer
# predictor is activated.  Below this threshold the algorithm uses a
# naïve "same depth as the predicted centre" fallback (zero dip).
MIN_EDGES_FOR_DIP_TRANSFER: int = 3

# Provenance token written to every edge created by this algorithm.
AUTO_SOURCE: str = "auto"
