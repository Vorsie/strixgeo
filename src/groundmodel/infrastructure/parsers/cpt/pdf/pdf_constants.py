"""Constants for the PDF CPT digitiser (triage, calibration, extraction).

Every threshold here was chosen against the two real proefverslagen of project
23.15 (Van der Straaten sheets + reprinted DOV sheets) and the synthetic test
pages; the comment on each says why the value is what it is.
"""

from __future__ import annotations

import re

from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind

# ---------------------------------------------------------------------------
# Coordinate spaces of a calibration
# ---------------------------------------------------------------------------

# A text-layer / vector calibration lives in PDF points (1/72 inch, y down);
# a raster calibration in pixels of an image rendered at a known dpi.
PDF_POINTS = "pdf-pt"
IMAGE_PIXELS = "image-px"

# ---------------------------------------------------------------------------
# Numbers and tick runs
# ---------------------------------------------------------------------------

# A tick label is a bare number: optional sign, digits, optional decimal part.
# DOV prints elevations as "+5.00"; Dutch sheets may use a decimal comma.
NUMBER_PATTERN = re.compile(r"^[-+−]?\d+(?:[.,]\d+)?$")

# Words whose baselines differ by less than this are one row of labels (pt).
# Real tick labels on one axis share the baseline to 0.1 pt; 2 pt tolerates a
# mixed-font row without merging the qc row (y 86.6) with the inclination row
# (y 79.6) printed 7 pt above it on the Van der Straaten sheet.
TICK_ROW_TOLERANCE_PT = 2.0

# Right edges of the labels of one vertical axis agree to this (pt). Labels are
# right-aligned against the axis; "-10" and "7" differ in width, not right edge.
TICK_COLUMN_TOLERANCE_PT = 2.5

# Consecutive ticks of one axis step by the same value and the same distance.
# 12 % relative slack absorbs label-centre jitter from glyph widths ("1" is
# narrower than "8") without accepting an uneven sequence.
TICK_PITCH_RELATIVE_TOLERANCE = 0.12

# An axis has at least this many labels. Three rules out a date + a coordinate
# that happen to share a baseline, and keeps the 3-label inclination axis
# (20 / 10 / 0) of the Van der Straaten sheet.
MIN_TICKS_PER_RUN = 3

# A tick label's centre snaps to a grid line when one lies this close (pt).
GRID_SNAP_TOLERANCE_PT = 3.0

# Tick labels may sit a constant distance off their grid lines; the shift is
# searched up to this share of the tick pitch. Beyond ~0.4 a label would be
# indistinguishable from its neighbour's.
LABEL_SHIFT_PITCH_SHARE = 0.4

# Walking a panel frame outward along its grid, the next line must sit within
# this distance (pt) of one tick pitch further. Neighbouring panels are 15-17
# pt apart on an 18.35 pt pitch, so the walk stops at the panel edge.
GRID_WALK_TOLERANCE_PT = 0.8

# A grid line is at least this long (pt); shorter strokes are tick marks,
# arrows or table rules. The shortest real panel (a Van der Straaten
# continuation sheet) is ~350 pt tall.
GRID_LINE_MIN_LENGTH_PT = 100.0

# An axis word ("Conusweerstand", "qc") names a tick run when it sits at most
# this far above the run's row (pt) ...
AXIS_LABEL_REACH_PT = 30.0
# ... or at most this far below it (DOV puts "fs (MPa)" on the fs row itself).
AXIS_LABEL_BELOW_PT = 8.0

# Words whose centres differ by less than this share a printed line (pt).
# The Van der Straaten title block prints a value 1-2 pt off its label's
# baseline; neighbouring block lines are ~10 pt apart.
LINE_TOLERANCE_PT = 3.5

# Words of one phrase are a normal space apart (~1.5-2.5 pt at 8 pt type);
# columns of a title block or of an axis row are further apart.
PHRASE_WORD_GAP_PT = 4.0

# A field value starts within this distance right of its label (pt): the Van
# der Straaten block puts a ":" ~15 pt after the label and the value ~13 pt
# after that; DOV puts the value ~30 pt after "Z (mTAW):".
FIELD_VALUE_REACH_PT = 60.0
# Inside a field value, words are a normal space apart; a wider gap ends the
# value ("6.02" then "m1 t.o.v. TAW" 8 pt further is a unit, not the value).
FIELD_VALUE_WORD_GAP_PT = 6.0

# Tokens standing between a field label and its value.
FIELD_SEPARATORS = frozenset({":", "=", "-"})
# Characters stripped from the front of a value OCR glued to its label
# ("X-COORDINAAT(Lambert72):66980.21" -> "66980.21"). Not "-": inside a glued
# word a leading minus belongs to the number.
GLUED_VALUE_STRIP = " :="
# A value word may start this far left of its label's right edge (pt): OCR
# boxes of neighbouring words overlap by a fraction of a point.
FIELD_ROW_OVERLAP_PT = 1.0
# The leading number of a field value ("6.02 m1" -> 6.02, "+6.24").
LEADING_NUMBER_PATTERN = re.compile(r"[-+−]?\d+(?:[.,]\d+)?")

# A unit phrase belongs to an axis label when it starts at most this far right
# of the label phrase (pt); the next column's label is further away.
UNIT_REACH_PT = 20.0

# Unit tokens printed next to an axis word.
UNIT_PATTERN = re.compile(r"MPa|kPa|%")

# ---------------------------------------------------------------------------
# Page triage
# ---------------------------------------------------------------------------

# Words that point at a CPT graph, with their weight in the CPT score.
CPT_KEYWORD_WEIGHTS: tuple[tuple[re.Pattern[str], float], ...] = (
    (re.compile(r"sondering|sondeer|\bCPT", re.IGNORECASE), 1.0),
    (re.compile(r"conusweerstand|cone resistance|\bq_?c\b", re.IGNORECASE), 2.0),
    (re.compile(r"wrijving|sleeve friction|\bf_?s\b", re.IGNORECASE), 1.5),
    (re.compile(r"wrijvingsgetal|friction ratio|\bR_?f\b", re.IGNORECASE), 1.0),
    (re.compile(r"\bMPa\b"), 1.0),
    (re.compile(r"diepte|depth|\bTAW\b|peil", re.IGNORECASE), 0.5),
)

# A CPT graph page scores at least this on the keywords above (or, without a
# text layer, shows a raster grid).
MIN_CPT_KEYWORD_SCORE = 4.0

# A drawing path with at least this many segments is a data curve, not a grid
# line or a table rule: a CPT curve has one vertex per scan (hundreds).
MIN_CURVE_SEGMENTS = 100
# On a page of a recognised layout with its axes in place, a short curve is
# enough: a continuation sheet may carry only a metre or two (CAMZ-001 p. 211:
# 59 segments).
MIN_CURVE_SEGMENTS_KNOWN_LAYOUT = 20

# The frame of a CPT graph, read from geometry alone (a refusal sheet whose
# font has no Unicode map: no keyword survives, and the probe stopped after a
# metre, so the curve is short). The depth axis runs down at least this share
# of the page: every real sheet's depth axis spans ~0.6-0.7 of an A4 page,
# a column of numbers in a table rarely a third.
GRAPH_FRAME_MIN_DEPTH_AXIS_SHARE = 0.3
# ... and at least this many value panels carry their labels on grid lines:
# a CPT sheet plots qc next to fs / Rf; a single gridded axis is any chart.
GRAPH_FRAME_MIN_VALUE_AXES = 2

# Dissipation tests plot pore pressure against log time: CPT-related, but not
# a depth series the digitiser reads. Only the sheet's own field label counts:
# a CPT figure captioned "... dissipatieproeven ..." is still a CPT graph.
DISSIPATION_PATTERN = re.compile(r"DISS\.\s*TEST|dissipatietest", re.IGNORECASE)

# A pasted CPT figure: its caption or running text names a sounding.
CPT_CAPTION_PATTERN = re.compile(r"sondering|\bCPTU?\b|conusweerstand", re.IGNORECASE)

# Borehole-log wording (boorstaat / boorprofiel).
BOREHOLE_LOG_PATTERN = re.compile(
    r"boorstaat|boorbeschrijving|boorprofiel|borehole\s+log|\bBoring\s*:", re.IGNORECASE
)

# Raster check during triage: render resolution (dpi) and what a graph needs:
# a panel at least this share of the page tall, crossed by this many
# horizontal grid lines. A ruled table rarely has equally spaced columns
# spanning a third of the page AND many rows; a CPT grid always has.
RASTER_TRIAGE_DPI = 100
RASTER_GRAPH_MIN_PANEL_HEIGHT = 0.3
RASTER_GRAPH_MIN_HORIZONTAL_LINES = 5

# A page whose largest image covers this much of the page is image-dominated.
IMAGE_DOMINANT_COVERAGE = 0.35

# A text layer shorter than this counts as absent (a scan often carries a
# couple of stray characters from the scanner's stamp).
MIN_TEXT_LAYER_CHARS = 20

# A table page: many numeric words and ruled lines.
MIN_TABLE_NUMERIC_WORDS = 40
MIN_TABLE_RULES = 20

# A text layer is unreadable (subset fonts without a Unicode map) when fewer
# than this share of its word characters are letters; judged only on at
# least GARBLED_MIN_CHARS characters. Real Dutch report text scores ~0.85,
# the garbled Van der Straaten sheets of CAMZ-005 ~0.2.
GARBLED_TEXT_QUALITY = 0.5
GARBLED_MIN_CHARS = 60

# The title block and running header are OCR'd on a page whose text layer is
# unreadable: the bottom and the top strip of the page (share of the height),
# at this resolution. Title blocks sit at the bottom (Van der Straaten, DOV
# footer) or the top (DOV header); the rest of the page is graph.
OCR_BOTTOM_STRIP = 0.17
OCR_TOP_STRIP = 0.13
OCR_DPI = 250

# Axis labels missing from the text layer are OCR'd in a top strip and a left
# strip (share of the page) at a higher resolution: the Van der Straaten tick
# labels are 7 pt, which OCR reads reliably from ~300 dpi.
OCR_AXIS_TOP_SHARE = 0.15
OCR_AXIS_LEFT_SHARE = 0.1
OCR_AXIS_DPI = 300

# ONNX runtime threads per RapidOCR model. The default (-1) takes every
# logical core; measured on the owner's 2.3 report (i7-13700HX, 24 logical
# cores, 8 sheets x 2 title strips, 2026-10-05) 8 threads read a sheet in a
# median 3.4 s against 5.1 s at the default, with byte-identical words. Half
# the logical cores, capped here, keeps a 4-core laptop off oversubscription.
OCR_MAX_THREADS = 8

# The OCR word cache file next to a stored report, and its format version. Bump
# the version when the OCR settings change what the engine reads (dpi, strips,
# thread-independent model options): an older cache is then ignored, not
# trusted.
OCR_CACHE_SUFFIX = ".ocr.json"
OCR_CACHE_VERSION = 1

# Prose: this many words and no stronger evidence.
MIN_PROSE_WORDS = 120

# Hundreds of short vector strokes without a data curve: a map, plan or drawing.
MIN_MAP_PATHS = 1500

# ---------------------------------------------------------------------------
# Campaign vs desk study
# ---------------------------------------------------------------------------

# DOV sounding ids as printed on DOV sheets and in report captions:
# "GEO-22/040-S2", "GEO-18/063-S8d".
DOV_ID_PATTERN = re.compile(r"\bGEO-\d{2}/\d{2,4}-[A-Za-z]*\d+[A-Za-z]?\b")

# A campaign code as Flemish contractors print it: letters, a dash, three
# digits ("CAMZ-001"). A DOV id "GEO-22/040" does not match (two digits),
# nor a code glued inside a document number ("23.15-RAP-003-2.2").
DEFAULT_CAMPAIGN_CODE_PATTERN = re.compile(r"(?<![\w.-])[A-Z]{3,6}-\d{3}\b")

# The DOV sheet footer / logo text: a reprinted DOV sounding.
DOV_SHEET_PATTERN = re.compile(
    r"DATABANK\s+ONDERGROND\s+VLAANDEREN|Vlaanderen\s+is\s+ondergrond", re.IGNORECASE
)

# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

# Output column per quantity, the CPT series column names of the GEF parser
# (so a digitised table feeds the same GEFParseResult shape in phase 2).
STORED_COLUMN_BY_KIND: dict[PanelKind, str] = {
    PanelKind.QC: "qc_mpa",
    PanelKind.FS: "fs_mpa",
    PanelKind.RF: "rf_pct",
    PanelKind.U2: "u2_mpa",
}

# The score leaves out grid points that fall between two scans more than this
# many grid steps apart, in either series: a gap in the sounding (rods added)
# is not data. Five steps (0.1 m) tolerates the thinned polylines some sheets
# draw (CAMZ-005: 0.02-0.08 m between vertices) while a real gap is 0.2-1.3 m.
SCORE_MAX_GAP_STEPS = 5

# A drilled stretch on a VECTOR sheet (owner ruling "a", 2026-10-04: rods
# added / "voorboring" between two pushes) is where the plotter LIFTED ITS PEN:
# the curve's stroke changes and the depth jumps by more than this (m). The
# values across it are left empty, never interpolated, and it is reported as a
# drilled interval. A distance alone cannot tell: within one stroke the thinned
# CAMZ-005 polylines join vertices up to 0.34 m apart where the GEF has data,
# while CAMZ-001 has drilled stretches from 0.10 m (sounding 15 at 24.5 m) to
# 4.5 m. At a pen lift with no missing scan the jump is one scan (0.02 m);
# 0.05 m means at least one scan is missing.
VECTOR_DRILL_GAP_M = 0.05

# A continuation sheet repeats up to this much depth (m) of the sheet before
# it (the Van der Straaten continuation starts ~0.3 m above the previous end).
CONTINUATION_OVERLAP_M = 1.0

# A sheet with a known id that starts within this depth (m) of the earlier
# sounding of that id is a repeat of its first sheet (CAMZ-001 p. 215).
REPEAT_START_TOLERANCE_M = 0.1

# The regular depth grid of the resampled output (m). 0.02 m is the scan step
# of the GEF files the same contractor delivers, so a digitised series lines up
# with a GEF row for row.
DEFAULT_RESAMPLE_STEP_M = 0.02

# A vertex this close to the panel edge that carries the axis maximum is a
# clipped value (pt, or px in image space). The Van der Straaten qc curve is
# drawn exactly onto the 32 MPa line when qc exceeds it.
CLIP_EDGE_TOLERANCE = 0.6

# A number printed inside a frame within this distance (pt) of the axis-max
# edge is the true value of a clipped point (the Van der Straaten arrows).
ANNOTATION_EDGE_REACH_PT = 30.0

# An axis is named by a curve colour when at least this share of that
# colour's curve segments lies within the axis span.
COLOUR_AXIS_SHARE = 0.5

# Stroke colours match a profile colour by hue family, because print drivers
# convert colours: the Van der Straaten qc blue is (0, 0, 1) in CAMZ-001 and
# (0.17, 0.31, 0.64) in CAMZ-005, its Rf green (0, 0.5, 0) vs (0, 0.48, 0.25)
# (hue 120 vs 151 degrees). 35 degrees keeps blue / green / red / magenta
# (60+ degrees apart) distinct.
STROKE_HUE_TOLERANCE_DEG = 35.0
STROKE_MIN_SATURATION = 0.35
# A black target (the DOV qc curve) matches dark, unsaturated strokes.
GREY_STROKE_MAX_SATURATION = 0.25
DARK_STROKE_MAX_VALUE = 0.35

# A vertex next to a clipped one whose two neighbours are at most this many
# scan steps apart is the plotter's clip-edge crossing, not a scan.
CLIP_CROSSING_STEP_SHARE = 1.25

# Consecutive curve segments further apart than this (pt) start a new chain;
# a chain with at most MIN_CHAIN_VERTICES vertices is a legend arrow or a mark,
# not data (the u2 legend arrow of a Van der Straaten CPTU sheet is magenta).
CHAIN_GAP_PT = 2.0
MIN_CHAIN_VERTICES = 5

# A curve stroke is at least this wide (pt); thinner strokes of the same colour
# are axis arrows, hatching or the panel's grid.
MIN_CURVE_STROKE_WIDTH_PT = 0.5

# ---------------------------------------------------------------------------
# Raster
# ---------------------------------------------------------------------------

# Render resolution for the raster path (dpi). 300 dpi puts a 0.02 m depth step
# of a 65 mm-per-metre sheet on ~1.5 px, the resolution limit worth chasing.
RASTER_DPI = 300

# Skew search: coarse sweep, then a fine sweep around the best coarse angle.
SKEW_SEARCH_MAX_DEG = 3.0
SKEW_COARSE_STEP_DEG = 0.1
SKEW_FINE_STEP_DEG = 0.01
# The skew search runs on a downscaled copy no longer than this (px).
SKEW_WORK_MAX_SIDE_PX = 1600

# A pixel darker than this (0..255 grey) can belong to a grid line. Kept light
# on purpose: the DOV grid is pink (grey ~158) and an anti-aliased 0.24 pt
# grid line at 200 dpi renders mid-grey, not black.
LINE_INK_THRESHOLD = 200

# A straight line is at least this fraction of the page height / width long.
MIN_VERTICAL_LINE_FRACTION = 0.2
MIN_HORIZONTAL_LINE_FRACTION = 0.08

# Line centres closer than this (px) are one line (anti-aliased double pixel).
LINE_MERGE_PX = 3

# The morphological probe that keeps straight lines is this fraction of the
# page side; a line survives an opening with it, text and curve wiggles do not.
LINE_PROBE_FRACTION = 0.04
# Vertical lines of one panel start and end together within this fraction of
# the page height (a tick mark or a legend rule does not).
PANEL_EXTENT_FRACTION = 0.03
# A horizontal line crosses a panel when it covers this share of its width.
PANEL_CROSSING_SHARE = 0.8

# Grid lines of one panel are equally spaced within this relative tolerance.
# Tight on purpose: neighbouring Van der Straaten panels sit 17.0 pt apart on
# an 18.35 pt pitch (7 %), and must not merge into one panel.
GRID_PITCH_RELATIVE_TOLERANCE = 0.05

# A panel has at least this many vertical grid lines (both edges + one inside).
MIN_PANEL_VERTICAL_LINES = 3

# A colour whose RGB channels spread less than this (0..1) is grey / black.
CHROMATIC_SPREAD = 0.2

# Chromatic curve pixels: saturation and value floors in OpenCV HSV (0..255).
# Tried 40/40 for the navy-looking scanned curve of CAMZ-005 p. 303 (RGB ~(51,
# 67, 85)): it did not rescue that annotated scan and let anti-aliased grey
# into clean renders (qc RMS 0.41 -> 0.68 MPa), so the floors stay here.
MIN_CURVE_SATURATION = 90
MIN_CURVE_VALUE = 60
# Hue distance (OpenCV hue units, 0..180) within which a pixel matches a colour.
HUE_TOLERANCE = 12
# An achromatic (black) curve: grey level below this counts as curve ink.
BLACK_CURVE_THRESHOLD = 110

# A pixel run wider than this share of the panel is a horizontal rule in the
# curve's colour (the Van der Straaten ground-level line), not the curve.
FULL_WIDTH_RULE_SHARE = 0.9

# Pixel runs in one row separated by more than this (px) are separate runs.
RUN_GAP_PX = 2

# OCR of a raster page reads this share of the page height above the panels
# (tick labels + axis names).
OCR_STRIP_SHARE = 0.06
# An OCR'd tick label snaps to the grid line within this share of the pitch.
OCR_SNAP_PITCH_SHARE = 0.35

# The order raster panels are assumed to come in when neither an OCR'd label
# nor a curve colour names them: the Flemish / Dutch convention qc | fs | Rf.
RASTER_FALLBACK_PANEL_ORDER: tuple[PanelKind, ...] = (PanelKind.QC, PanelKind.FS, PanelKind.RF)

# ---------------------------------------------------------------------------
# Overlay
# ---------------------------------------------------------------------------

# Overlay colours (OpenCV BGR): the digitised curve in orange and the frames
# in cyan, colours no CPT sheet in the two reports uses.
OVERLAY_CURVE_BGR = (0, 140, 255)
OVERLAY_FRAME_BGR = (255, 200, 0)

# ---------------------------------------------------------------------------
# Sheet header (sounding block): position, vertical datum, date
# ---------------------------------------------------------------------------

# The horizontal system a sheet names next to its coordinates -> EPSG. Only a
# NAMED system places a sounding: an unnamed one is left for the user to type,
# never guessed (a Lambert72 X and an RD X are both six-digit metres).
COORDINATE_SYSTEM_PATTERNS: tuple[tuple[re.Pattern[str], int], ...] = (
    (re.compile(r"Lambert\s*(?:19)?72|\bL72\b", re.IGNORECASE), 31370),
    (re.compile(r"Rijksdriehoek|\bRD\b|Amersfoort", re.IGNORECASE), 28992),
)

# The vertical datum a sheet names for its ground level -> EPSG (TAW = the
# Belgian "Tweede Algemene Waterpassing", NAP = the Dutch datum).
VERTICAL_DATUM_PATTERNS: tuple[tuple[re.Pattern[str], int], ...] = (
    (re.compile(r"\bm?TAW\b", re.IGNORECASE), 5710),
    (re.compile(r"\bm?NAP\b", re.IGNORECASE), 5709),
)

# A printed day-month-year date ("28-2-2024", "31/10/2024", "29.01.2024") and
# an ISO date; anything else is kept raw and not turned into a date.
DAY_MONTH_YEAR_PATTERN = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b")
ISO_DATE_PATTERN = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")

# Any number in a field value. A coordinate value is the LAST number: the
# label's own "(Lambert72)" can leak into the value text ("(Lambert72) : 66980.21").
FIELD_NUMBER_PATTERN = re.compile(r"[-+−]?\d+(?:[.,]\d+)?")

# Stamped on the provenance of every imported sounding: which digitiser read
# it. Bump when a change moves digitised values, so a stored CPT says which
# rules produced it.
DIGITISER_VERSION = "pdf-digitiser 1.0"

# ---------------------------------------------------------------------------
# Import (digitised sounding -> stored CPT)
# ---------------------------------------------------------------------------

# ``import_provenance.source`` of every CPT this digitiser created.
PDF_PROVENANCE_SOURCE = "pdf-digitised"

# ``import_provenance.depth_source``: what the stored depth is (owner
# 2026-09-30: an elevation-axis sheet's depth is "derived from plotted
# elevation" = printed ground level - elevation).
DEPTH_SOURCE_PLOTTED = "plotted depth"
DEPTH_SOURCE_ELEVATION = "derived from plotted elevation"

# ``import_provenance.series_sampling`` (owner 2026-09-30: vector vertices ARE
# the scans and are stored as they are; raster traces are resampled to 0.02 m).
SAMPLING_VECTOR = "vector vertices (no resampling)"
SAMPLING_RASTER = "raster trace resampled to 0.02 m"

# A secondary curve's vertex counts as sitting on a qc scan when it is this
# close in depth (m): half a millimetre, far below the 0.02 m scan step, so
# only the same scan drawn twice (qc and fs of one GEF row) matches.
VERTEX_MATCH_TOLERANCE_M = 0.0005

# The GEF-style project id of a sounding whose report carries no campaign code.
PDF_FALLBACK_PROJECT_ID = "PDF"

# The same overlay colours as PyMuPDF RGB (0..1): the import dialog's overlay
# is drawn with PyMuPDF alone, so it works without the optional OpenCV.
OVERLAY_CURVE_RGB = (1.0, 0.55, 0.0)
OVERLAY_FRAME_RGB = (0.0, 0.78, 1.0)
# Stroke widths of the overlay in PDF points: thin enough to see the printed
# curve beside the digitised one, thick enough to stay visible at 80-110 dpi.
OVERLAY_CURVE_WIDTH_PT = 0.9
OVERLAY_FRAME_WIDTH_PT = 0.6

# ---------------------------------------------------------------------------
# Import dialog: report store, upload, rendering
# ---------------------------------------------------------------------------

# Triaged reports kept in memory (digest + digitised soundings). A report is
# a few MB of arrays; the user works one report at a time, so four covers a
# back-and-forth between two reports in two projects.
MAX_CACHED_PDF_REPORTS = 4
# Spooled report files kept per project in the temp store; the oldest go.
MAX_SPOOLED_PDF_REPORTS_PER_PROJECT = 5
# Largest report accepted for upload: a 300-page scanned report is ~150 MB.
MAX_PDF_UPLOAD_BYTES = 200 * 1024 * 1024
# Page thumbnails of the triage list, and the calibration overlay.
PAGE_THUMBNAIL_DPI = 80
OVERLAY_DPI = 110
# Bounds on a requested render resolution (a thumbnail to a zoomed overlay).
MIN_RENDER_DPI = 24
MAX_RENDER_DPI = 200
