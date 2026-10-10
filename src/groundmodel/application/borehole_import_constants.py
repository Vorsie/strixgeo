"""Constants shared by the borehole FILE imports (DOV XML file, PDF borehole log).

Both imports refresh a stored borehole in place with the user's consent and
skip a new borehole that cannot be placed; the column list and the skip code
live here once so the two cannot drift.
"""

from __future__ import annotations

# Header columns a refresh takes from the fresh read WHEN IT HAS A VALUE. A
# value the read lacks is kept: the stored row may carry it from another
# source (a DOV WFS row for the bbox import), and one file is not the whole
# record. Excluded on purpose: id / app_project_id / project_id / test_id
# (identity and scope), drill_method (WFS-only summary), elevation (handled
# separately so a manual collar edit outranks the file, debt #8).
REFRESHED_HEADER_COLUMNS: tuple[str, ...] = (
    "name",
    "location_x",
    "location_y",
    "epsg",
    "start_date",
    "borehole_type",
    "purpose",
    "municipality",
    "executor",
    "total_depth_m",
    "water_table_depth_m",
)

# Code of the ERROR a new borehole gets when it is not persisted.
NOT_IMPORTED_CODE = "NOT_IMPORTED"

# --- PDF borehole-log import (phase 2, owner 2026-10-10) ----------------------
# The coordinate systems the "another CRS" dropdown offers (owner ruling
# 2026-10-08, 3): the two the map and the 3-D view can draw (Belgian Lambert
# 72, Dutch RD New; desktop ``useWgs84``). Any other code is refused: a
# borehole the app cannot place is no better than one without a position.
SUPPORTED_BOREHOLE_PDF_EPSGS: tuple[int, ...] = (31370, 28992)
# Scope of a CRS confirmation: this borehole only, or every borehole of the
# report in the same import ("all tests in this report are Lambert 72").
CRS_SCOPE_THIS = "this"
CRS_SCOPE_REPORT = "report"

# Refusal codes of ``BoreholePdfImportRefusedError`` (the API answers 422 with
# ``detail.code``; the dialog words each one).
REFUSED_NOT_OFFERED = "borehole_pdf_borehole_not_offered"
REFUSED_CRS_UNSUPPORTED = "borehole_pdf_crs_unsupported"
REFUSED_UNCONFIRMED = "borehole_pdf_assumption_unconfirmed"
REFUSED_REPEAT = "borehole_pdf_repeat_choose_one"

# A re-import found the PDF description track edited by hand: the engineer's
# track is kept, the report's is not written (INFO). The flags the adapter
# raises while shaping a borehole live with it (``borehole_pdf_constants``).
FLAG_EDITED_TRACK_KEPT = "PDF_BOREHOLE_EDITED_TRACK_KEPT"
