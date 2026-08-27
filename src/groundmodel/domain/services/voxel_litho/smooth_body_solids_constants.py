"""Tuning constants for the non-blocky voxel-solid smoother (debt #220 prototype).

Each value carries the reason it was chosen, not just the number: the smoother
trades staircase removal against contact fidelity, and every constant here sits
on one side of that trade.
"""

from __future__ import annotations

# Taubin's lambda|mu pair (Taubin 1995, "A signal processing approach to fair
# surface design").  A plain Laplacian pass is a low-pass filter whose gain is
# BELOW one at every non-zero frequency, so repeating it shrinks the solid
# toward its centroid — a body would lose real ground on every iteration.  The
# lambda|mu pair alternates a positive (shrinking) and a slightly larger
# negative (un-shrinking) step so the gain crosses one at a pass-band frequency
# k_pb = 1/LAMBDA + 1/MU; the staircase's high-frequency step pattern is damped
# while the body's overall size is returned.  |MU| > LAMBDA is what makes the
# pair volume-preserving rather than volume-losing, so the two must not be
# tuned independently.
TAUBIN_LAMBDA: float = 0.5
TAUBIN_MU: float = -0.53

# One "iteration" is one lambda pass plus one mu pass.  Twelve is where the real
# model's staircase stops visibly improving: the displacement budget below has
# usually bound by then, so further passes move the clamped vertices nowhere and
# only cost time.
DEFAULT_ITERATIONS: int = 12

# Fraction of a voxel EDGE a vertex may be displaced, per axis.  Half a voxel is
# not a taste setting: it is exactly the quantisation error the voxelisation
# introduced, so it is the largest correction the smoother can claim to be
# recovering rather than inventing.  It is also what makes fold-through
# impossible for a body at least one voxel thick — its top and base can each
# move half a voxel toward one another and, in the pathological limit, meet;
# they cannot cross.  Raising this past 0.5 breaks both properties at once.
DISPLACEMENT_BUDGET: float = 0.5
