"""Layout constants for the cross-section PDF report exporter.

Kept in a sibling module so they are easy to tune without reading through
the layout body, and so Phase-5 report slices (B / C / D) can import them
directly without coupling to the exporter class.

Values are in native matplotlib / ReportLab units unless the name carries
a suffix (``_M`` = metres in the plot coordinate system,
``_INCH`` = inches for matplotlib figure sizing).
"""

# Width of the investigation-column band in the section figure, in metres.
# Wider = each investigation column takes more horizontal space in the plot.
COLUMN_BAND_WIDTH_M: float = 8.0

# Minimum gap between adjacent column bands, in metres.
# Prevents overlapping column labels on densely-packed sections.
COLUMN_EDGE_GAP_M: float = 2.0

# Side length of the square location-map inset, in inches.
# Placed top-right of the main figure.
MAP_INSET_SIZE_INCH: float = 2.2

# Overall figure width in inches — A4 portrait minus left + right margins.
FIG_W_INCH: float = 7.8

# Overall figure height in inches.
FIG_H_INCH: float = 5.6

# Default maximum depth when the snapshot has no contacts AND no surface
# elevation on any investigation, in metres.  Used only as a fallback
# y-axis limit so the figure always renders a sensible scale.
DEFAULT_DEPTH_M: float = 30.0
