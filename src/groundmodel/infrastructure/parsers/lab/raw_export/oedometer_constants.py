"""Constants for the incremental-loading oedometer control-listing parser.

Dutch labels are the listing's spelling verbatim (keys are compared after the
trailing " :" is stripped); the English meaning is in the comment next to each.
"""

import re

# --- header labels (``<label> :;<value>``) ---------------------------------
OED_LABEL_JOB_NUMBER = "Opdrachtnummer"  # job / contract number (GEO-19/122)
OED_LABEL_ORIGIN = "Herkomst en kenmerk"  # origin and reference (site)
OED_LABEL_BOREHOLE = "Boringnummer"  # borehole name as the lab writes it (B7A)
OED_LABEL_SEQUENCE = "Volgnummer"  # sample sequence number in the borehole (N002)
OED_LABEL_SAMPLE_NUMBER = "Monsternummer"  # lab sample number (20/0568)
OED_LABEL_DEPTH = "Diepte ontname (m)"  # sampling depth interval, m below ground
OED_LABEL_DESCRIPTION = "Grondsoort op zicht"  # visual soil description
OED_LABEL_HEIGHT = "Hoogte monster"  # initial specimen height, mm
OED_LABEL_DIAMETER = "Diameter monster"  # specimen diameter, mm
OED_LABEL_WET_MASS = "Massa grond"  # wet soil mass, g
OED_LABEL_WATER_CONTENT = "Watergehalte"  # water content, %
OED_LABEL_GRAIN_DENSITY = "Korrelvolumemassa"  # grain density, t/m3 (+ how obtained)
OED_LABEL_BULK_DENSITY = "Volumemassa nat"  # wet bulk density, t/m3
OED_LABEL_APPARATUS = "Apparaatnummer"  # oedometer frame number
OED_LABEL_LEVER_RATIO = "Overbrengingsverhouding kracht"  # lever (force transfer) ratio
OED_LABEL_DIAL_COEFFICIENT = "Coëff. meethorloge"  # dial gauge coefficient, mm per unit
OED_LABEL_MOUNTING_DATE = "Inbouwdatum monster"  # date the specimen was mounted (dd/mm/yy)
OED_LABEL_REMARKS = "Opmerkingen"  # lab remarks
OED_LABEL_CREATED = "CreationMark"  # "Aangemaakt door <user> op <date>"
OED_LABEL_MODIFIED = "LastModifiedMark"  # "Aangepast door <user> op <date>"
OED_LABEL_FILENAME = "Filename"  # native .OCT path + save timestamp
OED_LABEL_VERSION = "Version & date"  # the lab program's version

# The mounting date is printed with a two-digit year ("03/06/20").
OED_MOUNTING_DATE_FORMAT = "%d/%m/%y"

# The native-file line carries the path and a save timestamp separated by a
# space: "I:\geo\data\19122\200568B7.OCT 2/07/2020 11:10:07".
OED_FILENAME_RE = re.compile(r"^(.*?\.[A-Za-z0-9]+)\s+(\d{1,2}/\d{1,2}/\d{4}.*)$")

# --- stage blocks -----------------------------------------------------------
# "TRAP : 01 Belasting : 3,05 kg op het apparaat    93,568 kPa op het monster"
# (stage NN, direction = Belasting loading / Ontlasting unloading, dead load on
# the hanger in kg, stress on the specimen in kPa).
OED_STAGE_HEADER_RE = re.compile(
    r"^TRAP\s*:\s*(\d+)\s+(\S+)\s*:\s*([-\d,]+)\s*kg op het apparaat\s+([-\d,]+)\s*kPa"
)

# A reading row starts with "dd/mm/yyyy hh:mm:ss,fff" then dial;time;settle;total.
# The column header above it has SIX cells ("Afgelezen tijd;;Afgelezen;Tijd;…")
# while the rows have FIVE: the header's empty second cell is not in the data.
# The parser reads rows by position after the timestamp, never by header.
OED_READING_RE = re.compile(r"^(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2},\d+)[;\t](.*)$")
OED_TIMESTAMP_FORMAT = "%d/%m/%Y %H:%M:%S.%f"
OED_READING_FIELD_COUNT = 4  # dial, elapsed min, stage settlement, total settlement

# "hi,0= 19,209 mm  Zetting= -0,006 mm  A= 1271,0" — height at the stage start,
# stage settlement, and the lab's swelling (A, unloading) or compression (C,
# loading) coefficient. Stage 1 prints no coefficient.
OED_STAGE_FOOTER_RE = re.compile(
    r"^hi,0=\s*([-\d,]+)\s*mm\s+Zetting=\s*([-\d,]+)\s*mm(?:\s+([AC])=\s*([-\d,]+))?"
)

# The lab's per-stage summary table: header cells "Trap", "Druk", "Dhi".
OED_SUMMARY_HEADER_CELLS = ("Trap", "Druk", "Dhi")
OED_SUMMARY_FIELD_COUNT = 10
# Everything after this label is chart-axis text and a repeated copy of the
# tables; the parser reads no table rows after it.
OED_CHART_MARKER = "Controlegrafiek"
OED_GENERAL_MARKER = "Algemene gegevens"

# --- cross-check tolerances ------------------------------------------------
# g as the lab uses it: 9.81 reproduces every listed stage stress to 0.06 kPa on
# both real files; 9.80665 is off by up to 0.5 kPa.
OED_GRAVITY_M_S2 = 9.81
# The listed diameter is rounded to 0.01 mm (63,54 vs 63,541 in the .DAT), so
# the recomputed area is good to ~0.03 %; 0.5 % catches a wrong lever ratio or
# a mistyped load without firing on rounding.
OED_STRESS_REL_TOLERANCE = 0.005
# Heights are printed to 0.001 mm; allow two rounding steps.
OED_HEIGHT_CHAIN_TOLERANCE_MM = 0.002
# A dial jump smaller than this at a duplicated timestamp is gauge noise.
OED_REZERO_MIN_JUMP_MM = 0.001
# Settlement printed to 0.001 mm: "did not move" = below one print step.
OED_REZERO_MAX_SETTLEMENT_CHANGE_MM = 0.0005
# A last reading this far (or less) back from the stage's peak settlement is
# print rounding: settlement is printed to 0.001 mm, and two steps (plus float
# slack) covers the lab's rounding of both the peak and the final reading. The
# real files end one step back (20/0569 stage 7: peak -0,026, last -0,025).
# Further back than this is a real reversal and is reported as a WARNING.
OED_STEP_BACK_INFO_MAX_MM = 0.0021
