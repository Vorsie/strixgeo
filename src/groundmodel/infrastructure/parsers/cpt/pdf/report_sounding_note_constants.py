"""Stable codes of the notes a triaged sounding carries for the import dialog.

The codes are the wire contract between the triage and the desktop, which
renders each one from its EN/NL catalogues (``cptPdf.note.<code>``): the
backend never sends a sentence the user reads. Never rename a code; add one.
"""

#: No curve was read and OCR is not installed: the user types the axis values.
NOTE_TICKS_UNAVAILABLE_NO_OCR = "TICKS_UNAVAILABLE_NO_OCR"
#: No curve was read although OCR ran: the user types two tick values per axis.
NOTE_TICKS_NOT_READ = "TICKS_NOT_READ"
#: The sheet prints no position: the user types X and Y before importing.
NOTE_NO_POSITION_PRINTED = "NO_POSITION_PRINTED"
#: The graph plots elevation; depth = printed ground level - plotted elevation.
NOTE_ELEVATION_AXIS = "ELEVATION_AXIS"
#: The graph plots elevation but no ground level is printed: the user types it.
NOTE_ELEVATION_AXIS_NO_GROUND_LEVEL = "ELEVATION_AXIS_NO_GROUND_LEVEL"
#: Points drawn on an axis maximum; param ``count``.
NOTE_CLIPPED_POINTS = "CLIPPED_POINTS"
#: The curve was traced from a raster image: compare the orange curve with the sheet.
NOTE_READ_FROM_IMAGE = "READ_FROM_IMAGE"
#: Drilled stretches without measurement (owner ruling "a", 2026-10-04); params
#: ``intervals`` (``[[top, base], ...]`` in m) and ``count``.
NOTE_DRILLED_INTERVALS = "DRILLED_INTERVALS"
#: The printed depth axes of two sheets of one sounding leave a stretch
#: uncovered: no reading in between, unknown, not drilled (owner direction
#: 2026-10-07); params ``sheet`` (1-based), ``next``, ``d1`` and ``d2`` (m).
NOTE_SHEET_AXIS_GAP = "SHEET_AXIS_GAP"
#: The printed position lies outside the extent of its coordinate system (a
#: typo on the sheet, owner finding 2026-10-08): the user checks the header;
#: params ``x``, ``y`` (m) and ``epsg``.
NOTE_COORDINATE_OUT_OF_RANGE = "COORDINATE_OUT_OF_RANGE"
#: The values were read from the sounding's printed table, as printed (owner
#: 2026-10-08): nothing was traced, there is no curve to compare.
NOTE_READ_FROM_PRINTED_TABLE = "READ_FROM_PRINTED_TABLE"
#: Printed table rows that could not be read (not stored); param ``count``.
NOTE_TABLE_ROWS_REJECTED = "TABLE_ROWS_REJECTED"
#: Printed Rf values their own printed fs and qc cannot give: dropped, the Rf
#: cell left empty, qc and fs as printed (owner 2026-10-09); param ``count``.
NOTE_TABLE_RF_MISMATCH = "TABLE_RF_MISMATCH"
#: Rows printing the floor value qc 0,01 MPa directly after the printed
#: pre-drill: no reading, their cells left empty (owner 2026-10-09); params
#: ``count`` and ``depth`` (m, the first real row: the effective pre-drill).
NOTE_PRE_DRILL_FLOOR_ROWS = "PRE_DRILL_FLOOR_ROWS"
