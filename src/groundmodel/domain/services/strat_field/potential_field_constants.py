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
# ⚠ SMOOTHING IS IN THE UNITS OF THE (NOW NORMALISED) PROBLEM.  As of the
# coordinate-normalisation fix (see ``RBF_NORMALIZE`` below + the module
# docstring of ``potential_field``), the RBF is fit on coordinates squeezed to
# roughly ``[-1, 1]``, so the residual / kernel scale is O(1) rather than the
# O(10^2) raw-metre scale.  The OLD value (0.05, tuned for raw metres) becomes a
# HUGE relative smoothing in normalised space — on a collinear cross-section it
# pushed the on-contact error to ~0.77 iso-units, blowing the gate's 0.25
# tolerance.  Re-tuned to 1e-5: in normalised space this is a tiny regularisation
# that keeps the on-contact error ~0.007 iso-units (well inside the 0.25 gate) on
# both the benign compact fixtures AND the widely-spaced / collinear real-data
# fixture, while still nudging the solve off the exact-interpolation singularity.
# A synthetic sweep at this scale: sm 0 → 1e-5 → 1e-4 → 1e-3 gave on-contact
# error 0.000 → 0.007 → 0.070 → 0.766; 1e-5 is the knee that keeps the fit honest.
# This is a soft mitigation, NOT a hard monotonicity guarantee — see the
# module docstring + the DONE_WITH_CONCERNS note.
RBF_SMOOTHING: float = 1e-5

# ---------------------------------------------------------------------------
# Coordinate normalisation (the coordinate-spread fix)
# ---------------------------------------------------------------------------

# Whether to normalise the control-point coordinates before fitting the RBF.
#
# WHY this exists — the coordinate-spread explosion
# -------------------------------------------------
# On a real BE/NL project the control points sit at Lambert-72 magnitude
# (x ≈ 150 000 m, y ≈ 200 000 m) with internal contacts only a few metres deep,
# and boreholes are 100–200 m apart.  Fitting the cubic kernel ``phi(r) = r^3``
# DIRECTLY on those raw metres makes the field's magnitude grow with the project
# SPAN (a synthetic span sweep: 500 m → 5 km grew the raw max-|F| from ~6 to ~25,
# and on real data Task-8 integration measured ~190 000 between widely-spaced
# holes), which produces ZERO usable bodies — the band height-fields are garbage.
# The compact Task-4 fixtures (~8 m spacing, small coords) never exposed this:
# the exact "layer-cake fixtures hid the loft bug" trap, one level up.
#
# The fix: bring the coordinates to O(1) BEFORE fitting, fit in normalised space,
# store the transform, and apply the SAME transform to query points at evaluate
# time.  Normalised coordinates make the field magnitude span-independent (the
# same span sweep stays ~4–8 normalised) and make ``RBF_SMOOTHING`` mean a fixed
# fraction of the problem scale regardless of project size.
#
# WHY ISOTROPIC, not anisotropic — the collinear trap
# ---------------------------------------------------
# Two normalisations were measured head-to-head on BOTH a 2-D-spread fixture and
# a COLLINEAR one (boreholes along a single cross-section line — the everyday
# BE/NL case the kernel/degree choice already guards against):
#
#   * ISOTROPIC (centre at the centroid, divide ALL three axes by ONE
#     characteristic length = the max per-axis half-extent) PRESERVES the
#     x:y:z aspect ratio, so dips are undistorted, and degenerates GRACEFULLY on
#     collinear data (the zero-spread axis simply contributes nothing).  Measured
#     max-|F|: ~4.5 (collinear), ~8.7 (2-D) — bounded in both, on-contact error
#     ~0.007.
#   * ANISOTROPIC (scale each axis to [-1, 1] independently) gives slightly
#     better conditioning on a 2-D spread, BUT on collinear data the zero-spread
#     y-axis has no finite scale: clamping its divisor to 1 leaves y un-normalised
#     while x and z are squeezed, producing a wildly distorted aspect ratio that
#     made off-line extrapolation EXPLODE to ~460 000 — catastrophically worse
#     than raw.  Anisotropic is therefore DISQUALIFIED: it trades a benign 2-D
#     improvement for a catastrophic collinear failure on the most common
#     real-data layout.
#
# Isotropic is chosen.  The only theoretical cost (a tiny vertical-resolution
# loss when z-spread ≪ xy-spread, because z barely varies in normalised space) is
# not observed on the fixtures: the field still crosses each iso-value at the
# observed depth within the gate tolerance, because the cubic kernel resolves the
# vertical ordering from the iso-VALUES (which are NOT scaled — only the spatial
# coordinates are), not from the z-coordinate magnitude.
RBF_NORMALIZE: bool = True
