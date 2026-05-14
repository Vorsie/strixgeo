"""Codelist API route handlers.

Today exposes one resource — the G3Dv3 stratigraphic catalog — so the
desktop frontend can offer autocomplete in the manual-create
formation dialog. Future codelist surfaces (hoofdnaam translation,
HCOV, BRO when it lands) live here alongside.

The route is read-only and unauthenticated; the catalog ships with
the app, not per-user data, and the response is static across the
process lifetime so the frontend can cache aggressively.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from groundmodel.infrastructure.codelists.g3dv3_catalog import (
    G3Dv3Unit,
    get_catalog,
)

router = APIRouter(prefix="/codelists", tags=["codelists"])


class G3Dv3UnitResponse(BaseModel):
    """One G3Dv3 unit, serialised for the frontend autocomplete.

    Field shape mirrors ``G3Dv3Unit`` but flattens the ``h3d_*``
    triplet — the frontend doesn't need hydrogeology codes today.
    Keep them off the wire to lower the payload (40 KB vs 60 KB)
    and to leave room to evolve the H3D shape without affecting the
    autocomplete contract.
    """

    code: str
    abbreviation: str
    rank: str
    parent_abbreviation: str | None
    name_nl: str
    age_rank: int
    color_hex: str | None

    @classmethod
    def from_unit(cls, unit: G3Dv3Unit) -> G3Dv3UnitResponse:
        """Build a response object from a domain ``G3Dv3Unit``."""
        return cls(
            code=unit.code,
            abbreviation=unit.abbreviation,
            rank=unit.rank,
            parent_abbreviation=unit.parent_abbreviation,
            name_nl=unit.name_nl,
            age_rank=unit.age_rank,
            color_hex=unit.color_hex,
        )


class G3Dv3CatalogResponse(BaseModel):
    """Top-level response wrapper for ``GET /codelists/g3dv3``.

    Wrapping the list in an object leaves headroom for future
    metadata fields (catalog version, last-refreshed date, alias
    count) without breaking the frontend's parse path.
    """

    units: list[G3Dv3UnitResponse]


@router.get("/g3dv3", response_model=G3Dv3CatalogResponse)
async def get_g3dv3_catalog() -> G3Dv3CatalogResponse:
    """Return every G3Dv3 unit, in age order (youngest first).

    The catalog is process-singleton (lru_cache), so this handler is
    effectively a serialise + return. Frontend caches the response
    in-memory after the first call.

    Returns
    -------
    G3Dv3CatalogResponse
        ``{"units": [...]}`` with 117 units on today's catalog.
    """
    catalog = get_catalog()
    return G3Dv3CatalogResponse(
        units=[G3Dv3UnitResponse.from_unit(u) for u in catalog.all_units()],
    )
