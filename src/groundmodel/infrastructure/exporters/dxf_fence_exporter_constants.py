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

# Fallback true-colour (mid-grey) for a panel whose ``color`` string fails
# to parse. A malformed colour from the renderer must not block the export
# of otherwise-valid geometry — the panel still lands in CAD, just in the
# default shade instead of its intended NAD colour.
DEFAULT_LAYER_RGB: tuple[int, int, int] = (128, 128, 128)
