"""Constants shared by the Geosys text-export parsers."""

import re

# Every Geosys export we have seen is ISO-8859-1 (``ë`` = 0xEB, ``³`` = 0xB3)
# with CRLF line ends. Decoding as UTF-8 would fail on the first ``Poriënvolume``.
GEOSYS_ENCODING = "latin-1"

# Geosys writes Belgian-locale numbers: decimal COMMA, optional exponent
# ("-5,999565E-03"). A thousands separator never appears in these exports.
GEOSYS_NUMBER_RE = re.compile(r"^[-+]?\d+(?:,\d+)?(?:[eE][-+]?\d+)?$")

# A value followed by its unit in a header line ("96,1 kPa", "19,96 mm").
GEOSYS_VALUE_UNIT_RE = re.compile(r"^\s*([-+]?\d+(?:,\d+)?(?:[eE][-+]?\d+)?)\s*(.*)$")

# Sampling-depth interval as printed by every export ("14,50-15,00",
# "5,25 - 5,35"). Group 1 = top, group 2 = base, in metres below ground.
GEOSYS_DEPTH_RANGE_RE = re.compile(r"^\s*(\d+(?:,\d+)?)\s*-\s*(\d+(?:,\d+)?)\s*$")
