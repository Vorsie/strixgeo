"""Constants of the CPT display-name rule ("<project>-S<number>")."""

import re

# A bare sounding number as a contractor prints it on a sheet and writes it in
# the GEF ``#TESTID``: digits with at most one letter suffix ("110", "28A",
# "37b", "153A"). Anything else ("GEO-25/110-S1", "CPT-01", "S110") is already
# a full name and is shown as it is (owner ruling 2026-10-04).
BARE_SOUNDING_NUMBER = re.compile(r"\d+[A-Za-z]?")

# The GEF ``#PROJECTID`` puts a project type before the project number
# ("CPT, 23.15-002", optionally ", <sub-project>"): a first comma field of
# letters only is that type, and the field after it is the project number.
GEF_PROJECT_TYPE = re.compile(r"[A-Za-z]+")

# Joins the project number and the sounding number: "23.15-002" + "110" ->
# "23.15-002-S110", the shape DOV names its soundings in ("GEO-25/110-S1").
SOUNDING_SEPARATOR = "-S"
