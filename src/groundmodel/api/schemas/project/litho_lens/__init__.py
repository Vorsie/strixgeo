"""Formation-absence schemas — kept in litho_lens package for historical reasons.

Body-related schemas (BodyListItem, NameBodyRequest, NameBodyResponse,
DetectBodiesResponse, BodyBoundaryNodeItem, BodyBoundaryResponse,
BodyBoundaryWriteRequest) have moved to
``groundmodel.api.schemas.project.body``.
"""

from groundmodel.api.schemas.project.litho_lens.upsert_formation_absence_request import (
    FormationAbsenceItem,
    UpsertFormationAbsenceRequest,
    UpsertFormationAbsenceResponse,
)

__all__ = [
    "FormationAbsenceItem",
    "UpsertFormationAbsenceRequest",
    "UpsertFormationAbsenceResponse",
]
