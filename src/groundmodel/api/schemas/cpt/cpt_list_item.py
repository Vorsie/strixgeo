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
    start_date:
        Date the CPT was performed, as stored in the source file
        (``file_date`` from the GEF/DOV parser — raw pass-through, no
        re-parsing here per Data Integrity Rule §2). ``None`` when the
        source omitted it or the GEF file did not include a date.
        Format varies by source: DOV typically delivers an ISO-ish string
        (``"2019-03-14"``); GEF may omit it entirely.  Named ``start_date``
        for symmetry with ``BoreholeListItem.start_date``; the frontend
        normalises both to a comparable date via ``parseInvestigationDate``.
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
    # Raw pass-through from ``cpt_orm.file_date`` (String(20) column).
    # No parsing or conversion — consumers normalise. Optional so the field
    # can be absent on older bundle snapshots without breaking deserialisers.
    start_date: str | None = None
