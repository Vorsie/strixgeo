"""Pydantic schema for the POST /cpt/import-dov request body."""

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.infrastructure.parsers.dov.dov_common import validate_wgs84_import_bbox


class ImportDovRequest(StrictRequestModel):
    """WGS84 bounding box + project scope for a DOV CPT import."""

    west: float = Field(..., ge=-180, le=180, description="Western longitude (decimal degrees)")
    south: float = Field(..., ge=-90, le=90, description="Southern latitude (decimal degrees)")
    east: float = Field(..., ge=-180, le=180, description="Eastern longitude (decimal degrees)")
    north: float = Field(..., ge=-90, le=90, description="Northern latitude (decimal degrees)")
    project_id: UUID | None = None

    @model_validator(mode="after")
    def _validate_bbox(self) -> "ImportDovRequest":
        """Reject a reversed / degenerate / oversized bbox at parse time (-> 422).

        Shares one validator with the borehole request schema so both endpoints
        enforce the same ordering + area guard. A ``ValueError`` here is turned
        into the request's 422 by pydantic.
        """
        validate_wgs84_import_bbox(
            west=self.west, south=self.south, east=self.east, north=self.north
        )
        return self
