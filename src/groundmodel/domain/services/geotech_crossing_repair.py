"""Sweep crossing correlation ties out of a geotech model — machine ones only.

Owner ruling, 2026-08-17: *"Ties shouldn't be able to cross, if any crossing
ties are in my test.strix it is because you generated them, not because i drew
them."*  With the boundary he set in the same breath: *"user made ties should be
left alone."*

Why a repair pass and not a stricter emitter
--------------------------------------------
Both halves of his claim were measured before this module existed.  Today's
derivation, run read-only against his real CS1 data, emits a perfectly monotone
S9↔B3 gap::

    B3  0.00 -> S9  1.21        B3 10.63 -> S9  9.68
    B3  9.00 -> S9  8.10        B3 13.27 -> S9 14.11
    B3 10.09 -> S9  9.14        B3 17.70 -> S9 20.05

His database holds three more ties in that same gap — ``S9 6.71 -> B3 0.00``,
``S9 6.71 -> B3 6.50`` and ``S9 8.10 -> B3 1.00`` — which today's code does not
produce, and the last two invert against each other (``8.10`` is below ``6.71``
on S9 and ``1.00`` is above ``6.50`` on B3).  They are legacy rows from an older
derivation, all ``source='auto'``, and every press carries them forward: the
re-anchor preserves accepted ties across a band rebuild, and
:mod:`~groundmodel.domain.services.geotech_edge_crossing_guard` only gates NEW
candidates — it cannot refuse a row that is already stored.

So the emitter needed nothing.  The stored rows needed a sweep, and the fact that
every offender is machine-made is what makes the sweep safe.

The rule
--------
Per section and per gap, delete machine ties until no two remaining ties cross,
always taking the tie that crosses the most others first.  One tie inverting
against three is one defect, not three: deleting the three would strip a gap of
its real correlations and keep the wrong one.

Two machine ties that cross ONLY each other are the exception: both go.  There is
no honest way to pick between them — ranking his pair by id kept ``8.10 -> 1.00``
(a 7 m jump upward) and deleted ``6.71 -> 6.50``, which is nearly horizontal — and
a crossing pair is not the *"obvious match"* his ruling allows the machine to
claim.  It is also cheap: step 2 re-derives additively, so a tie the derivation
still believes returns on the next press.  Only an isolated pair, judged in the
untouched gap; a longer tangle is thinned one tie at a time, or a zigzag would
strip the gap bare.

A hand-drawn tie is never a candidate — if two of his own lines cross, both
stand, and the gesture is where he rules that case (a crossing tie he tries to
DRAW is rejected with a toast).

A fan — two ties leaving one contact for two different ones — is NOT a crossing
and is kept: on a column carrying a single band it is how a wedge pinching out
is stated, and the renderer draws it.

Pure module: no session, no I/O, no logging.  The caller owns the DELETE and the
report.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.geotech_edge_crossing_guard import GapTie, ties_cross

__all__ = [
    "PersistedTie",
    "crossing_ties_to_delete",
]


@dataclass(frozen=True)
class PersistedTie:
    """One stored correlation tie, reduced to what the sweep needs to judge it.

    Parameters
    ----------
    edge_id : UUID
        The row to delete, or keep.
    section_id : UUID
        The cross-section the tie was drawn on.  Correlations are
        section-scoped, so the same two bands may legitimately be tied on two
        sections and neither can cross the other.
    gap : tuple[str, str]
        The two investigations the tie spans, in the order its depths are
        recorded — build it with
        :func:`~groundmodel.domain.services.geotech_edge_crossing_guard.gap_key`
        so a tie derived right-to-left lands in the same bucket.
    depth_first_m : float
        Depth below collar of the endpoint on the gap's first column, with the
        side (top vs base of the band) already resolved into it.
    depth_second_m : float
        Depth below collar of the endpoint on the gap's second column.
    source : str
        ``'manual'`` for a line the engineer drew — never deleted — or
        ``'auto'`` for a machine one.
    """

    edge_id: UUID
    section_id: UUID
    gap: tuple[str, str]
    depth_first_m: float
    depth_second_m: float
    source: str

    @property
    def is_manual(self) -> bool:
        """Whether the engineer drew this tie, and it is therefore untouchable."""
        return self.source == "manual"

    def as_gap_tie(self) -> GapTie:
        """The crossing-guard shape, so both sides share one arithmetic."""
        return GapTie(
            depth_first_m=self.depth_first_m,
            depth_second_m=self.depth_second_m,
            accepted=True,
            layer_first_id=str(self.edge_id),
            layer_second_id=str(self.edge_id),
        )


def crossing_ties_to_delete(ties: list[PersistedTie]) -> list[UUID]:
    """Which stored ties to delete so no two remaining ones cross.

    Parameters
    ----------
    ties : list[PersistedTie]
        Every correlation tie on the geotech model, any order.

    Returns
    -------
    list[UUID]
        The ids to delete, in the order the rows were given.  Empty when nothing
        crosses, which is the ordinary case and leaves the model untouched.
        Deterministic — an isolated machine pair goes whole, and any other
        stalemate is broken by the lower id surviving — so a repeated press
        cannot churn the model.
    """
    doomed: set[UUID] = set()
    by_gap: dict[tuple[UUID, tuple[str, str]], list[PersistedTie]] = {}
    for tie in ties:
        by_gap.setdefault((tie.section_id, tie.gap), []).append(tie)

    for bucket in by_gap.values():
        standing = list(bucket)
        # Crossing counts in the UNTOUCHED bucket. The pair rule below reads
        # these, not the live counts: after a removal any chain link looks like
        # an isolated pair, and dropping each pair wholesale would strip a
        # zigzag gap bare instead of thinning it.
        original_crossings = {
            tie.edge_id: sum(
                1
                for other in bucket
                if other.edge_id != tie.edge_id and ties_cross(other.as_gap_tie(), tie.as_gap_tie())
            )
            for tie in bucket
        }
        while True:
            # Recount every round: removing the worst offender can clear several
            # crossings at once, and the survivors must be judged against what is
            # actually left rather than against the original set.
            crossings = {
                tie.edge_id: sum(
                    1
                    for other in standing
                    if other.edge_id != tie.edge_id
                    and ties_cross(other.as_gap_tie(), tie.as_gap_tie())
                )
                for tie in standing
            }
            worst = [tie for tie in standing if crossings[tie.edge_id] > 0 and not tie.is_manual]
            if not worst:
                # Either nothing crosses, or every remaining crossing is between
                # ties the engineer drew — his to resolve, never ours.
                break
            worst.sort(key=lambda tie: (-crossings[tie.edge_id], tie.edge_id.int))
            victim = worst[0]
            doomed.add(victim.edge_id)
            standing = [tie for tie in standing if tie.edge_id != victim.edge_id]

            # An isolated PAIR of machine ties crossing only each other has no
            # honest survivor: ranking them by id kept his 8.10 -> 1.00 (a 7 m
            # jump upward) and deleted 6.71 -> 6.50, which is nearly horizontal.
            # The machine cannot tell which of its own two claims is right, and a
            # crossing pair is not the "obvious match" his ruling allows. Cheap,
            # too: step 2 re-derives additively, so a claim still believed comes
            # straight back. Only a pair — a longer tangle is thinned one at a
            # time so a zigzag cannot strip the gap bare.
            if original_crossings[victim.edge_id] == 1:
                partner = next(
                    tie
                    for tie in bucket
                    if tie.edge_id != victim.edge_id
                    and ties_cross(tie.as_gap_tie(), victim.as_gap_tie())
                    and tie.edge_id not in doomed
                )
                if not partner.is_manual and original_crossings[partner.edge_id] == 1:
                    doomed.add(partner.edge_id)
                    standing = [tie for tie in standing if tie.edge_id != partner.edge_id]

    return [tie.edge_id for tie in ties if tie.edge_id in doomed]
