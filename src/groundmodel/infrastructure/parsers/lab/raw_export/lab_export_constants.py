"""Constants shared by the raw lab text-export parsers."""

import re

# Every control listing / point dump we have seen is ISO-8859-1 (``ë`` = 0xEB, ``³`` = 0xB3)
# with CRLF line ends. Decoding as UTF-8 would fail on the first ``Poriënvolume``.
LAB_EXPORT_ENCODING = "latin-1"

# The exports write Belgian-locale numbers: decimal COMMA, optional exponent
# ("-5,999565E-03"). A thousands separator never appears in these exports.
LAB_EXPORT_NUMBER_RE = re.compile(r"^[-+]?\d+(?:,\d+)?(?:[eE][-+]?\d+)?$")

# A value followed by its unit in a header line ("96,1 kPa", "19,96 mm").
LAB_EXPORT_VALUE_UNIT_RE = re.compile(r"^\s*([-+]?\d+(?:,\d+)?(?:[eE][-+]?\d+)?)\s*(.*)$")

# Sampling-depth interval as printed by every export ("14,50-15,00",
# "5,25 - 5,35"). Group 1 = top, group 2 = base, in metres below ground.
LAB_EXPORT_DEPTH_RANGE_RE = re.compile(r"^\s*(\d+(?:,\d+)?)\s*-\s*(\d+(?:,\d+)?)\s*$")

# Source-format stamps: which export a parsed test came from. Stored on the
# imported test (``lab_series_test.source_format``) so a later reader knows
# the units of the dial column and which cross-checks ran.
LAB_EXPORT_FORMAT_OED_LISTING = "oed_control_listing"  # dial in gauge units
LAB_EXPORT_FORMAT_OED_NEW_RAW = "oed_new_module_raw"  # dial in mm
LAB_EXPORT_FORMAT_TX_DUMP = "tx_point_dump"  # TX and Advanced TX per-point dump
