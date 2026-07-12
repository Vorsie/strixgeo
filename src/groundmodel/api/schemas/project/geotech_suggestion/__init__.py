"""Geotech-suggestion API schemas.

One class per module (CLAUDE.md one-class-per-file); this package
re-exports the surface so callers import from the package path.
"""

from __future__ import annotations

from .divide_borehole_response import DivideBoreholeResponse
from .subdivide_all_bodies_request import SubdivideAllBodiesRequest
from .subdivide_all_bodies_response import SubdivideAllBodiesResponse

__all__ = [
    "DivideBoreholeResponse",
    "SubdivideAllBodiesRequest",
    "SubdivideAllBodiesResponse",
]
