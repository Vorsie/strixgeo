"""The plausible extent of each coordinate system a PDF sheet header can print.

A printed X / Y outside the extent of its system is almost always a typo on the
sheet itself (owner finding 2026-10-08: S28A of a CAMZ report prints
Y 2244433.030, a Lambert 72 Y has six digits). The triage flags such a row so
the user checks the header before importing; it never changes the value.
"""

#: EPSG code -> (x_min, x_max, y_min, y_max) in metres. Lambert 72 (31370)
#: covers Belgium at roughly X 17 000..297 000 m and Y 21 000..246 000 m (the
#: EPSG area of use, rounded outward to whole kilometres so a test on the
#: border never trips the note). Systems not listed are not checked.
COORDINATE_EXTENTS_M: dict[int, tuple[float, float, float, float]] = {
    31370: (17_000.0, 297_000.0, 21_000.0, 246_000.0),
}
