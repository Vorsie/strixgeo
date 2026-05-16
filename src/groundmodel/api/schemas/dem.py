"""Pydantic schemas for the DEM sampling API.

Covers two distinct use cases:

* **Section line profile** (``DemSampleLineResponse``) — the existing cross-section
  ground-line sampler that returns a 1D elevation profile along a drawn line.
* **Ground-surface TIN** (``GroundSurfaceBuildResponse``) — the G7 ground-surface
  build result: a 2D TIN mesh over the model's investigation hull, used by
  ``Geology3DViewer`` as the scene base in place of the flat ellipsoid.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from groundmodel.api.schemas.project.formation_contact import GapIssueResponse


class DemSamplePointResponse(BaseModel):
    """One elevation sample along a section line.

    ``elevation_m`` is ``null`` when the underlying pixel was NoData
    (outside the DHMVII coverage, or a known data hole).
    """

    along_m: float
    elevation_m: float | None


class DemSampleLineResponse(BaseModel):
    """Body returned by ``GET /dem/sample``.

    ``source`` echoes which provider answered (``"dhmvii"`` today;
    ``"ahn4"`` once that integration lands). ``samples`` carries the
    elevation profile from start to end of the requested line.
    """

    source: str
    samples: list[DemSamplePointResponse] = Field(default_factory=list)


class GroundSurfaceBuildResponse(BaseModel):
    """Body returned by ``POST /projects/{pid}/geology/models/{mid}/ground-surface/build``.

    Represents the ground-surface TIN — a mesh of DEM elevation samples over
    the model's investigation hull.  The ``Geology3DViewer`` renders this as
    the scene base in place of the flat ``EllipsoidTerrainProvider``.

    Attributes
    ----------
    vertices : list[list[float]]
        Flat list of ``[x_m, y_m, elevation_m]`` triples in the project's
        horizontal CRS.  Empty when no hull could be computed (no in-scope
        investigations with known x/y, or DEM unavailable for the region).
    triangles : list[list[int]]
        Vertex-index triples (counter-clockwise winding).  Empty when fewer
        than 3 valid DEM samples exist.
    provider_id : str
        Which DEM provider answered (``"dhmvii"`` / ``"ahn4"`` / ``"none"``
        when no provider covers the project's CRS).
    from_cache : bool
        ``True`` when every grid tile was served from the local filesystem
        cache — no WCS network request was made.
    issues : list[GapIssueResponse]
        Zero or more validation findings — e.g. vertices that landed on
        NoData cells (possible water-surface contamination per §11.4) or
        formation tops above the DEM (per §11.3).  An empty list means the
        ground surface is clean.
    """

    vertices: list[list[float]] = Field(default_factory=list)
    triangles: list[list[int]] = Field(default_factory=list)
    provider_id: str = "none"
    from_cache: bool = False
    issues: list[GapIssueResponse] = Field(default_factory=list)
