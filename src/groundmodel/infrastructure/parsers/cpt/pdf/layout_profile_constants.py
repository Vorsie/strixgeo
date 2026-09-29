"""The built-in layout profiles of the PDF CPT digitiser.

Two profiles cover the two 23.15 proefverslagen (CAMZ-001, CAMZ-005): the
contractor's own Van der Straaten sheets and the reprinted DOV sheets of the
desk study. The generic profile is the fallback for an unknown company: it
knows the common Dutch / English axis words and nothing else.
"""

from __future__ import annotations

import re

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile import LayoutProfile
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DEFAULT_CAMPAIGN_CODE_PATTERN,
    DOV_SHEET_PATTERN,
)

# Axis-label phrases per quantity, searched in the phrase (words on one line a
# normal space apart) next to a tick run. Order matters: Rf is tried before
# fs; "wrijving\b" does not match inside "Wrijvingsgetal" anyway. Long words
# match as a prefix, because OCR glues words ("Hellingshoekingraden"); the
# short symbols (qc, fs, Rf, u2) must stand alone.
GENERIC_PANEL_LABELS: dict[PanelKind, re.Pattern[str]] = {
    PanelKind.RF: re.compile(r"\b(wrijvingsgetal|frictiegetal|friction\s*ratio)|\bR_?f\b", re.I),
    PanelKind.QC: re.compile(r"\b(conusweerstand|puntdruk|cone\s*resistance)|\bq_?c\b", re.I),
    PanelKind.FS: re.compile(r"\b(wrijving|kleef|f_?s)\b|\bsleeve\s*friction", re.I),
    PanelKind.U2: re.compile(r"\b(waterspanning|waterdruk|pore\s*pressure)|\bu_?2\b", re.I),
    PanelKind.INCLINATION: re.compile(r"\b(hellingshoek|helling|inclination)", re.I),
}

GENERIC_UNITS: dict[PanelKind, str] = {
    PanelKind.QC: "MPa",
    PanelKind.FS: "MPa",
    PanelKind.RF: "%",
    PanelKind.U2: "kPa",
    PanelKind.INCLINATION: "deg",
}

# Sounding-block labels, Dutch contractor sheets. Spaces are optional: OCR of
# a title block drops them ("HOOGTEMAAIVELD", "IDSONDERING").
GENERIC_FIELD_LABELS: dict[str, re.Pattern[str]] = {
    "sounding_id": re.compile(r"ID\s*SONDERING|Sondering\s*(nr|nummer)\.?|Proefnummer", re.I),
    "project": re.compile(r"PROJECTNUMMER|Projectnummer|Opdrachtnummer", re.I),
    "location": re.compile(r"\bLOCATIE\b", re.I),
    "ground_level": re.compile(r"HOOGTE\s*MAAIVELD|Z\s*\(mTAW\)|Maaiveld\s*\(m", re.I),
}

# The unit of a stored quantity and the factor from a printed unit to it.
# Strix stores qc / fs / u2 in MPa and Rf in %.
UNIT_TO_STORAGE_FACTOR: dict[str, float] = {"MPa": 1.0, "kPa": 0.001, "%": 1.0, "deg": 1.0}

# Van der Straaten Geotechniek B.V. (Hansweert, NL): qc blue, fs red, Rf
# green, u2 magenta, inclination thin black; elevation axis in m TAW; u2 in
# kPa on a reversed axis below the qc panel. Colours read from the drawing
# commands of CAMZ-001 p. 172 / p. 248.
VAN_DER_STRAATEN_PROFILE = LayoutProfile(
    name="van-der-straaten",
    fingerprint=re.compile(r"Van\s*der\s*Straaten\s*Geotechniek|vd-straaten\.nl", re.I),
    panel_labels=GENERIC_PANEL_LABELS,
    curve_colours={
        PanelKind.QC: (0.0, 0.0, 1.0),
        PanelKind.FS: (1.0, 0.0, 0.0),
        PanelKind.RF: (0.0, 0.502, 0.0),
        PanelKind.U2: (1.0, 0.0, 1.0),
    },
    default_units=GENERIC_UNITS,
    field_labels=GENERIC_FIELD_LABELS,
    campaign_code_pattern=DEFAULT_CAMPAIGN_CODE_PATTERN,
    min_curve_width=0.5,
    bottom_axis_kind=PanelKind.U2,
)

# DOV (Databank Ondergrond Vlaanderen) sounding sheet: qc black, fs green, Rf
# magenta on a reversed 20..0 axis, pink grid, both a depth and an elevation
# ("peil") axis. Always desk study: DOV already holds the data, so import
# from DOV instead of digitising.
DOV_PROFILE = LayoutProfile(
    name="dov",
    fingerprint=DOV_SHEET_PATTERN,
    panel_labels=GENERIC_PANEL_LABELS,
    curve_colours={
        PanelKind.QC: (0.0, 0.0, 0.0),
        PanelKind.FS: (0.0, 0.6, 0.3),
        PanelKind.RF: (0.67, 0.0, 0.67),
    },
    default_units={**GENERIC_UNITS, PanelKind.U2: "MPa"},
    field_labels=GENERIC_FIELD_LABELS,
    campaign_code_pattern=DEFAULT_CAMPAIGN_CODE_PATTERN,
    is_desk_study_source=True,
    preferred_depth_reference=DepthReference.DEPTH_BELOW_GROUND,
    min_curve_width=0.0,
)

GENERIC_PROFILE = LayoutProfile(
    name="generic",
    fingerprint=None,
    panel_labels=GENERIC_PANEL_LABELS,
    curve_colours={
        PanelKind.QC: (0.0, 0.0, 1.0),
        PanelKind.FS: (1.0, 0.0, 0.0),
        PanelKind.RF: (0.0, 0.502, 0.0),
        PanelKind.U2: (1.0, 0.0, 1.0),
    },
    default_units=GENERIC_UNITS,
    field_labels=GENERIC_FIELD_LABELS,
    campaign_code_pattern=DEFAULT_CAMPAIGN_CODE_PATTERN,
)

# Registry order: the first fingerprint hit wins. DOV first, because a
# contractor report that reprints a DOV sheet carries the contractor's name in
# its running header on the same page.
BUILT_IN_PROFILES: tuple[LayoutProfile, ...] = (DOV_PROFILE, VAN_DER_STRAATEN_PROFILE)
