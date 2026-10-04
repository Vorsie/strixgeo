"""The dedup decision of the DOV interpretation import (owner dogfeed 2026-10-01).

"A deleted or edited DOV track comes back unchanged on a DOV bbox re-import."
The rule: a borehole the user already holds keeps its tracks as the user left
them - an edited track is never overwritten, a deleted one never comes back -
while an interpretation DOV published since (a permkey the borehole never
held) is still attached. A permkey missing from the borehole is therefore NOT
proof that it is new: the borehole remembers the DOV permkeys of the tracks
the user deleted (``BoreholeOrm.deleted_dov_permkeys``).
"""

from __future__ import annotations

from collections.abc import Collection

from groundmodel.application.dov_interpretation_verdict import DovInterpretationVerdict


def interpretation_dedup_verdict(
    permkey: str, *, stored: Collection[str], deleted_by_user: Collection[str]
) -> DovInterpretationVerdict:
    """Decide what the re-import does with the interpretation ``permkey``.

    Parameters
    ----------
    permkey : str
        The incoming interpretation's DOV permkey.
    stored : Collection[str]
        The DOV permkeys of the tracks the in-scope boreholes hold.
    deleted_by_user : Collection[str]
        The DOV permkeys of the tracks the user deleted from those boreholes.

    Returns
    -------
    DovInterpretationVerdict
        ``ALREADY_PRESENT`` when a stored track carries it (checked first: a
        stored track is never touched), ``DELETED_BY_USER`` when the user
        deleted it, else ``ATTACH``.
    """
    if permkey in stored:
        return DovInterpretationVerdict.ALREADY_PRESENT
    if permkey in deleted_by_user:
        return DovInterpretationVerdict.DELETED_BY_USER
    return DovInterpretationVerdict.ATTACH
