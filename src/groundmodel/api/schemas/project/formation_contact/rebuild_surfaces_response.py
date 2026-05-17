"""Pydantic schema: :class:`RebuildSurfacesResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class RebuildSurfacesResponse(BaseModel):
    """Result of ``POST /projects/{pid}/geology/models/{mid}/surfaces/rebuild``.

    ``formations_considered`` counts the formations that have at
    least one contact in this model — these are the ones the rebuild
    loop visits. ``formations_rebuilt`` is the subset whose
    recomputed checksum differed from the cached one (i.e. the cache
    write fired). On a clean model both are 0.

    ``formations_reordered`` counts formations whose ``display_order``
    the auto-age toposort updated to match the data. Defaults to 0
    so older clients that don't know the field still parse the
    response cleanly.
    """

    formations_considered: int
    formations_rebuilt: int
    formations_reordered: int = 0
