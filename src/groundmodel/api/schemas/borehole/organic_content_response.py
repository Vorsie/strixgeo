"""Pydantic schema for one organic-content lab test on a sample."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrganicContentResponse(BaseModel):
    """Organic carbon (OC) and/or organic matter (OM), each % of dry mass.

    The two fields are **independent** — never auto-derived from one
    another. The Van Bemmelen factor ``OM ≈ 1.724 × OC`` is empirical
    and soil-type-dependent; consumers needing OM from OC must apply it
    at presentation time and clearly label the result as derived.

    DOV ships organic CARBON (``Organische C - percentage``) under
    parametergroep ``"Bodem_chemisch"`` — so rows from DOV imports
    typically have ``carbon_pct`` populated and ``matter_pct`` ``None``.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    carbon_pct: float | None
    matter_pct: float | None
    method: str | None
    test_date: date | None
