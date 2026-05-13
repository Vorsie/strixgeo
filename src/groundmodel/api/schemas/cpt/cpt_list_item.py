"""Pydantic schema for a CPT summary item in list responses."""

from uuid import UUID

from pydantic import BaseModel


class CptListItem(BaseModel):
    """Lightweight CPT summary returned by GET /cpt/.

    Only metadata columns are included — series arrays are omitted so the list
    endpoint stays fast regardless of series size.

    Parameters
    ----------
    id:
        Primary key of the CPT record.
    name:
        Human-readable identifier.
    cpt_type:
        Cone type string: "CPTU", "CPTE", "CPTM", or "UNKNOWN".
    max_depth_m:
        Deepest measurement depth in metres.
    n_rows:
        Number of data rows in the series table.
    """

    id: UUID
    name: str
    cpt_type: str
    max_depth_m: float | None
    n_rows: int | None
    # Location fields are included so map markers render from a single list call
    # without firing one GET /cpt/{id} per CPT just to get coordinates.
    location_x: float
    location_y: float
    epsg: int | None
    # Surface elevation is in the list payload so the sidebar can render the
    # Phase 3a "needs Z" badge without firing GET /cpt/{id} per row. ``None``
    # means the source omitted Z and the user has not entered one yet.
    elevation_m: float | None
    z_epsg: int | None
    # Provenance of ``elevation_m`` — ``"dov"`` / ``"gef"`` /
    # ``"manual"`` / ``"none"``. Surfaced in the list payload so the
    # sidebar can render a tiny "(DOV)" / "(manual)" tag next to the Z
    # value without a second GET /cpt/{id} fetch. Debt #8.
    elevation_source: str
