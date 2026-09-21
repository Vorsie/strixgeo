"""Flanking-donor rule for borehole packing bands (owner ruling 2026-08-04).

A borehole has no cone resistance, so its NAD packing bands have to be borrowed
from CPTs.  *Which* CPTs is the geological question, and the owner answered it
during the borehole-packing-preview dogfeed:

    the borehole's packing must come from the CPT to the right and to the left
    on the cross section

— i.e. the two columns the engineer sees the borehole sitting between when he
draws the section, interpolated between them, and nothing else.

What this replaces
------------------
The previous rule interpolated an "ordinal transition surface" per body group:
the k-th band boundary of EVERY CPT in the group became one TIN, regardless of
which packing pair each of those boundaries actually separated.  On the real
model that blended up to ten different class pairs (inversions included) across
CPTs as far as 777 m away, and every borehole outside the resulting TIN
footprint silently degraded to the body-wide mean elevation.  A borehole 4.7 m
from a CPT was being told what its sand does by a CPT 777 m away.

The model here
--------------
* A **donor** is a CPT that (a) shares the borehole's body group and (b) reads
  packing inside its own litho extent for that group.  Nothing else qualifies —
  a CPT whose geotech bands sit in a different lithology has no standing.
* Donors are ranked **along the section line**, not by map distance: the flank
  is the nearest donor at a smaller along-position (left) and the nearest at a
  larger one (right).
* The two flanks are blended in **thickness-fraction space**.  Each donor's
  band boundary is expressed as a fraction of that donor's own litho extent,
  the two fractions are averaged with weights inverse to the along-distance,
  and the result is re-laid on the borehole's extent.  Fractions rather than
  depths because the unit thins and thickens between columns: a boundary 40 %
  down the sand at one CPT is 40 % down the sand at the borehole, whatever the
  sand's thickness there.

Two rules below were INTERPRETATIONS flagged for owner veto — RULED KEPT
2026-08-11 (audit F33). The owner's reasoning, verbatim: *"we correlate over the
boreholes from cpt to cpt, so the user's ties will define this. Normally the
closest cpt will be on section, section is the guideline."* That is the
authority ladder this module already sits under: an accepted tie straddling the
borehole (``tie_interpolated``) outranks everything here, so the flank rules
below are only the PRE-correlation ghost — the engineer's own correlations
supersede them the moment they exist — and the section stays the guideline for
that fallback. Kept as written:

1. **Mismatched sequences → the nearer flank alone.**  When the two flanks do
   not read the same ordered class list there is no honest pairing of their
   boundaries, so the nearer one is taken verbatim.  Grounded in the owner's
   earlier "nearest test that does have packing" ruling (render rule 6b).
2. **Several sections → a flanking PAIR first, then the tightest.**  A borehole
   drawn on two sections has two answers; a two-sided pair is preferred over
   any lone flank (interpolation over extrapolation), and among equals the
   section whose flanks hug the borehole closest wins.  Both halves decide real
   geology.  The pair-first half means a 69 m pair beats a coincident lone
   flank at 0 m (measured on the dev model: 14 groups where the winning pair's
   spread is >3x the best lone flank — practical impact small, the near half of
   every observed pair carries >=0.94 of the weight).  The tightest half means
   on 1411-GEO-23/126-B4's shallow sand, Tie-section 11 (lone left flank at
   78 m, reading only NAD 6) beats Cross-section 1 (lone right flank at 90 m,
   reading NAD 7 from +1.26) by 11.6 m — and that settles whether the borehole
   gets dense sand there.  The candidate alternative, if the owner disagrees,
   is to prefer the section that draws the most donors of the group.
3. **A section flank always beats a nearer off-section donor.**  The ladder
   only reaches the map-distance fallback when NO section places the borehole
   beside any donor.  Measured consequence on B4's 6.00-8.43 m extent: the
   lone right flank GEO-23/125-S6 at 623 m along Cross-section 1 is chosen
   while GEO-23/125-S21 — same body group, 225 m away on the map but on no
   section that draws B4 — is never consulted.  Follows the ruling as written
   ("the CPT to the right and to the left on the cross section"), flagged
   because it can pick a donor 2.8x farther than the nearest evidence.

Pure domain module: no I/O, no ORM, no logging.  The application layer gathers
the stacks and the along-positions; every decision lives here so it can be
tested without a database.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from groundmodel.shared.constants.db_constraints import MIN_LAYER_THICKNESS_M

# Bands thinner than this are dropped rather than written: `litho_layer` stores
# intervals at mm grain, so a sub-mm band is noise, not geology. Value +
# rationale: ``MIN_LAYER_THICKNESS_M``.
_MIN_BAND_THICKNESS_M = MIN_LAYER_THICKNESS_M

# Selection modes, in the order of decreasing evidence.
MODE_FLANK_INTERPOLATED = "flank_interpolated"
MODE_SINGLE_DONOR = "single_donor"
MODE_NEAREST_FALLBACK = "nearest_fallback"

# Below this share of the blend a flank is dropped from the pair and the mode
# degrades to ``single_donor`` — a 0.3 % co-author is provenance noise, not a
# consensus (F10). Half a percent keeps every genuine blend intact: the
# smallest real weight observed on the dev model outside the degenerate cases
# was ~0.06.
_MIN_BLEND_WEIGHT = 0.005
MODE_NONE = "none"


@dataclass(frozen=True)
class PackingSurface:
    """One packing interval laid onto a borehole, and where it came from.

    Parameters
    ----------
    top : float
        Interval top, metres below the borehole's collar.
    base : float
        Interval base, metres below the borehole's collar.
    nad_class : int
        NAD packing class 1-31.
    donor_layer_ids : tuple[str, ...]
        The ``litho_layer`` id of the donor band on each flank this interval
        was laid from - two for a blended pair (left, right), one for a lone
        donor, empty when the donors carry no ids.  This is the correspondence
        the fraction rescale already establishes; naming it here is what lets
        "Divide boreholes" write the borehole hop instead of guessing the
        pairing back from depths.
    """

    top: float
    base: float
    nad_class: int
    donor_layer_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class DonorBand:
    """One packing band a donor CPT reads inside its own litho extent.

    Parameters
    ----------
    top_m : float
        Band top, metres below the donor's collar.
    base_m : float
        Band base, metres below the donor's collar.
    nad_class : int
        NAD packing class 1–31.
    layer_id : str
        The band's ``litho_layer`` id, stringified — the identity an accepted
        packing tie names.  Appended with a default so every existing
        construction site keeps working; the tie-informed donor rule
        (:mod:`groundmodel.domain.services.geotech_tie_donors`) is the only
        reader, and an empty id simply never matches a tie.
    """

    top_m: float
    base_m: float
    nad_class: int
    layer_id: str = ""


@dataclass(frozen=True)
class DonorStack:
    """A candidate donor CPT: its litho extent plus the packing it read there.

    Parameters
    ----------
    investigation_id : str
        The CPT's id, stringified.
    name : str
        Display name — the tooltip names the donor, so the engineer can go and
        look at the CPT the machine listened to.
    extent_top_m : float
        Top of the CPT's own litho-body extent for this group (m below collar).
    extent_base_m : float
        Base of that extent (m below collar).
    bands : tuple[DonorBand, ...]
        The CPT's packing bands inside the extent, top to bottom.  May leave
        gaps — an unclassified stretch on the donor stays unclassified here.
    map_distance_m : float
        Straight-line distance from the borehole, used only by the
        nearest-donor fallback and reported for provenance.
    """

    investigation_id: str
    name: str
    extent_top_m: float
    extent_base_m: float
    bands: tuple[DonorBand, ...]
    map_distance_m: float

    def class_sequence(self) -> tuple[int, ...]:
        """Return the ordered NAD classes this donor reads, top to bottom.

        Returns
        -------
        tuple[int, ...]
            The class list two flanks must agree on before their boundaries can
            be paired.
        """
        return tuple(band.nad_class for band in self.bands)


@dataclass(frozen=True)
class SectionPlacement:
    """One cross-section and the along-positions of the columns drawn on it.

    Parameters
    ----------
    section_id : str
        The section's id, stringified.
    section_name : str
        Display name, reported as the section the donors were read from.
    along_m : dict[str, float]
        ``investigation id -> along-distance from the section's start point``,
        for every investigation the section actually draws (in corridor and
        between the endpoints).  An investigation absent from this map is not
        on the section and cannot flank anything on it.
    """

    section_id: str
    section_name: str
    along_m: dict[str, float]


@dataclass(frozen=True)
class SelectedDonor:
    """A donor that was chosen, with the side it sits on and its say.

    Parameters
    ----------
    stack : DonorStack
        The donor.
    side : str
        ``left`` / ``right`` for a flank; ``nearest`` for the map-distance
        fallback (no section was involved, so neither side is meaningful).
    along_distance_m : float | None
        Along-section distance to the borehole.  ``None`` in the fallback,
        where there is no section to measure along.
    weight : float
        Share of the interpolation, 0–1.  A lone donor carries 1.0; two flanks
        split it inversely to their along-distances, so the nearer one weighs
        more.
    """

    stack: DonorStack
    side: str
    along_distance_m: float | None
    weight: float


@dataclass(frozen=True)
class FlankSelection:
    """Which donors a borehole listens to, and where that was decided.

    Parameters
    ----------
    mode : str
        ``flank_interpolated`` (both flanks agreed on the sequence),
        ``single_donor`` (one flank, or the nearer of two that disagreed),
        ``nearest_fallback`` (no section places this borehole beside a donor),
        or ``none`` (no donor exists at all — the conservative fill takes the
        whole extent).
    donors : tuple[SelectedDonor, ...]
        The chosen donors: two for ``flank_interpolated`` (left first), one for
        ``single_donor`` / ``nearest_fallback``, none for ``none``.
    section_id : str | None
        Section the flanks were read from; ``None`` outside the flank modes.
    section_name : str | None
        That section's display name.
    """

    mode: str
    donors: tuple[SelectedDonor, ...]
    section_id: str | None
    section_name: str | None


@dataclass(frozen=True)
class _SectionFlanks:
    """The nearest donor on each side of one borehole, on one section.

    Private to this module: it is the ranking unit for the several-sections
    tie-break, not part of the rule's vocabulary.

    Parameters
    ----------
    section : SectionPlacement
        The section these flanks were read from.
    left : DonorStack | None
        Nearest donor at an along-position ≤ the borehole's.
    left_distance_m : float
        Its along-distance to the borehole; ``0.0`` when there is no left flank.
    right : DonorStack | None
        Nearest donor at a larger along-position.
    right_distance_m : float
        Its along-distance to the borehole; ``0.0`` when there is no right flank.
    """

    section: SectionPlacement
    left: DonorStack | None
    left_distance_m: float
    right: DonorStack | None
    right_distance_m: float

    def sort_key(self) -> tuple[int, float, str]:
        """Rank this section: a flanking pair first, then the tightest one.

        Returns
        -------
        tuple[int, float, str]
            ``(0 for a pair else 1, total along-distance, section id)`` — the
            section id last so two equally tight sections always resolve the
            same way rather than on dict order.
        """
        has_pair = self.left is not None and self.right is not None
        spread = (self.left_distance_m if self.left is not None else 0.0) + (
            self.right_distance_m if self.right is not None else 0.0
        )
        return (0 if has_pair else 1, spread, self.section.section_id)


def _flanks_on_section(
    section: SectionPlacement,
    borehole_id: str,
    donors_by_id: dict[str, DonorStack],
) -> _SectionFlanks | None:
    """Find the nearest donor either side of *borehole_id* on one section.

    Parameters
    ----------
    section : SectionPlacement
        The section to look along.
    borehole_id : str
        The borehole's id, stringified.
    donors_by_id : dict[str, DonorStack]
        Eligible donors keyed by investigation id.

    Returns
    -------
    _SectionFlanks | None
        The flanks found, or ``None`` when the section does not draw this
        borehole or draws no eligible donor at all.

    Notes
    -----
    A donor at exactly the borehole's along-position is taken as the LEFT flank
    at zero distance: it then carries the whole weight, which is the right
    answer for a column drawn on top of the borehole.
    """
    bh_along = section.along_m.get(borehole_id)
    if bh_along is None:
        return None
    left: DonorStack | None = None
    left_distance = 0.0
    right: DonorStack | None = None
    right_distance = 0.0
    # Sorted so the scan is deterministic when two donors share an along-position.
    for inv_id, along in sorted(section.along_m.items()):
        donor = donors_by_id.get(inv_id)
        if donor is None:
            continue
        if along <= bh_along:
            distance = bh_along - along
            if left is None or distance < left_distance:
                left, left_distance = donor, distance
        else:
            distance = along - bh_along
            if right is None or distance < right_distance:
                right, right_distance = donor, distance
    if left is None and right is None:
        return None
    return _SectionFlanks(
        section=section,
        left=left,
        left_distance_m=left_distance,
        right=right,
        right_distance_m=right_distance,
    )


def select_flank_donors(
    *,
    borehole_id: str,
    donors: Sequence[DonorStack],
    sections: Sequence[SectionPlacement],
    preferred_section_id: str | None = None,
) -> FlankSelection:
    """Choose the CPT(s) a borehole's packing is read from.

    Applies the owner's ruling: among the sections that draw this borehole,
    take the nearest donor to its left and the nearest to its right along the
    section line.  Falls back down the ladder when that is not available —
    one flank, then the nearest donor by map distance, then nothing.

    Parameters
    ----------
    borehole_id : str
        The borehole's id, stringified — the key used in every
        ``SectionPlacement.along_m``.
    donors : Sequence[DonorStack]
        Every eligible donor for this borehole's body group (same group, reads
        packing in its own litho extent).  Order is irrelevant; ties break on
        ``investigation_id`` so the result does not depend on it.
    sections : Sequence[SectionPlacement]
        Every project section, with the along-positions of the columns it
        draws.  Sections that do not draw this borehole are skipped.
    preferred_section_id : str | None
        The section the engineer is editing (a scoped divide's own section).
        Owner ruling 2026-08-18 — *"the section you are editing wins"*: when
        this section places the borehole beside any donor, its flanks decide,
        even where another section holds a tighter pair, because the engineer
        judges the result on the section he is looking at.  ``None`` (the
        unscoped all-sections press) keeps the tightest-pair ranking.

    Returns
    -------
    FlankSelection
        The chosen donors, their weights, and the section that decided.

    Notes
    -----
    A donor sitting exactly at the borehole's along-position counts as the left
    flank at zero distance — it then carries the entire weight, which is the
    right answer for a coincident column.
    """
    if not donors:
        return FlankSelection(mode=MODE_NONE, donors=(), section_id=None, section_name=None)

    by_id = {donor.investigation_id: donor for donor in donors}

    # Rank every section that draws this borehole: pairs beat lone flanks, and
    # among pairs the tightest one wins (INTERPRETATION — see module docstring).
    candidates = [
        flanks
        for flanks in (_flanks_on_section(section, borehole_id, by_id) for section in sections)
        if flanks is not None
    ]
    if candidates:
        # The editing section outranks every other; within it (and among the
        # rest) the normal key applies, so a pair still beats a lone flank.
        best = min(
            candidates,
            key=lambda f: (
                0 if f.section.section_id == preferred_section_id else 1,
                *f.sort_key(),
            ),
        )
        if best.left is not None and best.right is not None:
            return _pair_selection(
                best.section, best.left, best.left_distance_m, best.right, best.right_distance_m
            )
        lone, side, distance = (
            (best.left, "left", best.left_distance_m)
            if best.left is not None
            else (best.right, "right", best.right_distance_m)
        )
        if lone is not None:
            return FlankSelection(
                mode=MODE_SINGLE_DONOR,
                donors=(
                    SelectedDonor(stack=lone, side=side, along_distance_m=distance, weight=1.0),
                ),
                section_id=best.section.section_id,
                section_name=best.section.section_name,
            )

    # No section places this borehole beside a donor — nearest test by map
    # distance, which is the answer the previous proposal already carried.
    nearest = min(donors, key=lambda d: (d.map_distance_m, d.investigation_id))
    return FlankSelection(
        mode=MODE_NEAREST_FALLBACK,
        donors=(SelectedDonor(stack=nearest, side="nearest", along_distance_m=None, weight=1.0),),
        section_id=None,
        section_name=None,
    )


def _pair_selection(
    section: SectionPlacement,
    left: DonorStack,
    left_distance: float,
    right: DonorStack,
    right_distance: float,
) -> FlankSelection:
    """Build the selection for a borehole with a donor on each side.

    Pairs the two stacks when they read the same ordered class list; otherwise
    hands the whole weight to the nearer one (INTERPRETATION — see the module
    docstring).

    Parameters
    ----------
    section : SectionPlacement
        The section the two flanks were read from.
    left : DonorStack
        Nearest donor at a smaller along-position.
    left_distance : float
        Its along-distance to the borehole (m).
    right : DonorStack
        Nearest donor at a larger along-position.
    right_distance : float
        Its along-distance to the borehole (m).

    Returns
    -------
    FlankSelection
        ``flank_interpolated`` with both donors, or ``single_donor`` with the
        nearer one.
    """
    if left.class_sequence() != right.class_sequence():
        nearer, side, distance = (
            (left, "left", left_distance)
            if (left_distance, left.investigation_id) <= (right_distance, right.investigation_id)
            else (right, "right", right_distance)
        )
        return FlankSelection(
            mode=MODE_SINGLE_DONOR,
            donors=(SelectedDonor(stack=nearer, side=side, along_distance_m=distance, weight=1.0),),
            section_id=section.section_id,
            section_name=section.section_name,
        )

    total = left_distance + right_distance
    # Coincident columns (both at the borehole's along-position) carry equal say
    # rather than dividing by zero.
    left_weight = 0.5 if total <= 0.0 else right_distance / total
    # A flank whose say rounds to nothing must not appear as a co-author: below
    # half a percent, provenance saying "interpolated between A and B" would
    # claim a two-CPT consensus that numerically does not exist. The near flank
    # speaks alone and the mode says so (F10).
    if left_weight < _MIN_BLEND_WEIGHT or left_weight > 1.0 - _MIN_BLEND_WEIGHT:
        nearer, side, distance = (
            (left, "left", left_distance)
            if left_weight >= 0.5
            else (right, "right", right_distance)
        )
        return FlankSelection(
            mode=MODE_SINGLE_DONOR,
            donors=(SelectedDonor(stack=nearer, side=side, along_distance_m=distance, weight=1.0),),
            section_id=section.section_id,
            section_name=section.section_name,
        )
    return FlankSelection(
        mode=MODE_FLANK_INTERPOLATED,
        donors=(
            SelectedDonor(
                stack=left, side="left", along_distance_m=left_distance, weight=left_weight
            ),
            SelectedDonor(
                stack=right,
                side="right",
                along_distance_m=right_distance,
                weight=1.0 - left_weight,
            ),
        ),
        section_id=section.section_id,
        section_name=section.section_name,
    )


def flank_packing_surfaces(
    selection: FlankSelection,
    *,
    extent_top_m: float,
    extent_base_m: float,
) -> list[tuple[float, float, int]]:
    """Lay the selected donors' packing onto the borehole's litho extent.

    Thin projection of :func:`flank_packing_surfaces_with_donors` — the two
    cannot drift, so every geometry test written against this tuple form keeps
    guarding the richer one.

    Every donor boundary is read as a fraction of that donor's own extent and
    re-laid at the same fraction of the borehole's extent, so a boundary 40 %
    down the unit stays 40 % down the unit however much the unit thickens.  Two
    flanks are averaged fraction-by-fraction with their selection weights.

    Parameters
    ----------
    selection : FlankSelection
        Output of :func:`select_flank_donors`.
    extent_top_m : float
        Top of the borehole's litho-body extent (m below collar).
    extent_base_m : float
        Base of that extent (m below collar).

    Returns
    -------
    list[tuple[float, float, int]]
        ``(top_m, base_m, nad_class)`` intervals in the borehole's own depth
        frame, ordered top to bottom, non-overlapping.  Gaps are preserved:
        depth the donors left unclassified is left for the conservative fill.
        Empty when there is no donor or the extent is degenerate.
    """
    return [
        (s.top, s.base, s.nad_class)
        for s in flank_packing_surfaces_with_donors(
            selection, extent_top_m=extent_top_m, extent_base_m=extent_base_m
        )
    ]


def flank_packing_surfaces_with_donors(
    selection: FlankSelection,
    *,
    extent_top_m: float,
    extent_base_m: float,
) -> list[PackingSurface]:
    """Lay the selected donors' packing onto the borehole's litho extent.

    Every donor boundary is read as a fraction of that donor's own extent and
    re-laid at the same fraction of the borehole's extent, so a boundary 40 %
    down the unit stays 40 % down the unit however much the unit thickens.  Two
    flanks are averaged fraction-by-fraction with their selection weights.

    Each surface also NAMES the donor band(s) it stands between.  That pairing
    is not new information — the two-flank branch already zips band *i* with
    band *i*, which IS the correspondence — it is simply the part that used to
    be discarded.  Without it "Divide boreholes" had to reconstruct the pairing
    downstream with a per-gap depth alignment, and the gap left of a borehole
    and the gap right of it reconstructed it differently, so the two hops
    landed on different borehole bands and no chain closed (owner dogfeed
    2026-08-15: pressing 4 twice replaced nothing).

    Parameters
    ----------
    selection : FlankSelection
        Output of :func:`select_flank_donors`.
    extent_top_m : float
        Top of the borehole's litho-body extent (m below collar).
    extent_base_m : float
        Base of that extent (m below collar).

    Returns
    -------
    list[PackingSurface]
        Intervals in the borehole's own depth frame, ordered top to bottom,
        non-overlapping, each naming its donor band(s).  Gaps are preserved:
        depth the donors left unclassified is left for the conservative fill.
        Empty when there is no donor or the extent is degenerate.
    """
    thickness = extent_base_m - extent_top_m
    if not selection.donors or thickness <= 0.0:
        return []

    fractions: list[tuple[float, float, int, tuple[str, ...]]]
    if len(selection.donors) == 1:
        fractions = [
            (
                _fraction(selection.donors[0].stack, band.top_m),
                _fraction(selection.donors[0].stack, band.base_m),
                band.nad_class,
                (band.layer_id,),
            )
            for band in selection.donors[0].stack.bands
        ]
    else:
        left, right = selection.donors[0], selection.donors[1]
        # The pair was only kept because the class sequences match, so zip pairs
        # band i with band i — the same packing unit on both flanks.
        fractions = [
            (
                left.weight * _fraction(left.stack, left_band.top_m)
                + right.weight * _fraction(right.stack, right_band.top_m),
                left.weight * _fraction(left.stack, left_band.base_m)
                + right.weight * _fraction(right.stack, right_band.base_m),
                left_band.nad_class,
                (left_band.layer_id, right_band.layer_id),
            )
            for left_band, right_band in zip(left.stack.bands, right.stack.bands)
        ]

    surfaces: list[PackingSurface] = []
    cursor = extent_top_m
    for top_fraction, base_fraction, nad_class, donor_layer_ids in fractions:
        top = max(cursor, extent_top_m + top_fraction * thickness)
        base = min(extent_base_m, extent_top_m + base_fraction * thickness)
        # A sub-mm step back from the previous band is float slack from the
        # fraction round trip, not an uncovered stretch: close it, or the
        # conservative fill writes a band that renders as a zero-thickness line
        # and reads as a packing change that never happened.
        if top - cursor < _MIN_BAND_THICKNESS_M:
            top = cursor
        if base - top < _MIN_BAND_THICKNESS_M:
            continue
        surfaces.append(
            PackingSurface(
                top=top,
                base=base,
                nad_class=nad_class,
                # An empty id is a donor built without one (every construction
                # site that predates the tie-informed rule); it simply never
                # licenses a hop.
                donor_layer_ids=tuple(lid for lid in donor_layer_ids if lid),
            )
        )
        cursor = base
    # Same slack at the bottom edge.
    if surfaces and 0.0 < extent_base_m - cursor < _MIN_BAND_THICKNESS_M:
        last = surfaces[-1]
        surfaces[-1] = replace(last, base=extent_base_m)
    return surfaces


def _fraction(stack: DonorStack, depth_m: float) -> float:
    """Express a depth on a donor as a fraction of that donor's litho extent.

    Parameters
    ----------
    stack : DonorStack
        The donor whose extent defines the fraction.
    depth_m : float
        A depth on that donor (m below its collar).

    Returns
    -------
    float
        ``0.0`` at the extent top, ``1.0`` at its base, clamped to that range.
        A degenerate (zero-thickness) extent returns ``0.0`` — there is no
        proportion to read.
    """
    thickness = stack.extent_base_m - stack.extent_top_m
    if thickness <= 0.0:
        return 0.0
    return min(1.0, max(0.0, (depth_m - stack.extent_top_m) / thickness))


# Confidence rungs for a donor-derived band, in metres to the NEAREST donor CPT
# (owner ruling 2026-08-11, audit F08: "map the confidence honestly, just take
# distance to nearest cpt as a measure for now"). The 50 m rung is the scale of
# the section projection buffer (default 60 m) — the corridor the owner himself
# uses to say a test "is here"; 200 m is beyond the typical CPT spacing on the
# dev model's sections (~50 m), i.e. several tests' worth of extrapolation.
# "For now" per the ruling — tune on dogfeed, in one place.
DONOR_CONFIDENCE_HIGH_M = 50.0
DONOR_CONFIDENCE_MEDIUM_M = 200.0


def confidence_from_donor_distance(distance_m: float | None) -> str:
    """Confidence of a borrowed band, from how far its nearest donor sits.

    Parameters
    ----------
    distance_m : float | None
        Metres to the nearest donor CPT — along-section where the donor came
        from a section flank, map distance for the fallback. ``None`` means no
        donor at all (the conservative body_min / absolute_min fills), which
        must never read better than the farthest real donor.

    Returns
    -------
    str
        ``"high"`` (≤ 50 m), ``"medium"`` (≤ 200 m) or ``"low"``.
    """
    if distance_m is None:
        return "low"
    if distance_m <= DONOR_CONFIDENCE_HIGH_M:
        return "high"
    if distance_m <= DONOR_CONFIDENCE_MEDIUM_M:
        return "medium"
    return "low"


def depth_aware_flanks(
    borehole_id: str,
    *,
    ordered_columns: Sequence[str],
    kind_of: Mapping[str, str],
    banded_extent_by_inv: Mapping[str, tuple[float, float]],
    window_top_elev_m: float,
    window_base_elev_m: float,
    min_data_m: float,
) -> set[str]:
    """The flanking CPTs for ONE layer window, walking past silent columns.

    Owner ruling, 2026-08-18, after B2's 8.7 m sand came back as one band:
    *"If there are no cpt data below TD, then you look to the next cpt over
    ofcourse. Close cpt where there is data, further away below TD."*  The
    flank is therefore judged per LAYER, not per borehole: a short CPT whose
    bands end above this layer's window is silent here and the walk continues
    to the next CPT over.  A CPT whose bands DO cover the window blocks the
    walk even when none of them are this layer's soil — data that disagrees
    is still data, and borrowing from beyond it would fake continuity through
    ground it says is something else.  Boreholes are always stepped over: no
    qc, nothing to donate.

    Parameters
    ----------
    borehole_id : str
        The borehole whose flanks are asked for.
    ordered_columns : Sequence[str]
        One section's investigation ids, in along order.
    kind_of : Mapping[str, str]
        ``"cpt"`` or ``"borehole"`` per investigation id.
    banded_extent_by_inv : Mapping[str, tuple[float, float]]
        Per investigation, the (top, base) ELEVATION extent of its geotech
        bands, top above base.  Missing = no bands at all.
    window_top_elev_m, window_base_elev_m : float
        The borehole layer's elevation window, top above base.
    min_data_m : float
        The model's minimum writable band thickness.  A column whose data
        covers less of the window than one writable band cannot express
        anything here and counts as silent — on the real B2, the next CPT's
        clay grazed the sand window by 2 cm, and 2 cm of clay must not veto
        an 8.7 m question.

    Returns
    -------
    set[str]
        At most one CPT per side on this section.  Empty when the borehole is
        not on the section, or no CPT with data in the window exists a side.
    """
    try:
        position = ordered_columns.index(borehole_id)
    except ValueError:
        return set()

    def _has_data(inv: str) -> bool:
        extent = banded_extent_by_inv.get(inv)
        if extent is None:
            return False
        top, base = extent
        return min(top, window_top_elev_m) - max(base, window_base_elev_m) > min_data_m

    flanks: set[str] = set()
    for step in (-1, 1):
        probe = position + step
        while 0 <= probe < len(ordered_columns):
            candidate = ordered_columns[probe]
            if kind_of.get(candidate) == "cpt" and _has_data(candidate):
                flanks.add(candidate)
                break
            probe += step
    return flanks
