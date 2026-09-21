"""Project-level coordinate-reference-system defaults.

Shared across layers (API + application) so the fallback a project uses when
its ``default_horizontal_epsg`` is unset lives in exactly one place rather than
inlined at each read site.
"""

from __future__ import annotations

from typing import Final

# Horizontal CRS assumed when a project has no ``default_horizontal_epsg`` set.
# Belgian Lambert 72 — every DOV record ships in it, so a DOV-seeded project
# with no explicit default is correct, and a GEF-only project defaults to the
# most common Belgian survey CRS rather than to a geographic (degrees) CRS that
# would make along-section distances physically meaningless.
#
# This is the *default*, distinct from the section-CRS allowlist and labels in
# ``infrastructure/codelists/horizontal_crs.py`` (which is where a CRS is
# validated / named) and from the provider-pinned parser constants
# (``DOV_HORIZONTAL_EPSG`` etc., which state a specific source's CRS).
DEFAULT_HORIZONTAL_EPSG: Final[int] = 31370
