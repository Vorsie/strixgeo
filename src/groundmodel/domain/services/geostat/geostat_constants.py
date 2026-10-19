"""Constants of the geostatistics services (pick consistency check, uncertainty slice A0).

Every value here is an owner ruling or a numerical safeguard; the WHY is next to it.
"""

from __future__ import annotations

import math

# A three-parameter covariance fit (sill, range, nugget) on fewer picks is meaningless,
# and leave-one-out would leave at most four points to fit.
MIN_PICKS = 6

# |z| above 3 happens by chance about 1 time in 370 under a normal model, so a flag
# at 3σ almost always means a wrong pick (spec §3).
Z_FLAG = 3.0

# Two-sided 90 % band; used for the per-formation self-check ("coverage").
COVERAGE_Z = 1.645

# Owner ruling 2026-10-19: a pick is never treated as more accurate than this.
# A borehole log is described in about 0.5 m steps; a CPT pick is sharper.
PICK_NOISE_FLOOR_M = {"cpt": 0.10, "borehole": 0.25}

# Search box of the REML fit (spec §4.3). Ranges under 20 m cannot be resolved by
# tests that stand 50-100 m apart; above 5 km a site-scale model is a plane.
RANGE_BOUNDS_M = (20.0, 5000.0)
SILL_BOUNDS_M2 = (1e-4, 1e4)
NUGGET_BOUNDS_M2 = (1e-6, 1e2)

# Start value of the extra nugget (m²) before the optimiser moves it.
INITIAL_NUGGET_M2 = 1e-2

# Start range = this factor × the median nearest-neighbour distance.
INITIAL_RANGE_FACTOR = 3.0

# When the first fit lands on a range bound, retry once from this factor × the start range.
RANGE_RETRY_FACTOR = 10.0

# Iteration caps: the full fit may search; a refit starts at the full fit and only corrects.
FULL_FIT_MAX_ITERATIONS = 200
REFIT_MAX_ITERATIONS = 30

# Added to the covariance diagonal so a Cholesky factor always exists.
JITTER_M2 = 1e-8

# Objective value returned when the matrix is not positive definite; L-BFGS-B backs off.
LARGE_OBJECTIVE = 1e10

MATERN_SQRT3 = math.sqrt(3.0)

STATUS_CHECKED = "checked"
STATUS_TOO_FEW_PICKS = "too_few_picks"
STATUS_FIT_FAILED = "fit_failed"
