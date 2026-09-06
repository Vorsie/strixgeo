"""Value object: :class:`FormalCodeCount`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FormalCodeCount:
    """One DOV formal-stratigraphy code a candidate's boreholes pair it with.

    A single :class:`~groundmodel.application.stratigraphy_candidate.StratigraphyCandidate`
    carries a list of these so the fill dialog can show which DOV formal
    code(s) sit behind an informal candidate name — and, when several codes
    map to the same informal name across boreholes, make the disagreement
    visible (owner dogfeed 2026-09-05).

    Attributes
    ----------
    code : str
        The DOV formal-stratigraphy code as the dialog should display it —
        the catalogue's canonical casing (``"GeVl"``, ``"TtEg"``) when the
        code resolves in the DOV lexicon, otherwise the raw code seen in the
        borehole's formal stream.
    count : int
        Number of distinct in-scope boreholes that pair the candidate with
        this formal code.
    catalog_name : str or None
        The canonical Dutch name from the DOV formal-stratigraphy lexicon
        (e.g. ``"Lid van Egem (Formatie van Hyon)"``), or ``None`` when the
        code is not in the lexicon.  The dialog offers this as a one-click
        target so the engineer can accept the DOV code's own formation
        instead of guessing; it is also how old and new codes for the same
        member (``TtEg`` / ``HyEg`` are both ``Lid van Egem``) are recognised
        as one unit — both resolve to a name sharing the member.
    """

    code: str
    count: int
    catalog_name: str | None
