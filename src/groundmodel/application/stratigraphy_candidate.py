"""Value object: :class:`StratigraphyCandidate`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StratigraphyCandidate:
    """A unique formation candidate discovered from borehole stratigraphy.

    Attributes
    ----------
    name : str
        Formation name as it would be assigned by auto-populate
        (informal description preferred; formal as fallback).
    regional_ref : str or None
        Formal stratigraphy code when the primary stream was formal;
        ``None`` for informal-only boreholes.
    key : str
        Stable cross-borehole identity key — ``regional_ref`` when
        present, ``name`` otherwise.  The ``selected_keys`` filter on
        ``AutoPopulateContactsFromStratigraphy.execute`` is expressed
        in these keys; the discover endpoint returns them so the dialog
        can pass the same set back on confirm.
    borehole_count : int
        Number of boreholes in scope that carry this key.
    """

    name: str
    regional_ref: str | None
    key: str
    borehole_count: int
