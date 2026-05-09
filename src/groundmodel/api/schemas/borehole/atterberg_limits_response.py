"""Pydantic schema for one Atterberg-limits lab test on a sample."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AtterbergLimitsResponse(BaseModel):
    """Liquid limit, plastic limit, and non-plastic flag for a ``Sample``.

    Plasticity index is **derived on read** by the domain entity's
    ``@property`` and is NOT a separate field — clients compute
    ``LL - PL`` themselves when both are present and ``non_plastic`` is
    not ``True``. Storing the index would risk drift after row edits.

    DOV ships LL and PL as separate observation rows (parametergroep
    ``"Onderkenning - proeven"``) which the orchestrator collapses into
    one row per sample. ``non_plastic=True`` is the orchestrator's
    interpretation of a PL row with ``detectieconditie="NM"`` — i.e. the
    sample cannot be rolled into a 3 mm thread.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    liquid_limit_pct: float | None
    plastic_limit_pct: float | None
    non_plastic: bool | None
    method: str | None
    test_date: date | None
