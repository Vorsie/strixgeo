"""Constants for the lithostratigraphic body-solid builder.

Geometry constants for the disk-marker fallback used when a body's picks
cannot form a real 3-D solid (fewer than 3 non-collinear investigations).
Each degenerate body is represented by one vertical cylinder per pick so
the unit shows at its actual investigation location instead of vanishing.
"""

#: Footprint radius of a disk marker cylinder (metres).
#: Kept small so the marker reads as "local occurrence, no lateral extent",
#: not as a real lateral body (owner directive 2026-06-10).
MARKER_DISK_RADIUS_M: float = 1.5

#: Minimum z-extent of a disk marker cylinder (metres).
#: A zero-thickness pick (top_depth == base_depth) would produce a flat
#: disk with no volume; this floor keeps it visible in the 3-D viewer.
MARKER_DISK_MIN_THICKNESS_M: float = 0.2

#: Number of side segments in a disk marker cylinder.
#: 16 segments gives a smooth appearance at typical 3-D zoom levels without
#: excessive triangle count per marker.
MARKER_DISK_SIDES: int = 16
