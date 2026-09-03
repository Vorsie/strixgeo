"""Pydantic schema: :class:`SetGeotechStatisticRequest`."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SetGeotechStatisticRequest(StrictRequestModel):
    """Change a geotech model's representative-qc statistic (owner ruling 7).

    Parameters
    ----------
    statistic : Literal
        One of the four owner-approved tokens. The Literal duplicates the
        domain's ``REPRESENTATIVE_STATISTICS`` on purpose: an invalid token is
        rejected at the wire with FastAPI's own 422 before any code runs.
    """

    statistic: Literal["median", "arithmetic", "harmonic", "geometric"] = Field(
        ..., description="The representative-qc statistic the classifier reads."
    )
