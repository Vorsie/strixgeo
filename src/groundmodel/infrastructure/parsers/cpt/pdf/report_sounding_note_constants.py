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
