"""Constants for the newer oedometer module's raw export parser.

Format after geolib_rvo ``gui/gui_03_consolidatie.lees_nieuwe_module`` and
``examples/gallery/g06_consolidatie.py`` (owner's own library): the module's
raw dump ``uit_nieuwemodule.csv``. Dutch labels verbatim, English meaning in
the comment next to each.
"""

import re

# The newer module writes UTF-8 WITH a byte-order mark (unlike the old control
# exports, which are ISO-8859-1). ``utf-8-sig`` strips the BOM.
OED_NEW_ENCODING = "utf-8-sig"

# Header lines: "#<label>: <value>;;;;;;;;" — the module pads every header
# line with empty ";" cells up to the table width, so the value ends at the
# first ";". Group 1 = label, group 2 = value.
OED_NEW_HEADER_RE = re.compile(r"^#([^:;]+):\s*([^;]*)")
# Reading rows sit between these two markers.
OED_NEW_START_MARKER = "#START_METINGEN"  # "start of measurements"
OED_NEW_END_MARKER = "#EINDE_METINGEN"  # "end of measurements"
# Every reading row has these nine cells, in this order:
#   0 Trapnummer                               stage number
#   1 Datum/tijd                               " dd/mm/yyyy hh:mm:ss.fff"
#   2 tijd sinds begin proef (s)               seconds since the test start
#   3 tijd sinds begin trap (s)                seconds since the stage start
#   4 meetwaarde meetklok (mm)                 dial reading, mm
#   5 vervorming sinds begin van de proef (mm) cumulative deformation, mm
#   6 vervorming sinds begin van de trap (mm)  stage deformation, mm
#   7 belasting (kg)                           load on the lever hanger, kg
#   8 tijd sinds begin trap (min)              minutes since the stage start
OED_NEW_FIELD_COUNT = 9
OED_NEW_TIMESTAMP_FORMAT = "%d/%m/%Y %H:%M:%S.%f"

# Header labels promoted to typed fields.
OED_NEW_LABEL_JOB_NUMBER = "Dossiernummer"  # dossier = lab job (GEO-23/099)
OED_NEW_LABEL_SAMPLE_NUMBER = "Monsternummer"  # lab sample number (24/1036)
OED_NEW_LABEL_TEST_NAME = "Proefnaam"  # test name ("1e ingave" = first entry)
OED_NEW_LABEL_HEIGHT = "Hoogte proefstuk (mm)"  # specimen height, mm
OED_NEW_LABEL_DIAMETER = "Diameter proefstuk (mm)"  # specimen diameter, mm
OED_NEW_LABEL_MASS = "Massa van het proefstuk (g)"  # specimen mass, g
OED_NEW_LABEL_LEVER_RATIO = "Overbrenging"  # lever (force transfer) ratio
OED_NEW_LABEL_WATER_CONTENT = "Initieel watergehalte (%)"  # initial water content, %

# Canonical keys of the per-reading columns the listing does not have. They
# ride on ``OedometerStage.extra_channels``.
OED_NEW_EXTRA_LOAD_KG = "load_kg"
OED_NEW_EXTRA_ELAPSED_STAGE_S = "elapsed_stage_s"
OED_NEW_EXTRA_ELAPSED_TEST_S = "elapsed_test_s"
