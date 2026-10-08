"""Constants of the borehole-log PDF digitiser (geometry tolerances, patterns, versions).

Distances are PDF points (1/72 inch, y growing downward, PyMuPDF's
convention). Every value was measured on the owner's boorstaat and
boorprofiel reports (2026-10-08); the comment says what it separates.
"""

from __future__ import annotations

import re

# Stamped on the provenance of every parsed borehole. Bump when a change moves
# a parsed depth, text or sample, so a stored borehole says which rules read it.
BOREHOLE_DIGITISER_VERSION = "borehole-pdf-digitiser 0.1"

# --- Rules: the horizontal lines that separate the description rows -------
# A description rule spans the description column (170-240 pt on the real
# sheets); the frame, header bar and title-block lines have other right ends.
RULE_MIN_LENGTH_PT = 100.0
# A segment is horizontal when its two ends differ by less than this in y.
RULE_FLAT_TOLERANCE_PT = 0.5
# Rules of one description column share their right end to 0.1 pt (the left
# end moves where a leader line joins them); clustered on the right end.
RULE_RIGHT_END_TOLERANCE_PT = 1.5
# Two segments at one y (a rule drawn in two pieces) are one rule.
RULE_SAME_Y_PT = 0.6
# A page needs at least this many rules (top + base of one row) to be a sheet.
MIN_RULES = 2

# --- Level labels: one number per rule, left-aligned in one column --------
# Labels start from 14 pt left of the rule's left end (boorstaat, boorprofiel)
# to 2 pt right of it (where the rule starts under the label, 13-6-2025).
LABEL_REACH_LEFT_PT = 24.0
LABEL_REACH_RIGHT_PT = 6.0
# Labels of one column share their left edge to 0.1 pt; sample numbers and
# stray filter numbers sit 4-16 pt away and fall in another column.
LABEL_COLUMN_TOLERANCE_PT = 1.0
# The first label sits just above the first rule; text further up is header.
ABOVE_FIRST_RULE_PT = 15.0
# A word in the level column that is mostly number characters but does not
# parse ("15O") is an unreadable level, reported rather than dropped; a word
# that is mostly letters ("TR1", "ST10": sample codes the boorprofiel prints
# in the same column) is not a level at all.
LABEL_DIGIT_PATTERN = re.compile(r"\d")
LEVEL_CHARACTERS = frozenset("0123456789+-−.,")
LABEL_MIN_NUMBER_SHARE = 0.5

# A word printed again within this (pt) of itself with the same text is an
# overprint (bold by printing three times, 0.15-0.3 pt apart), read once.
OVERPRINT_TOLERANCE_PT = 1.0

# --- Description text ------------------------------------------------------
# Description words start at most this far left of the rule's left end (the
# boorprofiel prints them 3.4 pt right of it, the boorstaat 11 pt).
DESCRIPTION_LEFT_SLACK_PT = 2.0
# ... and their lines run past the rule's right end ("Drill" at 405 pt on a
# rule ending at 404; 540 on a 522 rule): words starting up to this far right.
DESCRIPTION_RIGHT_SLACK_PT = 80.0
# Words of a description row share a printed line within this (pt).
DESCRIPTION_LINE_TOLERANCE_PT = 2.5

# --- Sample marks ------------------------------------------------------------
# A sample bar is a thin vertical rectangle (4 pt wide on the boorstaat).
SAMPLE_BAR_MAX_WIDTH_PT = 8.0
SAMPLE_BAR_MIN_HEIGHT_PT = 2.0
# Its id is printed just right of it (1.5 pt on the boorstaat).
SAMPLE_LABEL_REACH_PT = 8.0
# Words of one sample id lie at most this far apart ("D1" 12 pt right of
# "50 - 0550471387/" is another sample's id) ...
SAMPLE_ID_WORD_GAP_PT = 4.0
# ... and closer than this they are printed as one token ("1-0550471478").
SAMPLE_ID_TIGHT_GAP_PT = 1.0
# Fill per RGB channel: all at most this = filled (black bar); all at least
# that = open (white bar); anything coloured (a yellow sand patch) = no bar.
SAMPLE_FILLED_MAX_CHANNEL = 0.35
SAMPLE_OPEN_MIN_CHANNEL = 0.85

# --- Depth axis --------------------------------------------------------------
# Tick labels of the depth axis are drawn with a trailing tick glyph on the
# boorprofiel ("6.00—"); stripped before parsing.
AXIS_LABEL_TRAILING = "—–-‒ "
# A depth axis needs this many labels: the last sheet of a borehole may print
# only two ("9500", "9600"), and two define the line.
MIN_AXIS_LABELS = 2
# With three labels or more they must lie on one line within this (pt); a
# column of sample numbers (uneven spacing) fails it.
AXIS_MAX_RESIDUAL_PT = 1.5
# Runs whose right edges lie this close are one axis column (right-aligned
# labels; "0" ends 1.1 pt left of "100" on the boorstaat).
AXIS_COLUMN_TOLERANCE_PT = 3.0

# --- Page classes ------------------------------------------------------------
# A text layer needs this many characters to be read; fewer = needs OCR.
MIN_TEXT_LAYER_CHARS = 20
# Image area / page area at or above which a page is a photo page.
PHOTO_IMAGE_COVERAGE = 0.5
# ... with fewer characters than this (a log sheet prints far more text than a
# photo caption).
PHOTO_MAX_CHARS = 300
# A page with no text but at least this many drawing commands holds content
# (outlined text, a drawn log) that only OCR can read.
MIN_DRAWINGS_FOR_CONTENT = 50
LEGEND_PATTERN = re.compile(r"\bLegend(?:a|e)?\b", re.IGNORECASE)
# The title of a page: its words in this top share. A legend page prints
# "Legenda" there (a lab sheet prints "Legende" beside a graph further down);
# an unnamed log prints "Log sheet" there (report text mentioning a
# "boorbeschrijving" mid-page is no log).
TITLE_TOP_SHARE = 0.2
# Words that mark a borehole log when no layout profile matches (triage only).
GENERIC_LOG_PATTERN = re.compile(
    r"boorstaat|boorbeschrijving|boorprofiel|log\s+sheet|borehole\s+log|core\s+name"
    r"|\bBoring\s*(?:nr\.?)?\s*:",
    re.IGNORECASE,
)

# --- OCR (optional) ----------------------------------------------------------
# Whole-page OCR resolution for a page without a text layer: 150 dpi reads the
# 7-9 pt header text of the scanned / outlined logs at ~3-5 s per page.
OCR_PAGE_DPI = 150

# --- Joining sheets ----------------------------------------------------------
# Two printed level values within this (m) are the same boundary.
LEVEL_MATCH_TOLERANCE_M = 0.005
# A header ground level and the first printed level farther apart than this
# (m) disagree (reported, the header wins).
GROUND_LEVEL_TOLERANCE_M = 0.01
# Where a borehole's ground level came from (stored on the header).
GROUND_FROM_HEADER = "header"
GROUND_FROM_FIRST_LEVEL = "first-level"
# Depths are stored to the millimetre (levels are printed to the centimetre).
DEPTH_DECIMALS = 3

# --- Validation issue codes (stable; the desktop catalogue keys on them) -----
# A level label that is not a number: that boundary has no depth (ERROR).
ISSUE_LEVEL_UNREADABLE = "PDF_BOREHOLE_LEVEL_UNREADABLE"
# Level labels and rules do not pair one to one: the sheet's rows get no
# depth (ERROR), their text is kept.
ISSUE_LEVEL_COUNT_MISMATCH = "PDF_BOREHOLE_LEVEL_COUNT_MISMATCH"
# Readable levels rise somewhere down the sheet (WARNING).
ISSUE_LEVELS_NOT_FALLING = "PDF_BOREHOLE_LEVELS_NOT_FALLING"
# Neither a printed ground level nor a first level: no depth at all (ERROR).
ISSUE_NO_GROUND_LEVEL = "PDF_BOREHOLE_NO_GROUND_LEVEL"
# Ground level from the first printed level, not from a header field (INFO).
ISSUE_GROUND_LEVEL_FROM_FIRST_LEVEL = "PDF_BOREHOLE_GROUND_LEVEL_FROM_FIRST_LEVEL"
# Header ground level and first printed level disagree (WARNING; header kept).
ISSUE_GROUND_LEVEL_DISAGREES = "PDF_BOREHOLE_GROUND_LEVEL_DISAGREES"
# X/Y printed without a named coordinate system (WARNING; numbers kept).
ISSUE_XY_SYSTEM_UNNAMED = "PDF_BOREHOLE_XY_SYSTEM_UNNAMED"
# No X/Y printed (ERROR for a later import).
ISSUE_NO_XY = "PDF_BOREHOLE_NO_XY"
# A continuation sheet's first row overlaps the previous sheet with another
# text: both kept as printed (WARNING).
ISSUE_SHEET_JOIN_TEXT_DIFFERS = "PDF_BOREHOLE_SHEET_JOIN_TEXT_DIFFERS"
# The last row of the borehole has no closing level (WARNING).
ISSUE_OPEN_BASE = "PDF_BOREHOLE_OPEN_BASE"
# A row between two rules carries no text (WARNING).
ISSUE_EMPTY_DESCRIPTION = "PDF_BOREHOLE_EMPTY_DESCRIPTION"
# A water level whose unit or reference is not printed: raw text only (INFO).
ISSUE_WATER_UNIT_UNPRINTED = "PDF_BOREHOLE_WATER_UNIT_UNPRINTED"
# A borehole printed again inside an earlier one's depth range (WARNING; the
# owner has not ruled whether to drop it like the CPT digitiser drops repeats).
ISSUE_PRINTED_AGAIN = "PDF_BOREHOLE_PRINTED_AGAIN"
# A sample bar found but the depth axis could not be fitted (WARNING).
ISSUE_SAMPLE_WITHOUT_AXIS = "PDF_BOREHOLE_SAMPLE_WITHOUT_AXIS"

# --- Overlay -----------------------------------------------------------------
OVERLAY_RULE_RGB = (0.0, 0.7, 0.9)
OVERLAY_ROW_RGB = (1.0, 0.45, 0.0)
OVERLAY_LABEL_RGB = (0.85, 0.0, 0.6)
OVERLAY_SAMPLE_RGB = (0.0, 0.6, 0.0)
OVERLAY_WIDTH_PT = 0.8
OVERLAY_FONT_SIZE = 6.0
