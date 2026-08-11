"""Constants for the geotech NAD subdivision stage.

Companion module to :mod:`geotech_subdivision` — keeps module-level constants
out of the class file per project convention.
"""

from __future__ import annotations

# Weakest (lowest-numbered) NAD packing class for each lithology family.
# NAD numbering runs weak → strong within a lithology, so the minimum is the
# most conservative (loosest packing / weakest consistency).
#
# GRIND : 1–4    (matig gp / dicht gp — two clean + two secondary variants)
# ZAND  : 5–12   (los / matig / dicht / zeer dicht × clean + secondary)
# SILT  : 13–20  (weinig vast / matig vast / vrij vast / vast × clean + secondary)
# KLEI  : 21–28  (same four bands × clean + secondary)
# VEEN  : 29–31  (weinig vast / matig vast / vast — no secondary variant)
#
# Source: Belgian NAD table (ANB Tabel 2.1 + NAD-NEN sheet, Task T0).
# NOTE (audit F19): the borehole absolute-min fallback no longer reads this —
# it uses ``nad_classifier.loosest_class_for``, which is variant-aware (a
# silthoudend zand floors to 9, not 5). This constant stays for the integration
# suite's family-floor assertions, which are variant-blind by construction.
LITHO_ABSOLUTE_MIN_NAD: dict[str, int] = {
    "GRIND": 1,
    "ZAND": 5,
    "SILT": 13,
    "KLEI": 21,
    "VEEN": 29,
}
