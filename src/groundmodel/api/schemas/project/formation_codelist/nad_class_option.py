"""Pydantic schema: :class:`NadClassOption`."""

from __future__ import annotations

from pydantic import BaseModel


class NadClassOption(BaseModel):
    """One Belgian NAD geotechnical class for the geotech codelist.

    ``nad_class`` is the stable key (1..31, == the ``laagnr NAD-NEN``
    row + the future Phase-5 parameter join key); ``label`` is the
    canonical display name; ``base_lithology`` is the GRIND/ZAND/SILT/
    KLEI/VEEN this class subdivides.
    """

    nad_class: int
    label: str
    base_lithology: str
