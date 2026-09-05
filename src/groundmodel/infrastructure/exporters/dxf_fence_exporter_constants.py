"""Constants for :mod:`groundmodel.infrastructure.exporters.dxf_fence_exporter`.

Grouped here per the project convention (module-level constants never sit
at the top of a class file) rather than inline in ``dxf_fence_exporter.py``.
"""

from __future__ import annotations

# DXF layer name prefix for fence wall panels. Mirrors the ``GeoModel-``
# prefix ``dxf_section_exporter.py`` uses for per-formation layers, so the
# section export and the fence export read consistently in CAD's layer
# browser (an engineer who has opened one already recognises the other).
FENCE_LAYER_PREFIX = "Fence-"

# AutoCAD truncates layer names at 255 characters — the same limit
# ``dxf_section_exporter.py`` observes for its formation layers.
MAX_LAYER_NAME_LEN = 255

# DXF forbids these characters in layer names.
FORBIDDEN_LAYER_CHARS = frozenset("<>/\\\":;?*|='")

# Separator between the section token and the unit token in a fence layer
# name (owner ruling 2026-09-05: "one layer per section and formation"). A
# layer reads ``Fence-<section>_<unit>`` — e.g. ``Fence-CS1_NAD-06_ZAND`` —
# so a whole section hides behind the ``Fence-CS1_*`` wildcard in CAD while a
# unit stays selectable across sections with ``Fence-*_NAD-06_ZAND``.
#
# ``_`` NOT ``|``: ``|`` is in FORBIDDEN_LAYER_CHARS (DXF forbids it in a
# layer name), so ``_sanitise_layer_name`` would silently STRIP it and
# collapse ``section|unit`` into ``sectionunit``. ``_`` is not forbidden,
# survives the forbidden-char strip, and reads as a field separator in
# AutoCAD's layer list — the same ``_`` already inside the NAD identifier
# (``NAD-06_ZAND``).
SECTION_UNIT_SEPARATOR = "_"

# Application id under which each exported 3DFACE carries its wall's body id
# as XDATA (owner ruling 2026-09-05: "each wall's body is recorded on the
# entity so a body can be found"). XDATA is the standard, geometry-neutral
# way to hang a machine-readable tag on a DXF entity: it changes neither the
# layer, the colour nor the shape, an AutoCAD LISP / data-extraction pass
# reads it straight back, and the LIST command shows it — so a body is
# recoverable from any one of its faces with no bespoke plugin. The layer
# name already answers "which section, which unit"; the body id answers
# "which resolved body", which no layer name should carry (a body spans
# sections, so it is not a per-section split key).
BODY_ID_XDATA_APPID = "STRIXGEO"

# XDATA group code 1000 = an ASCII string value (the DXF-defined code for a
# string inside an XDATA record). The body id (a UUID / weld label) rides in
# it; a UUID is 36 chars, well under the 255-byte XDATA string limit.
BODY_ID_XDATA_STRING_CODE = 1000

# Fallback true-colour (mid-grey) for a panel whose ``color`` string fails
# to parse. A malformed colour from the renderer must not block the export
# of otherwise-valid geometry — the panel still lands in CAD, just in the
# default shade instead of its intended NAD colour.
DEFAULT_LAYER_RGB: tuple[int, int, int] = (128, 128, 128)
