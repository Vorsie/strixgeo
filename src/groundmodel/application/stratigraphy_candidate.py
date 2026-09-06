"""Value object: :class:`StratigraphyCandidate`."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.application.formal_code_count import FormalCodeCount


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
        ``None`` for informal-only boreholes.  This is the FIRST-seen code
        for the candidate; ``formal_codes`` carries the full set with counts.
    key : str
        Stable cross-borehole identity key — ``regional_ref`` when
        present, ``name`` otherwise.  The ``selected_keys`` filter on
        ``AutoPopulateContactsFromStratigraphy.execute`` is expressed
        in these keys; the discover endpoint returns them so the dialog
        can pass the same set back on confirm.
    borehole_count : int
        Number of boreholes in scope that carry this key.
    formal_codes : tuple[FormalCodeCount, ...]
        Every DOV formal-stratigraphy code the candidate's boreholes pair it
        with, each with a borehole count and (where the DOV lexicon knows it)
        the canonical name.  Empty for an informal-only candidate.  Sorted by
        count descending then code ascending.  Added 2026-09-05 (owner dogfeed)
        so the dialog can show the DOV code behind each informal name and
        surface a formal↔informal disagreement.  Defaulted to ``()`` so older
        constructions stay valid.
    """

    name: str
    regional_ref: str | None
    key: str
    borehole_count: int
    formal_codes: tuple[FormalCodeCount, ...] = field(default_factory=tuple)
