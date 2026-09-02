"""Constants for the D-Sheet Piling (``.shi``) section exporter.

The strings here are the ones an engineer reads inside the delivered
file, so they are written as sentences rather than as tokens: the
``[RUN IDENTIFICATION]`` block is the only place a ``.shi`` lets us
speak, and it is where the export says what it supplied and what the
engineer still has to.

Absent-parameter representation (audit 2026-09-02)
--------------------------------------------------
When a unit's NAD class is NOT in ``NAD_SOIL_PARAMETERS`` (the shipped
state — the table is empty until the owner fills it), the exporter adds
the soil with name + code only. Unlike D-Stability, a name+code-only
D-Sheet soil is NOT all-zero: GEOLib forces its own initial values,
which are ``SoilGamDry = SoilGamWet = 0.01`` kN/m³ and
``SoilCohesion = SoilPhi = 0`` (the four fields the export would fill),
plus a set of non-zero structural defaults nobody chose —
``SoilOCR = 1.0``, ``SoilEModMenard = 0.01``, the subgrade-reaction
``SoilKb*/SoilKo* ≈ 1e4``, ``SoilPermeabKx = 1e-4``,
``SoilLn = SoilLp = 0.01``. Those are D-Sheet's own placeholders; the
export never writes them, and the ``[RUN IDENTIFICATION]`` block says
the parameters are at defaults. When the table carries the class the
export fills only the four Mohr-Coulomb / weight fields and names the
source table on line 3.
"""

from __future__ import annotations

# Where along the section the 1-D profile is taken when the caller does
# not say. Mid-section is the least arbitrary default: it is the point
# furthest from both ends, so it is the least likely to sit on a column
# where two gaps' regions both claim the same elevation.
DEFAULT_SAMPLE_FRACTION = 0.5

# Smallest slab (m) that becomes its own profile layer. Below it the
# two bounding contacts are the same contact to any practical purpose,
# and D-Sheet refuses a profile whose layer tops do not decrease.
MIN_LAYER_THICKNESS_M = 1e-6

# Smallest polygon area (m^2) worth sampling — matches the D-Stability
# exporter's floor and the 2-D engine's own zero-area floor (debt #228).
MIN_POLYGON_AREA_M2 = 1e-9

# Minimum distinct vertices for a ring to enclose an area at all.
MIN_POLYGON_POINTS = 3

# Name given to the exported soil profile. Fixed rather than derived
# from the section name because D-Sheet references profiles by name
# from the construction-stage block, and a name with a dash or an
# apostrophe in it has bitten D-Series ASCII parsers before.
PROFILE_NAME = "StrixProfile"

# Name of the exported surface, same reasoning.
SURFACE_NAME = "StrixSurface"

# Name of the single construction stage the export creates. D-Sheet
# needs at least one stage for a profile to attach to; ours carries no
# construction, so the name says so.
STAGE_NAME = "Strix export - no construction"

# GEOLib materialises a ``[WATERLEVELS]`` block with an unnamed level at
# 0.00 whether or not one is added, so a .shi cannot simply omit the
# water table. The value is therefore left at GEOLib's own 0.00 — Strix
# chooses no number — and the NAME is what tells the engineer it is a
# placeholder. Naming it (rather than accepting GEOLib's neutral "New
# Water Level") is the difference between an obvious blank and a level
# that reads as exported knowledge. Never set this to the ground
# surface: that is the mistake the 2026-08-02 Plaxis audit caught, where
# writing the surface elevation into the head made every exported model
# fully saturated.
TODO_WATER_LEVEL_NAME = "TODO set water level"
TODO_WATER_LEVEL_M = 0.0

# Lines the ``[RUN IDENTIFICATION]`` block may carry. D-Sheet Piling's
# GUI shows exactly three (GEOLib enforces the same count via
# ``REQ_RUN_LINES = 2`` newlines, and warns "More than 3 lines in
# run_identification will be ignored in the GUI"). Anything past the
# third line is in the file but invisible to the engineer — which for a
# TODO is the same as not writing it. So the whole message is budgeted
# to three lines: what this is, then the two things the engineer must
# supply before the model means anything.
RUN_IDENTIFICATION_LINES = 3

# Line 1 — what the artefact is and where in the section it was cut.
RUN_LINE_PROVENANCE = (
    "StrixGeo export - {project_name} / section {section_name} - 1-D profile at "
    "{along_m:.2f} m along the line (fraction {fraction:.3f}), levels in {datum}"
)

# Line 2 — the model inputs Strix does not have. Written as a TODO
# because Strix genuinely does not know the values, and an invented
# default is indistinguishable from a measured one once it is in the
# file. The water level named in ``TODO_WATER_LEVEL_NAME`` is the one
# entry that HAS to exist (see that constant), so it is called out here.
RUN_LINE_MISSING_INPUTS = (
    "TODO - Strix exports ground only: no sheet piling / pile / wall, no real "
    "water level (see the level named '{water_level_name}'), no surcharge, "
    "anchor or strut."
)

# Line 3 — the liability line, in the file. Used when NO exported unit carries
# NAD-table parameters (the shipped state, until the owner fills the table).
RUN_LINE_PARAMETERS = (
    "TODO - soil parameters are at D-Sheet Piling defaults. Exported units carry "
    "Strix CHARACTERISATION only (NAD packing class + soil code); design-ready "
    "values are the engineer's to enter."
)

# Line 3, alternate — used when at least one exported unit DID carry parameters
# from the NAD table. D-Sheet's [SOIL] block has no per-soil free-text field, so
# this is where the provenance for those parameters is stated. ``source_label``
# is filled with the ASCII-folded ``SOURCE_LABEL`` so the .shi stays portable.
# Units whose class is not in the table still carry D-Sheet's own defaults, so
# the line says both halves.
RUN_LINE_PARAMETERS_FROM_TABLE = (
    "Soil parameters (gamma / phi / c): {source_label}. Strix CPT-derived "
    "characterisation - the engineer must verify each value; any unit without a "
    "table entry stays at D-Sheet Piling defaults."
)
