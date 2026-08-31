"""Body schemas for the geology API layer."""

from groundmodel.api.schemas.project.body.body_boundary import (
    BodyBoundaryNodeItem,
    BodyBoundaryResponse,
    BodyBoundaryWriteRequest,
    BodyRenderStyle,
)
from groundmodel.api.schemas.project.body.body_geo_formation_ref import BodyGeoFormationRef
from groundmodel.api.schemas.project.body.body_list_item import BodyListItem
from groundmodel.api.schemas.project.body.clear_boundaries_response import (
    ClearBoundariesResponse,
)
from groundmodel.api.schemas.project.body.merge_enclosed_lens_response import (
    MergeEnclosedLensResponse,
)
from groundmodel.api.schemas.project.body.name_body_request import (
    NameBodyRequest,
    NameBodyResponse,
)
from groundmodel.api.schemas.project.body.update_body_color_request import (
    UpdateBodyColorRequest,
    UpdateBodyColorResponse,
)

__all__ = [
    "BodyBoundaryNodeItem",
    "BodyBoundaryResponse",
    "BodyBoundaryWriteRequest",
    "BodyGeoFormationRef",
    "BodyListItem",
    "BodyRenderStyle",
    "ClearBoundariesResponse",
    "MergeEnclosedLensResponse",
    "NameBodyRequest",
    "NameBodyResponse",
    "UpdateBodyColorRequest",
    "UpdateBodyColorResponse",
]
