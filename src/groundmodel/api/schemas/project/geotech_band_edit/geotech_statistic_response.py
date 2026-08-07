"""Pydantic schema: :class:`GeotechStatisticResponse`."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GeotechStatisticResponse(BaseModel):
    """The model's statistic state after a change (owner rulings 7 + 8).

    Parameters
    ----------
    representative_statistic : str
        The choice now stored on the model.
    classified_with_statistic : str | None
        What the last full "Subdivide all bodies" classified with; ``None``
        before any build.
    bands_stale : bool
        Server-derived: a build has run AND its statistic differs from the
        choice — the toolbar shows a "re-subdivide under <statistic>" tag.
        Never stored; a rebuild (which stamps ``classified_with_statistic``)
        or flipping the choice back self-clears it.
    """

    representative_statistic: str = Field(..., description="The stored choice.")
    classified_with_statistic: str | None = Field(
        None, description="What the last full build classified with."
    )
    bands_stale: bool = Field(..., description="Choice differs from the last build's stamp.")
