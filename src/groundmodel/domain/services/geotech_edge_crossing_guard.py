"""Reject a correlation tie that would cross another tie in the same gap.

Owner ruling (partition-engine v2 design §8 Q4): **crossing approved ties are a
HARD CONFLICT** — neither side bands, both fall back to pinch/lens, and the
section shows a warning until the engineer resolves it.  The renderer enforces
that faithfully (``partitionFillV2/crossingConflicts.ts`` suspends every edge in
any crossing), which makes a machine-proposed crossing pure friction: it costs
the engineer a hunt-and-delete AND it silently kills the fill on that gap.  The
owner met exactly that on dogfeed 2026-08-15 — pipeline step 2, then *"1
crossing correlation tie — resolve to restore bands"* with the bands gone.

So the proposal must never be born.  This module is the arithmetic; the
derivation (``application/geotech_edge_derivation.py``) owns the registry and
the accept/reject decision.

Definition, in the section's own terms: **two ties in one gap cross when their
endpoint order is inverted between the two columns.**  Formally, with each tie
reduced to the depth it joins on the first column and the depth it joins on the
second, the two cross when the two differences have opposite signs.  Ties that
share an endpoint fan out rather than cross, and fanning bands fine.

Two deliberate agreements with the renderer's detector, so the two sides cannot
disagree about what "crossing" means:

* **Sides matter.** A ``top`` endpoint is the band's top surface, a ``base``
  endpoint its base — the caller resolves that before building a
  :class:`GapTie`.  A mixed (``base``↔``top``) restatement of an onlap
  declaration is precisely the tie that crosses everything below the top pair,
  so a side-blind check would miss the owner's own case.
* **A shared endpoint is not a crossing** — the renderer excludes it explicitly
  (``ELEV_EPS`` on both ends), and so does :func:`ties_cross`.

One deliberate difference: this module works in **depth below collar** because
that is what the derivation has, while the renderer works in **elevation**.
The two never disagree.  Each of the two differences the test takes is WITHIN a
single column, so converting depth to elevation flips the sign of both and
leaves their product — the whole test — unchanged, whatever the two collars
are.

Pure module: no session, no I/O, no logging.  ``geotech_edge_derivation`` logs
each rejection at INFO with both endpoints.
"""

from collections.abc import Iterable
from dataclasses import dataclass

# Depth tolerance below which two endpoints count as the SAME surface, so the
# ties fan rather than cross. Mirrors the renderer's ``ELEV_EPS`` (1e-6) — this
# is a numerical-noise guard, not a geological tolerance; real bands are metres
# apart and the mm grid already rounds them.
CROSSING_TOL_M = 1e-6


@dataclass(frozen=True)
class GapTie:
    """One correlation tie reduced to the two depths it joins in a single gap.

    Attributes
    ----------
    depth_first_m : float
        Depth below collar of the endpoint on the gap's FIRST column, where
        "first" is whichever investigation :func:`gap_key` sorted first.  The
        side (top vs base of the band) is already resolved into this depth.
    depth_second_m : float
        Depth below collar of the endpoint on the gap's SECOND column.
    accepted : bool
        Whether the tie is user-approved.  An accepted tie outranks a proposal:
        the derivation drops the proposal, never the approval.
    layer_first_id : str
        Geotech band id at the first column — carried so a rejection log can
        name both endpoints rather than a count.
    layer_second_id : str
        Geotech band id at the second column.
    """

    depth_first_m: float
    depth_second_m: float
    accepted: bool
    layer_first_id: str
    layer_second_id: str


def gap_key(investigation_a: str, investigation_b: str) -> tuple[str, str]:
    """Name the gap two investigations bound, independent of which came first.

    A tie derived left-to-right and one derived right-to-left sit in the same
    gap and must land in the same registry bucket, so the key is sorted.

    Parameters
    ----------
    investigation_a : str
        One column's investigation id.
    investigation_b : str
        The other column's investigation id.

    Returns
    -------
    tuple[str, str]
        The two ids in ascending order.  A :class:`GapTie` built for this key
        stores its depths in that same order.
    """
    return (
        (investigation_a, investigation_b)
        if investigation_a <= investigation_b
        else (investigation_b, investigation_a)
    )


def ties_cross(first: GapTie, second: GapTie) -> bool:
    """Whether two ties in the same gap cross.

    Parameters
    ----------
    first : GapTie
        One tie, already reduced to this gap's column order.
    second : GapTie
        The other tie, in the same column order.

    Returns
    -------
    bool
        ``True`` when the endpoint order is inverted between the two columns —
        one tie is above the other at one column and below it at the other.
        ``False`` when the order holds, and ``False`` when the ties share an
        endpoint (within :data:`CROSSING_TOL_M`), which is a fan, not a cross.
    """
    at_first = first.depth_first_m - second.depth_first_m
    at_second = first.depth_second_m - second.depth_second_m
    if abs(at_first) <= CROSSING_TOL_M or abs(at_second) <= CROSSING_TOL_M:
        return False
    return at_first * at_second < 0.0


def crossing_partners(registered: Iterable[GapTie], candidate: GapTie) -> list[GapTie]:
    """Every already-registered tie in this gap that ``candidate`` would cross.

    Parameters
    ----------
    registered : Iterable[GapTie]
        The ties already standing in this gap — persisted approvals seeded from
        the database plus everything this derivation run has emitted so far, in
        registration order.
    candidate : GapTie
        The tie about to be emitted.

    Returns
    -------
    list[GapTie]
        The crossed ties, in registration order; empty when the candidate is
        free to land.  The caller decides what to do with them — the rule is
        that an accepted tie always outranks a proposal.
    """
    return [tie for tie in registered if ties_cross(tie, candidate)]
