"""Constants for the CPT curves a section export draws.

Mirrors the renderer's ``cptChannels.ts`` so the exported curves read on the
same scale as the section on screen (owner 2026-09-26: a DXF of a litho fill
"should literally look like litho fill in app"). Keep the two in step.
"""

from __future__ import annotations

# Stepped upper bounds for the section-wide qc scale (renderer:
# QC_FULL_SCALE_STEPS_MPA). The smallest step no CPT exceeds wins; above the
# table the scale keeps stepping by QC_FULL_SCALE_STEP_BEYOND_MPA.
QC_FULL_SCALE_STEPS_MPA: tuple[float, ...] = (40.0, 60.0, 80.0, 100.0, 150.0, 200.0)
QC_FULL_SCALE_STEP_BEYOND_MPA = 50.0

# Consecutive-sample threshold (renderer: QC_CONSECUTIVE_THRESHOLD). At a 2 cm
# sampling interval 20 samples is ~40 cm — a real layer, not a spike.
QC_CONSECUTIVE_THRESHOLD = 20

# Rf reads leftward from the column axis on a fixed scale (renderer:
# RF_FULL_SCALE_PCT).
RF_FULL_SCALE_PCT = 10.0

# Gridlines the app draws inside the band (renderer CptDataColumn): qc at 2 and
# 10 MPa plus the full-scale edge, Rf at 2 and 4 %.
QC_GRID_MPA: tuple[float, ...] = (2.0, 10.0)
RF_GRID_PCT: tuple[float, ...] = (2.0, 4.0)

# The band half-width in section metres. On screen the band is pixels scaled
# with zoom; a DXF has no zoom, so it is a fixed width clamped to a fraction of
# the distance to the nearest neighbouring column, exactly so two close tests
# never overprint each other's curves.
CPT_BAND_HALF_WIDTH_M = 4.0
CPT_BAND_NEIGHBOUR_FRACTION = 0.45
CPT_BAND_MIN_HALF_WIDTH_M = 0.5

# Layers the curves land on. Separate from ``Investigations`` so a CAD user can
# hide the curves and keep the column lines.
CPT_QC_LAYER = "Investigations-CPT-qc"
CPT_RF_LAYER = "Investigations-CPT-Rf"
CPT_GRID_LAYER = "Investigations-CPT-scale"
# Rf in the app's orange; qc in the column colour; the scale in grey (ACI 8).
CPT_RF_RGB = (0xEA, 0x58, 0x0C)
CPT_GRID_ACI = 8
# Scale labels hang below the band as vertical text; their height follows the
# band width (a narrow band gets small labels) between these bounds.
CPT_LABEL_HEIGHT = 0.4
CPT_LABEL_MIN_HEIGHT = 0.15
CPT_LABEL_HEIGHT_FRACTION = 0.09
CPT_LABEL_LIFT_M = 0.3

# The fill hatches are see-through so the contact lines and curves on top stay
# readable — the app draws its bands at 0.55 opacity for the same reason.
FILL_TRANSPARENCY = 0.35

# Touching regions of one unit are unioned into one body before drawing; the
# vertices are snapped to this grid first so float noise on a shared seam cannot
# keep two regions apart (0.1 mm, far below the 1 mm depth grain).
FILL_UNION_GRID_M = 1e-4
