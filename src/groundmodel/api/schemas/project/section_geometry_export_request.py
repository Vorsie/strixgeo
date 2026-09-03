"""Request body for the closed-geometry section exports (D-Series).

The D-Stability and D-Sheet Piling exports need the section's filled
POLYGONS, and the fill is computed in the renderer
(``computeSectionFill``) — the backend never re-derives it. So these two
exports are POSTs carrying the same ``SectionPartitionInput`` payload the
3-D voxel build already sends, rather than GETs like the DXF / Plaxis /
PDF exports which only need the formation picks.

Requiring the partition rather than defaulting it is deliberate: a
backend-derived approximation would be a second, simpler, DIFFERENT
partition — a plausible geometry that disagrees with the section on
screen. Pydantic answers 422 when it is absent, which is the honest
outcome.
"""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.project.voxel_build_request import (
    SectionPartitionInputSchema,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SectionGeometryExportRequest(StrictRequestModel):
    """The drawn 2-D partition of ONE section, as the renderer produced it.

    Attributes
    ----------
    partition : SectionPartitionInputSchema
        The section's columns (with their along-section distances) and
        its filled regions (in gap-local fractions against absolute
        elevation). Same shape as one entry of the voxel build's
        ``sections`` list, so the frontend reuses
        ``buildVoxelRequest``'s partition builder unchanged.
    """

    partition: SectionPartitionInputSchema = Field(
        description="The section's drawn partition fill, from the renderer.",
    )
