"""Module constants for the pure band-planning functions.

These tolerances and provenance tokens live beside :mod:`band_planning` (the
repo rule: module-level constants belong in a ``*_constants.py`` sibling, never
at the top of a class/function file).  They were extracted verbatim from
``divide_boreholes.py`` in the KonMari DB-S1 slice; ``divide_boreholes.py``
re-imports :data:`_DEPTH_TOL_M` for its own class code and re-exports the public
names, so every existing importer keeps resolving unchanged.

Notes
-----
Like its sibling ``geotech_band_edit_constants``, this module holds data-token
declarations with no algorithmic IP and ships as plain source (it is not listed
in ``scripts/native_compile_manifest.py``); the algorithm module
``band_planning`` is the one compiled to ``.pyd``.
"""

_DEPTH_TOL_M = 0.001
"""Depth grain: ``litho_layer`` stores intervals to the millimetre."""


GROWABLE_FRACTION_OF_MINIMUM = 0.5
"""How thin a band may be and still be GROWN to the minimum rather than merged.

A band the compression thinned is worth keeping at the minimum: his B4's basal
clay lost the KLEI 22 top both neighbours read because the mapped band was
0.22 m against a 0.35 m minimum (2026-08-17).  A hairline is not — growing a
2 cm reading to 35 cm invents seventeen times the thickness it was measured
over, which is a worse lie than dropping it.

Half the minimum is the cut: at or above it the band was substantially there;
below it, it was an artefact of squeezing a donor into a thin unit.  ⚠ The
fraction is not the owner's number and has not been ruled on.
"""


_UNRESOLVED_SOURCES = frozenset({"body_min", "absolute_min"})
"""Provenance tags meaning "no column spoke for this band".

``body_min`` is the weakest class observed anywhere in the body, ``absolute_min``
the NAD table's floor for the soil — both are guesses made when the donor rule
came back empty, not readings.
"""

COLUMN_MIN_SOURCE = "column_min"
"""Provenance for a band raised to the loosest class its own column measured."""


_WEAKEST_FIRST = ("absolute_min", "body_min", "column_min", "layer_inherited")
"""Provenance tags ordered weakest-first, for a merge that must not upgrade."""
