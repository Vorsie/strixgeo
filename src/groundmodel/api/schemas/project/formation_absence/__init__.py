"""Formation-absence schemas (the request/response for upserting absences).

Body-related schemas (BodyListItem, NameBodyRequest, NameBodyResponse,
BodyBoundaryNodeItem, BodyBoundaryResponse, BodyBoundaryWriteRequest) live in
``groundmodel.api.schemas.project.body``.
"""

from groundmodel.api.schemas.project.formation_absence.upsert_formation_absence_request import (
    FormationAbsenceItem,
    UpsertFormationAbsenceRequest,
    UpsertFormationAbsenceResponse,
)

__all__ = [
    "FormationAbsenceItem",
    "UpsertFormationAbsenceRequest",
    "UpsertFormationAbsenceResponse",
]
