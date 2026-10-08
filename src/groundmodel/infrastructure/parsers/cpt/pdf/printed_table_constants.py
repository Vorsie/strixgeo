"""Constants of the "printed table" profile family of the PDF CPT digitiser.

A report of this family prints every sounding as a graph sheet (one pasted
picture of the curves) and as a numeric table of the measured values, a row
per 0.20 m, under the same text header on every sheet. The values below were
read from the owner's test report of 2026-10-08 (143 pages, 15 soundings);
the comment on each says why it is what it is.
"""

from __future__ import annotations

import re

from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_profile import PrintedTableProfile
from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole

# A printed number of a table cell: optional sign, digits, an optional decimal
# part after a comma (or a point), an optional degree sign (the friction angle
# column prints "15,52°"). The sign may be a Unicode minus.
PRINTED_NUMBER_PATTERN = re.compile(r"^(?P<sign>[-+−]?)(?P<int>\d+)(?:[.,](?P<dec>\d+))?°?$")

# Words of one column header phrase are a normal space apart ("Rf, %" is
# "Rf," then "%" 3 pt further); neighbouring column headers are 9 pt or more
# apart ("%" ends at 259 pt, "Inclinatie," starts at 268 pt).
COLUMN_PHRASE_GAP_PT = 6.0

# The printed numbers are right-aligned under right-aligned column headers:
# a cell belongs to the column whose header's right edge lies within this
# distance of its own right edge (pt). Real columns are >= 42 pt apart, the
# real cells end within 1 pt of their header.
COLUMN_ALIGN_TOLERANCE_PT = 8.0

# A row whose depth step from the row above is longer than this many printed
# steps has at least one row missing: a drilled stretch inside the table
# (owner ruling "a", 2026-10-04). One and a half steps tolerates the rounding
# of the printed depths and never takes a whole missing row for noise.
MISSING_ROW_STEP_FACTOR = 1.5

# An image covering at least this share of the page is the graph picture of
# a graph sheet (the real ones cover ~75 %); the report logo is ~1 %.
GRAPH_PICTURE_MIN_COVERAGE = 0.35

# A page of a sheet header whose column header names a DEPTH but holds a
# column this profile does not know is a CALCULATION table (bearing capacity:
# Gnd, Pb, Vbd, qd, ...): its kind in ``PrintedTablePage``.
PAGE_KIND_DATA = "data"
PAGE_KIND_GRAPH = "graph"
PAGE_KIND_CALCULATION = "calculation"
PAGE_KIND_HEADER_ONLY = "header-only"

# ``import_provenance.printed_table.source_kind`` and the digest profile name.
PRINTED_TABLE_SOURCE_KIND = "printed-table"

# The column header phrases, normalised (lower case, spaces and commas
# dropped), and what each holds. The legend of the test report: qc and fs in
# MN/m2 = MPa, Rf in %, Qt the total resistance in kN, Qst the total sleeve
# friction in kN, "I (°)" the inclination; φ' (De Beer) and C are CALCULATED
# ("Berekende waarden") and never imported.
PRINTED_TABLE_COLUMN_ROLES: dict[str, TableColumnRole] = {
    "d": TableColumnRole.DEPTH,
    "taw": TableColumnRole.LEVEL,
    "qc": TableColumnRole.QC,
    "fs": TableColumnRole.FS,
    "rf%": TableColumnRole.RF,
    "rf": TableColumnRole.RF,
    "inclinatie°": TableColumnRole.INCLINATION,
    "inclinatie": TableColumnRole.INCLINATION,
    "qt": TableColumnRole.TOTAL_FORCE,
    "qst": TableColumnRole.TOTAL_FORCE,
    "φ'": TableColumnRole.DERIVED,
    "φ": TableColumnRole.DERIVED,
    "ϕ'": TableColumnRole.DERIVED,
    "ϕ": TableColumnRole.DERIVED,
    "c": TableColumnRole.DERIVED,
}

PRINTED_TABLE_PROFILE = PrintedTableProfile(
    name=PRINTED_TABLE_SOURCE_KIND,
    # "Z1234567 - CPTE001": the report number, a spaced dash, the sounding
    # id. The spaces matter: campaign codes ("CAMZ-001") carry none.
    sheet_id=re.compile(
        r"(?P<report>\b[A-Z]{1,4}\d{5,})\s+-\s+(?P<id>[A-Z]{2,}[A-Z0-9]*\d[A-Za-z0-9]*)\b"
    ),
    column_roles=PRINTED_TABLE_COLUMN_ROLES,
    test_type=re.compile(r"proef\s*type\s+(?P<type>T[EMU]\d)\b", re.IGNORECASE),
    standard=re.compile(
        r"ISO\s*(?P<part>22476-\d+)\s*,\s*toepassings?klasse\s+(?P<klass>\d+)", re.IGNORECASE
    ),
    cone=re.compile(r"\bCPT-(?P<kind>[EMU])\b"),
    # ISO 22476-1 electric cone = CPTE (CPTU with a pore-pressure sensor);
    # ISO 22476-12 mechanical cone = CPTM: the GEF classification names.
    cpt_type_by_cone={"E": "CPTE", "U": "CPTU", "M": "CPTM"},
    test_date=re.compile(
        r"Uitvoeringsdatum\s*:\s*(?P<date>\d{1,2}[-/.]\d{1,2}[-/.]\d{4})", re.IGNORECASE
    ),
    position=re.compile(
        r"GPS\s*X\s*:\s*(?P<x>[-+]?\d+(?:[.,]\d+)?)\s+GPS\s*Y\s*:\s*(?P<y>[-+]?\d+(?:[.,]\d+)?)",
        re.IGNORECASE,
    ),
    groundwater=re.compile(r"\bGRW\s*:\s*(?P<text>[^\n]+)", re.IGNORECASE),
    remark_label=re.compile(r"\bOpmerking\s*:", re.IGNORECASE),
    # "voorgeduwd met vaste punt tot een diepte van 1 m : geen meetswaarden"
    # (the report spells it "meetswaarden" and "meetwaarden").
    pre_drill=re.compile(
        r"voorgeduwd\b.*?tot\s+een\s+diepte\s+van\s+(?P<depth>\d+(?:[.,]\d+)?)\s*m\b",
        re.IGNORECASE | re.DOTALL,
    ),
    # "gesloten punt vanaf 30,32 m tot 30,34 m : geen meetwaarden": the cone
    # was pushed closed through a hard layer, nothing was measured there.
    no_measurement=re.compile(
        r"gesloten\s+(?:punt|conus)\s+vanaf\s+(?P<top>\d+(?:[.,]\d+)?)\s*m\s+tot\s+"
        r"(?P<base>\d+(?:[.,]\d+)?)\s*m",
        re.IGNORECASE,
    ),
)

# The built-in printed-table profiles, tried in order (first sheet-id hit wins).
BUILT_IN_PRINTED_TABLE_PROFILES: tuple[PrintedTableProfile, ...] = (PRINTED_TABLE_PROFILE,)
