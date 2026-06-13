"""Kernel / regularisation constants for the Stage-3 potential field.

Each constant carries the WHY of its value.  They were tuned in-stage against
BOTH the monotonicity gate (``F`` non-decreasing down every borehole, crossing
each iso-value at the observed contact depth) AND the dip test (the dipping
horizon reads back deeper down-dip), on the interbedded + dipping fixtures.  The
spec fixes the interface, not these numbers — they may be re-tuned as long as
both gates keep passing honestly.

A note on the abandoned vertical-drift idea
-------------------------------------------
An earlier formulation (per the spec's recommendation) tried
``F = -k*z + g(x, y, z)`` with a data-derived drift coefficient ``k`` meant to
force ``dF/dz < 0`` (monotone down).  An in-stage research loop proved this is
**algebraically ineffective with scipy's** ``RBFInterpolator`` for every kernel
and degree tested: because the RBF *interpolates* its targets, adding a global
linear ``k*z`` to the residual targets only shifts the fit by that same linear
term and leaves the field's *local* vertical gradient between control points
unchanged (with a degree>=1 polynomial tail it cancels exactly; with degree=-1 it
shifts but does not constrain the inter-point gradient).  Sweeping ``k`` over
0–20× the iso-spread changed the per-sample monotonicity outcome by < 3 % and,
above ≈10×, made it slightly *worse*.  The only lever that materially improves
inter-borehole monotonicity is the RBF **smoothing** (regularisation); the drift
was removed as dead complexity.  See the module docstring of ``potential_field``
and the DONE_WITH_CONCERNS note for the full finding.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# RBF interpolation
# ---------------------------------------------------------------------------

# Kernel for scipy.interpolate.RBFInterpolator.  ``cubic`` (phi(r) = r^3) is the
# 3D polyharmonic spline — the volumetric analogue of the 2D thin-plate spline
# (r^2 log r) the spec mentions, and the standard kernel for 3D implicit
# geological modelling (GemPy-style co-kriging uses the same polyharmonic
# family): smooth (C^2 at the data), no shape/epsilon parameter to tune.
#
# Why NOT thin_plate_spline: scipy's thin_plate_spline REQUIRES a degree >= 1
# polynomial tail, whose [1, x, y, z] monomial matrix is SINGULAR whenever the
# control points are collinear in map view (x or y constant) — the everyday case
# of boreholes sampled along a single cross-section line.  ``cubic`` is
# conditionally-positive-definite of high enough order to run with NO polynomial
# tail (degree=-1), so it stays well-posed on collinear data.
RBF_KERNEL: str = "cubic"

# Polynomial degree of the RBF's added trend.  -1 = NO polynomial tail.  Required
# so the fit stays well-posed when the control points are collinear in map view
# (a section of boreholes), where a degree>=0 tail's monomial matrix would be
# rank-deficient and the solve would raise a singular-matrix error.
RBF_DEGREE: int = -1

# Smoothing (regularisation) for the RBF, as scipy's per-point smoothing scalar.
#
# 0.0 = exact interpolation (the field passes EXACTLY through every control
# point).  A small positive value relaxes the exact fit slightly, which is the
# ONLY lever found to materially reduce inter-borehole vertical "bubbling" on
# tilted / sparse real data (a synthetic sweep over geologically-valid nested
# surfaces dropped the per-sample monotonicity-violation rate from ~30 % to
# ~8 % as smoothing rose from 0 to ~1, at the cost of relaxing the on-contact
# fit by < ~1 iso-unit).
#
# We keep it SMALL (0.05) so:
#   * the on-contact fit stays well inside the gate's 0.25 iso-unit tolerance
#     (on the fixtures the on-contact error is ~0 either way — they are benign),
#   * real-data robustness gets the bulk of the smoothing benefit without
#     visibly over-smoothing gentle dips.
# This is a soft mitigation, NOT a hard monotonicity guarantee — see the
# module docstring + the DONE_WITH_CONCERNS note.
RBF_SMOOTHING: float = 0.05
