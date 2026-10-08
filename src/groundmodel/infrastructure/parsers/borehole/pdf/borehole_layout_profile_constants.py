"""The built-in borehole-log layout profiles (owner material 2026-10-08).

* ``boorstaat``: the report layout of the 149d / 24.13-002 boorstaten and of
  the 21.04 boringen report (same drawing software, two header wordings):
  levels printed in cm TAW as integers, depth axis in cm below ground, the
  header names Lambert72 and mTAW, "Identificatie volgens NEN-EN-ISO 14688".
  Its legend page prints an open sample bar = "geroerd monster" (disturbed)
  and a filled bar = "ongeroerd monster" (undisturbed).
* ``boorprofiel``: the CAMZ-007 location-A layout: levels in m TAW with two
  decimals, elevation axis in m TAW, header "X:" / "Y:" without a named
  coordinate system, page footer "Bijlage: / Pagina: n / N". Its legend was
  not checked for the sample marks, so no sample type is given.
* ``generic``: triage only. Classifies a page as a borehole log and reads its
  name when no profile above matches (the scanned and outlined logs, other
  contractors' sheets); never reads rows.

Profiles are tried in this order; the first whose required patterns all
match the page text applies. Company names never appear here (the profiles
are named after the layout, not after whoever drew it).
"""

from __future__ import annotations

import re

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile import (
    BoreholeLayoutProfile,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    GENERIC_LOG_PATTERN,
)

_I = re.IGNORECASE

# "X-coördinaat" extracts as "X-co�rdinaat" from one font: any one character.
_X_LABEL = re.compile(r"\bx-co.?.?rdinaat(?:\s*\[[^\]]*\])?\s*:", _I)
_Y_LABEL = re.compile(r"\by-co.?.?rdinaat(?:\s*\[[^\]]*\])?\s*:", _I)

BOORSTAAT_PROFILE = BoreholeLayoutProfile(
    name="boorstaat",
    required=(
        re.compile(r"\bBoring\s*:", _I),
        re.compile(r"Maaiveldhoogte|Hoogte\s+tov\s+TAW", _I),
    ),
    header_fields=(
        ("name", re.compile(r"\bBoring\s*:", _I)),
        ("x", _X_LABEL),
        ("y", _Y_LABEL),
        (
            "ground_level",
            re.compile(r"Maaiveldhoogte\s+in\s+mTAW\s*:|Hoogte\s+tov\s+TAW\s+in\s+m'?\s*:", _I),
        ),
        ("water", re.compile(r"Grondwaterstand(?:\s*\[[^\]]*\]|\s+in\s+cm'?)?\s*:", _I)),
        ("date", re.compile(r"Uitgevoerd\s+op\s*:|\bDatum\s*:", _I)),
        ("driller", re.compile(r"Uitvoering\s+door\s*:|Boormeester\s*:", _I)),
        ("project_code", re.compile(r"Projectcode\s*:", _I)),
        ("project_name", re.compile(r"Projectnaam\s*:", _I)),
        ("remark", re.compile(r"Opmerking\s*:", _I)),
    ),
    level_pattern=re.compile(r"^[-+]?\d+$"),
    level_unit_m=0.01,
    axis_unit_m=0.01,
    identification_pattern=re.compile(
        r"Identificatie\s+volgens\s+(NEN-EN-ISO\s+14688(?:-\d)?)", _I
    ),
    sample_mark_meaning={"open": "geroerd", "filled": "ongeroerd"},
)

BOORPROFIEL_PROFILE = BoreholeLayoutProfile(
    name="boorprofiel",
    required=(
        re.compile(r"\bBoring\s*:", _I),
        re.compile(r"\bBijlage\s*:", _I),
        re.compile(r"\bPagina\s*:\s*\d+\s*/\s*\d+", _I),
    ),
    header_fields=(
        ("name", re.compile(r"\bBoring\s*:", _I)),
        ("date", re.compile(r"\bDatum\s*:", _I)),
        ("x", re.compile(r"(?<![\w-])X\s*:")),
        ("y", re.compile(r"(?<![\w-])Y\s*:")),
        ("water", re.compile(r"\bGWS\s*:", _I)),
        ("remark", re.compile(r"Opmerking\s*:", _I)),
        ("ground_level", re.compile(r"\bMaaiveld\s*=", _I)),
        ("project_code", re.compile(r"Projectcode\s*:", _I)),
        ("project_name", re.compile(r"Projectnaam\s*:", _I)),
        ("page_of", re.compile(r"\bPagina\s*:", _I)),
    ),
    level_pattern=re.compile(r"^[-+]?\d+[.,]\d{2}$"),
    level_unit_m=1.0,
    axis_unit_m=1.0,
)

GENERIC_PROFILE = BoreholeLayoutProfile(
    name="generic",
    required=(GENERIC_LOG_PATTERN,),
    header_fields=(
        ("name", re.compile(r"\bBoring\s*(?:nr\.?)?\s*:|Location\s*or\s*core\s*name\s*:?", _I)),
        ("date", re.compile(r"\bDatum\s*:|\bDate\b", _I)),
        ("project_code", re.compile(r"Project\s*(?:nr\.?|code)\s*:", _I)),
        # "Location or core name NSZ S156 Sheet no. 2 of 13": no colon ends
        # the name, the next label does.
        ("page_of", re.compile(r"\bSheet\s*no\.?", _I)),
    ),
    level_pattern=None,
    parses_rows=False,
)

#: Tried in order; the generic profile last.
BOREHOLE_LAYOUT_PROFILES: tuple[BoreholeLayoutProfile, ...] = (
    BOORSTAAT_PROFILE,
    BOORPROFIEL_PROFILE,
    GENERIC_PROFILE,
)
