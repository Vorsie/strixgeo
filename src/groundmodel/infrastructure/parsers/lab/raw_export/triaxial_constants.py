"""Constants for the triaxial raw per-point dump parser.

The TX module (``cd.txt`` / ``cu.txt``) and the Advanced TX module
(``advtx*.txt``) write the SAME dump layout; one set of constants serves both.
Dutch labels are the dump's spelling verbatim; English meaning in comments.
"""

import re

# Specimen block start: "Identificatiegegevens deelmonster \ta" (identification
# data of sub-specimen a). Group 1 = the specimen letter.
TX_SPECIMEN_RE = re.compile(r"^Identificatiegegevens deelmonster\s+(\S+)\s*$")
# The point table header line starts with this label ("measuring point").
TX_TABLE_HEADER_LABEL = "Meetpunt"
# A table row: the point number, left-aligned in its column.
TX_TABLE_ROW_RE = re.compile(r"^\d+\s")
# The file ends with two rows of dashes.
TX_END_MARKER = "-----"
# Every column of the point table is 18 characters wide, values left-aligned.
# Verified on all five real dumps: slicing at 18 reproduces every header label
# and every value. Blank header slots mark columns the test type does not fill
# (UU prints no effective stresses).
TX_COLUMN_WIDTH = 18

# Header line: "<label>[ ]:<tabs><value>" or "<label><tabs><value>" (some
# consolidation labels carry no colon). Values after the first tab run; a
# before/after pair is separated by a second tab run.
TX_HEADER_LINE_RE = re.compile(r"^([^\t]+?)\s*:?\s*\t+(.*)$")
TX_VALUE_SPLIT_RE = re.compile(r"\t+")

# Calibration lines: "a coëfficiënt van kracht :\t\t1,0000000" (slope a /
# offset b of the channel's calibration). All five real dumps carry a=1, b=0:
# the readings are already engineering units.
TX_CALIBRATION_RE = re.compile(r"^([ab]) coëfficiënt van (\S+)")

# --- sample-level labels -----------------------------------------------------
TX_LABEL_JOB_NUMBER = "Opdrachtnummer"  # lab job (GEO-25/022)
TX_LABEL_REPORT_FOR = "Rapport bij"  # client contact the report is for
TX_LABEL_ORIGIN = "Herkomst en kenmerk"  # site text
TX_LABEL_TEST_TYPE = "Type proef"  # CD / CU / UU
TX_LABEL_BOREHOLE = "Boringnummer"  # borehole as the lab names it (B17)
TX_LABEL_SEQUENCE = "Volgnummer"  # sample sequence in the borehole (N003)
TX_LABEL_SAMPLE_NUMBER = "Monsternummer"  # lab sample number (25/0389)
TX_LABEL_DEPTH = "Diepte ontname (m)"  # sampling interval, m below ground
TX_LABEL_DESCRIPTION = "Grondsoort op zicht"  # visual description

# --- specimen-level labels ---------------------------------------------------
TX_LABEL_STRAIN_RATE = "Vervormingssnelheid"  # set axial displacement rate, mm/min
TX_LABEL_GRAIN_DENSITY = "Volumemassa"  # labelled "density" but it is the GRAIN density (2,65)
TX_LABEL_HEIGHT = "Oorspronkelijke hoogte"  # initial height, mm
TX_LABEL_DIAMETER = "Oorspronkelijke diameter"  # initial diameter, mm
TX_LABEL_WET_MASS = "Massa nat"  # initial wet mass, g
TX_LABEL_IMPORT_FILE = "Importbestand"  # machine import file kind ("Normalised" / "-")
TX_LABEL_CONSOLIDATION_STRESS = "Consolidatiespanning"  # effective consolidation stress, kPa
TX_LABEL_CONSOLIDATION_DV = "Volumeverandering tijdens consolidatie"  # dV in consolidation, cm3
TX_LABEL_FINAL_WET_MASS = "Massa nat na de proef"  # wet mass after the test, g
TX_LABEL_DRY_MASS = "Massa droog"  # dry mass, g
TX_LABEL_FINAL_DV = "Volumeverandering na de proef"  # volume change after the test, cm3
TX_LABEL_FAILURE = "Type breuk / Afschuifhoek"  # failure mode / shear-plane angle, verbatim
TX_LABEL_AREA = "Dwarsdoorsnede"  # cross-section area before the test, mm2
TX_LABEL_VOLUME = "Volume"  # volume before / after, mm3
TX_LABEL_CALIBRATION_FILE = "Gebruikt ijkbestand"  # calibration file used
TX_LABEL_PRESS = "Gebruikte pers"  # load frame / GDS press id

# --- point-table channels ----------------------------------------------------
# Header label → canonical key. MEASURED = what the machine logged (after the
# zero reading was subtracted); LAB_DERIVED = what the lab program computed from them.
# The split drives provenance: a lab-derived channel is stored pass-through but
# tagged as the lab's computation, never as a measurement (Data Integrity §1-2).
TX_POINT_NUMBER_KEY = "point_number"
TX_MEASURED_CHANNELS: dict[str, str] = {
    "Kracht": "force_n",  # axial force above the zero reading, N
    "Verpl.": "displacement_um",  # axial displacement above the zero reading, µm
    "Stnsp.": "cell_pressure_kpa",  # cell (confining) pressure, kPa
    "P.W.S.": "pore_pressure_kpa",  # pore water pressure, kPa
    "dV": "volume_change_cm3",  # specimen volume change, cm3 (drained tests only)
}
TX_LAB_DERIVED_CHANNELS: dict[str, str] = {
    "Verv.": "axial_strain_pct",  # axial strain, %
    "Sigma 1-3": "deviator_stress_kpa",  # deviator stress (membrane-corrected), kPa
    "Sigma' 3": "sigma3_eff_kpa",  # effective radial stress, kPa
    "Sigma' 1": "sigma1_eff_kpa",  # effective axial stress, kPa
    "Sigma'1/Sigma'3": "eff_stress_ratio",  # effective principal stress ratio
    "Sigma 3": "sigma3_total_kpa",  # total radial stress, kPa
    "Sigma 1": "sigma1_total_kpa",  # total axial stress, kPa
    "Sigma 1 /Sigma 3": "total_stress_ratio",  # total principal stress ratio
}

# --- finding thresholds -------------------------------------------------------
# A deviator stress of more than this at zero force is a correction the lab
# applied from the first point (every real CU specimen: -10 kPa).
TX_DEVIATOR_OFFSET_TOLERANCE_KPA = 0.05
# A strain of more than this at zero displacement means the strain column is
# not displacement / height (cu.txt specimen b: -0.38 %).
TX_STRAIN_OFFSET_TOLERANCE_PCT = 0.001
