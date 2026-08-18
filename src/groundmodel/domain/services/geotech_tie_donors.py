"""Tie-informed donor rule for borehole packing bands (owner ruling 2026-08-04).

The flanking rule (:mod:`groundmodel.domain.services.borehole_flank_donors`)
answers *which CPTs* a borehole borrows its packing from by looking at who sits
beside it on a section.  That is a guess — a good one, but a guess.  Once the
engineer has ACCEPTED a packing tie whose span crosses the borehole's column, it
is no longer a guess: he has said, in the model, that this band over here is
that band over there, and the borehole lies between them.

    when an accepted tie's span crosses the borehole's column on a section and
    both tie endpoints are CPTs in the borehole's body group, THAT tied pair
    becomes the donor pair

    — owner, 2026-08-04

The flanking rule stays as the FALLBACK wherever no accepted tie spans the
borehole; this module returns ``None`` in that case and the caller falls
through unchanged.

What the tie adds beyond the donor identity
-------------------------------------------
It also supplies the band CORRESPONDENCE.  The flanking rule can only pair two
donors when their whole ordered class lists agree, because nothing else tells it
which band matches which.  A tie names both endpoints, so the MEMBERSHIP is
given: the two donors are reduced to exactly the bands the engineer tied, and
those kept bands are then paired IN DEPTH ORDER — not by the individual tie
arrows.  Crossed ties over an equal class sequence therefore pair by depth,
not by what was clicked (review finding 6; pathological input, accepted).
Everything else on either column is left out — depth no tie covers
stays for the conservative fill rather than being invented.

Staying inside the litho body — the fraction rule
--------------------------------------------------
    check if the ties stay in the litho body otherwise rescale based on the
    litho thickness at that location

    — owner, same evening

A tied surface is read as a FRACTION of each donor's own litho extent and
re-laid at that fraction of the borehole's extent, which is what
:func:`~groundmodel.domain.services.borehole_flank_donors.flank_packing_surfaces`
already does for the flanking rule — so the selection this module returns is
deliberately the same :class:`FlankSelection` shape and goes through the same
laying-out function.  Where the litho body thins at the borehole, the surface
rescales with it instead of keeping the donors' absolute depth and walking out
of the envelope.

Pure domain module: no I/O, no ORM, no logging.  The application layer gathers
the donor stacks, the along-positions and the accepted ties; every decision
lives here so it can be tested without a database.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from groundmodel.domain.services.borehole_flank_donors import (
    MODE_SINGLE_DONOR,
    DonorStack,
    FlankSelection,
    SectionPlacement,
    SelectedDonor,
)

# A donor whose share of the blend rounds to nothing is not a co-author: below
# this the near donor speaks alone, exactly as the flanking rule decided (F10).
_MIN_BLEND_WEIGHT = 0.005

#: Selection mode stamped when an accepted tie chose the donor pair.  Sits
#: ABOVE ``flank_interpolated`` in the evidence ladder: the engineer drew and
#: accepted this correlation, the flanks are only adjacency.
MODE_TIE_INTERPOLATED = "tie_interpolated"


@dataclass(frozen=True)
class AcceptedTie:
    """One accepted packing correlation, as this rule needs to read it.

    Parameters
    ----------
    investigation_a : str
        Investigation id of the first endpoint, stringified.
    layer_a_id : str
        The ``litho_layer`` id of the tied band on that investigation.
    investigation_b : str
        Investigation id of the second endpoint.
    layer_b_id : str
        The tied band's layer id on that investigation.
    section_id : str
        Section the tie was drawn on, stringified.  Geotech correlation edges
        are section-scoped, and "crosses the borehole's column" is only
        meaningful along the section the tie belongs to.
    """

    investigation_a: str
    layer_a_id: str
    investigation_b: str
    layer_b_id: str
    section_id: str
    # Which surface of each band the tie names — 'top' (the default every row
    # before the bottom-tie spec carried) or 'base'. Audit P1-2: dropping the
    # side turned a base↔base tie into a top↔top one at placement time.
    side_a: str = "top"
    side_b: str = "top"


@dataclass(frozen=True)
class _TieCandidate:
    """One donor pair a set of accepted ties nominates on one section.

    Private to this module: the ranking unit, not part of the rule's vocabulary.

    Parameters
    ----------
    section : SectionPlacement
        The section the ties were read along.
    left : DonorStack
        The donor at the smaller along-position, reduced to its tied bands.
    left_distance_m : float
        Its along-distance to the borehole (m).
    right : DonorStack
        The donor at the larger along-position, reduced to its tied bands.
    right_distance_m : float
        Its along-distance to the borehole (m).
    """

    section: SectionPlacement
    left: DonorStack
    left_distance_m: float
    right: DonorStack
    right_distance_m: float

    def sort_key(self) -> tuple[float, str, str]:
        """Rank this candidate: the tightest spanning pair, then by id.

        Returns
        -------
        tuple[float, str, str]
            ``(total along-distance, section id, left donor id)`` — the ids
            last so two equally tight candidates always resolve the same way
            rather than on dict order.
        """
        return (
            self.left_distance_m + self.right_distance_m,
            self.section.section_id,
            self.left.investigation_id,
        )


def select_tie_informed_donors(
    *,
    borehole_id: str,
    donors: Sequence[DonorStack],
    sections: Sequence[SectionPlacement],
    ties: Sequence[AcceptedTie],
) -> FlankSelection | None:
    """Choose the donor pair an accepted tie names, when one spans the borehole.

    Parameters
    ----------
    borehole_id : str
        The borehole's id, stringified — the key used in every
        ``SectionPlacement.along_m``.
    donors : Sequence[DonorStack]
        Every eligible donor for this borehole's body group (same group, reads
        packing in its own litho extent).  Both tie endpoints must be in here:
        that is what "CPTs in the borehole's body group" means.
    sections : Sequence[SectionPlacement]
        Every project section with the along-positions of the columns it draws.
    ties : Sequence[AcceptedTie]
        The engineer's ACCEPTED packing ties.  Proposals must never reach this
        function — an unaccepted tie is the machine's guess, and a guess has no
        more standing than the flanking rule's own.

    Returns
    -------
    FlankSelection | None
        A ``tie_interpolated`` (or, for a vanishing blend share,
        ``single_donor``) selection whose donors carry ONLY the tied bands;
        ``None`` when no accepted tie spans this borehole between two eligible
        CPT donors, in which case the caller falls back to the flanking rule.

    Notes
    -----
    "Spans" is strict: both endpoints must sit on opposite sides of the
    borehole's along-position.  A tie between two columns on the same side, or
    one that starts at the borehole itself, tells nothing about what the
    borehole reads in between.
    """
    if not donors or not ties:
        return None

    by_id = {donor.investigation_id: donor for donor in donors}

    candidates: list[_TieCandidate] = []
    for section in sections:
        bh_along = section.along_m.get(borehole_id)
        if bh_along is None:
            continue
        # Group this section's spanning ties by the (left, right) donor pair, so
        # a pair tied at several depths yields ONE candidate carrying all of its
        # tied bands.
        tied_layers: dict[tuple[str, str], tuple[set[str], set[str]]] = {}
        distances: dict[tuple[str, str], tuple[float, float]] = {}
        for tie in ties:
            if tie.section_id != section.section_id:
                continue
            a, b = tie.investigation_a, tie.investigation_b
            if a not in by_id or b not in by_id:
                # A borehole endpoint, or a CPT outside this body group: not the
                # CPT pair the ruling names.
                continue
            a_along = section.along_m.get(a)
            b_along = section.along_m.get(b)
            if a_along is None or b_along is None:
                continue
            if not (min(a_along, b_along) < bh_along < max(a_along, b_along)):
                continue
            if a_along < b_along:
                left_id, right_id = a, b
                left_layer, right_layer = tie.layer_a_id, tie.layer_b_id
                left_distance, right_distance = bh_along - a_along, b_along - bh_along
            else:
                left_id, right_id = b, a
                left_layer, right_layer = tie.layer_b_id, tie.layer_a_id
                left_distance, right_distance = bh_along - b_along, a_along - bh_along
            key = (left_id, right_id)
            left_set, right_set = tied_layers.setdefault(key, (set(), set()))
            left_set.add(left_layer)
            right_set.add(right_layer)
            distances[key] = (left_distance, right_distance)

        for (left_id, right_id), (left_layers, right_layers) in tied_layers.items():
            left_reduced = _reduced(by_id[left_id], left_layers)
            right_reduced = _reduced(by_id[right_id], right_layers)
            if left_reduced is None or right_reduced is None:
                continue
            # A tie the engineer drew across two different packing classes is a
            # surface tie, not a band correspondence: there is no honest way to
            # lay "NAD 7 over there" onto "NAD 13 over here".  Leave it to the
            # flanking fallback rather than invent a class for the borehole.
            if left_reduced.class_sequence() != right_reduced.class_sequence():
                continue
            left_distance, right_distance = distances[(left_id, right_id)]
            candidates.append(
                _TieCandidate(
                    section=section,
                    left=left_reduced,
                    left_distance_m=left_distance,
                    right=right_reduced,
                    right_distance_m=right_distance,
                )
            )

    if not candidates:
        return None

    best = min(candidates, key=lambda c: c.sort_key())
    return _tie_selection(best)


def _reduced(stack: DonorStack, tied_layer_ids: set[str]) -> DonorStack | None:
    """Reduce a donor to the bands an accepted tie actually names.

    Parameters
    ----------
    stack : DonorStack
        The full donor stack.
    tied_layer_ids : set[str]
        Layer ids of that donor's bands that carry a tie.

    Returns
    -------
    DonorStack | None
        The same donor with ``bands`` restricted to the tied ones, top to
        bottom; ``None`` when none of its bands is named (a tie pointing at a
        band that is not in this body group's extent).

    Notes
    -----
    The litho extent is left untouched on purpose: the fraction the tied surface
    is read at is a fraction of the LITHO body, not of the tied bands.
    """
    kept = tuple(
        sorted(
            (band for band in stack.bands if band.layer_id in tied_layer_ids),
            key=lambda band: band.top_m,
        )
    )
    if not kept:
        return None
    return replace(stack, bands=kept)


def _tie_selection(candidate: _TieCandidate) -> FlankSelection:
    """Build the selection for a tied donor pair, weighted by along-distance.

    Parameters
    ----------
    candidate : _TieCandidate
        The winning spanning pair, already reduced to its tied bands.

    Returns
    -------
    FlankSelection
        ``tie_interpolated`` with both donors, or ``single_donor`` with the
        near one when the far one's share of the blend rounds to nothing.
    """
    total = candidate.left_distance_m + candidate.right_distance_m
    left_weight = 0.5 if total <= 0.0 else candidate.right_distance_m / total
    if left_weight < _MIN_BLEND_WEIGHT or left_weight > 1.0 - _MIN_BLEND_WEIGHT:
        nearer, side, distance = (
            (candidate.left, "left", candidate.left_distance_m)
            if left_weight >= 0.5
            else (candidate.right, "right", candidate.right_distance_m)
        )
        return FlankSelection(
            mode=MODE_SINGLE_DONOR,
            donors=(SelectedDonor(stack=nearer, side=side, along_distance_m=distance, weight=1.0),),
            section_id=candidate.section.section_id,
            section_name=candidate.section.section_name,
        )
    return FlankSelection(
        mode=MODE_TIE_INTERPOLATED,
        donors=(
            SelectedDonor(
                stack=candidate.left,
                side="left",
                along_distance_m=candidate.left_distance_m,
                weight=left_weight,
            ),
            SelectedDonor(
                stack=candidate.right,
                side="right",
                along_distance_m=candidate.right_distance_m,
                weight=1.0 - left_weight,
            ),
        ),
        section_id=candidate.section.section_id,
        section_name=candidate.section.section_name,
    )
