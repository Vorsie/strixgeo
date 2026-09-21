"""Pure band-planning functions for geotech borehole division.

The band-math half of :mod:`groundmodel.application.divide_boreholes` — every
function here is PURE: it takes plain values / domain value objects and returns
new ones, touching no session, ORM row, ``self`` or I/O.  It was extracted
verbatim from ``divide_boreholes.py`` (KonMari DB-S1) to shrink the repo's
largest module; ``DivideBoreholes`` and every existing importer keep working
because ``divide_boreholes.py`` re-exports these names.

The functions cover the whole band-planning cascade the owner's dogfeed rulings
name: reading a CPT's in-extent packing bands, laying bands between two flanks
from placed boundaries, clamping a borehole unit's overhang to the flank floor,
choosing donor columns (by tie and by body, gated to the receiver's own litho
unit), raising an unanswered band to its column's measured floor, merging
geo-split bands, coarsening to the minimum thickness, clipping to a geological
slice, and detecting the ties that merely restate a shared litho contact.

Layer
-----
``application`` → ``domain`` only: the value objects it constructs
(``FillBand``, ``ColumnBoundary``) come from ``domain.services``.  The two
result/segment value objects it *annotates* (``PlannedBand``,
``PlannedBoreholeSegment``) still live in ``divide_boreholes.py`` (KonMari DB-S2
has not run); they are referenced only in annotations, so under
``from __future__ import annotations`` the reference is a lazy string and there
is no runtime import cycle — a ``TYPE_CHECKING`` import gives the static checkers
the resolution.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import TYPE_CHECKING, Any
from uuid import UUID

from groundmodel.application.band_planning_constants import (
    _DEPTH_TOL_M,
    _UNRESOLVED_SOURCES,
    _WEAKEST_FIRST,
    COLUMN_MIN_SOURCE,
    GROWABLE_FRACTION_OF_MINIMUM,
)
from groundmodel.domain.services.borehole_packing_fill import FillBand
from groundmodel.domain.services.geotech_tie_donors import AcceptedTie
from groundmodel.domain.services.geotech_unit_boundaries import ColumnBoundary, PlacedBoundary
from groundmodel.domain.services.litho_body_pick import BodyLayerPick

if TYPE_CHECKING:
    from groundmodel.application.divide_boreholes import (
        PlannedBand,
        PlannedBoreholeSegment,
    )


def _bands_in_extent(
    geotech_layer_by_inv_depth: dict[str, list[tuple[Any, ...]]],
    pick: BodyLayerPick,
) -> list[tuple[UUID, float, float, int | None]]:
    """The packing bands a CPT reads inside its own litho extent, top to bottom.

    Parameters
    ----------
    geotech_layer_by_inv_depth : dict
        Every geotech band per investigation id.
    pick : BodyLayerPick
        The CPT's litho-unit extent for this body group.

    Returns
    -------
    list[tuple[UUID, float, float, int | None]]
        ``(layer_id, top_m, base_m, nad_class)``, ordered shallow to deep.
    """
    out: list[tuple[UUID, float, float, int | None]] = []
    for row in geotech_layer_by_inv_depth.get(pick.investigation_id, []):
        top, base, layer_id, _formation_id, nad_class = row[0], row[1], row[2], row[3], row[4]
        # Containment with a mm tolerance: the bands were cut to this very
        # extent, so a float remainder is not a band outside it.
        if top >= pick.top_depth_m - 0.001 and base <= pick.base_depth_m + 0.001:
            out.append((layer_id, top, base, nad_class))
    out.sort(key=lambda b: b[1])
    return out


def _interior_boundaries(
    stack: list[tuple[UUID, float, float, int | None]], pick: BodyLayerPick
) -> list[ColumnBoundary]:
    """The stack's INTERIOR boundaries, each at its elevation on this column.

    Parameters
    ----------
    stack : list
        The column's in-extent bands, shallow to deep.
    pick : BodyLayerPick
        The unit the seams belong to — its collar converts depth to mTAW.

    Returns
    -------
    list[ColumnBoundary]
        One entry per seam between consecutive bands. The unit's own top and
        base are NOT included: those are litho contacts.
    """
    if pick.base_depth_m - pick.top_depth_m <= 0.0:
        return []
    return [
        ColumnBoundary(
            elev_m=pick.surface_elev_m - stack[i][1],
            band_above_id=str(stack[i - 1][0]),
            band_below_id=str(stack[i][0]),
        )
        for i in range(1, len(stack))
    ]


def _bands_between(
    placed: Sequence[PlacedBoundary],
    left_stack: list[tuple[UUID, float, float, int | None]],
    right_stack: list[tuple[UUID, float, float, int | None]],
    unit_top_m: float,
    unit_base_m: float,
    fraction: float,
) -> tuple[list[FillBand], list[tuple[str, ...]]]:
    """Turn placed boundaries into contiguous bands, with their correspondence.

    Parameters
    ----------
    placed : Sequence[PlacedBoundary]
        Boundaries on the borehole, top to bottom. Off-log entries (a tie line
        that crosses the column outside the unit) cut nothing, but classify
        the interval they bound.
    left_stack, right_stack : list
        The two columns' in-extent bands, for the class and the tie endpoints.
    unit_top_m, unit_base_m : float
        The borehole's own unit extent, which the bands tile exactly.
    fraction : float
        Where the borehole stands across the gap, ``0`` at the left column.
        Where the two flanks disagree about a band's class, the NEARER flank
        names it — the far flank's different class is an onlap that pinched
        out before reaching here (owner dogfeed 2026-08-18: B9 took the far
        column's D over the near column's MD).

    Returns
    -------
    tuple[list[FillBand], list[tuple[str, ...]]]
        The bands and, per band, the ``litho_layer`` ids it continues — both
        columns' where a tie declared the boundary, one where a lens did.
    """
    class_of: dict[str, int | None] = {}
    for band in [*left_stack, *right_stack]:
        class_of[str(band[0])] = band[3]

    def _near_first(left_id: str | None, right_id: str | None) -> list[str]:
        pair = (left_id, right_id) if fraction <= 0.5 else (right_id, left_id)
        return [x for x in pair if x is not None]

    cuts_b = [b for b in placed if b.on_log]
    # A tie line passing above (below) the unit still says what runs past it:
    # the interval it bounds continues the line's under-side (over-side) bands.
    above_ctx = [b for b in placed if not b.on_log and b.depth_m <= unit_top_m + _DEPTH_TOL_M]
    below_ctx = [b for b in placed if not b.on_log and b.depth_m >= unit_base_m - _DEPTH_TOL_M]

    # The band ABOVE the first boundary continues whatever sat above it.
    cuts = [unit_top_m, *[b.depth_m for b in cuts_b], unit_base_m]
    bands: list[FillBand] = []
    correspondences: list[tuple[str, ...]] = []
    for i in range(len(cuts) - 1):
        top, base = cuts[i], cuts[i + 1]
        if base - top < 0.001:
            continue
        # Which band ids this interval continues: below the boundary that opens
        # it, or above the one that closes it for the topmost interval.
        ids: list[str] = []
        if i > 0:
            opener = cuts_b[i - 1]
            ids = _near_first(opener.left_band_below_id, opener.right_band_below_id)
        elif above_ctx:
            line = above_ctx[-1]
            ids = _near_first(line.left_band_below_id, line.right_band_below_id)
        elif cuts_b:
            closer = cuts_b[0]
            ids = _near_first(closer.left_band_above_id, closer.right_band_above_id)
        elif below_ctx:
            line = below_ctx[0]
            ids = _near_first(line.left_band_above_id, line.right_band_above_id)
        else:
            near, far = (left_stack, right_stack) if fraction <= 0.5 else (right_stack, left_stack)
            source = near if near else far
            ids = [str(source[0][0])] if source else []
        nad = next((class_of[x] for x in ids if class_of.get(x) is not None), None)
        if nad is None:
            return [], []
        # Two boundaries that do not change the class are not a boundary: the
        # columns simply disagree about where a seam sits inside one packing
        # unit. Merging keeps the correspondence of both.
        if bands and bands[-1].nad_class == int(nad):
            bands[-1] = FillBand(
                top=bands[-1].top,
                base=base,
                nad_class=bands[-1].nad_class,
                source=bands[-1].source,
            )
            correspondences[-1] = tuple(dict.fromkeys([*correspondences[-1], *ids]))
            continue
        bands.append(FillBand(top=top, base=base, nad_class=int(nad), source="cpt_interpolated"))
        correspondences.append(tuple(ids))
    return bands, correspondences


def _clamp_bands_to_flank_cover(
    bands: Sequence[FillBand],
    correspondences: Sequence[tuple[str, ...]],
    *,
    cover_top_m: float,
    cover_base_m: float,
    floor_class: int,
    min_thickness_m: float,
) -> tuple[list[FillBand], list[tuple[str, ...]]]:
    """Fill a borehole unit's overhang with the flank floor, not the dense band.

    Owner, installer #37 dogfeed (2026-09-14), GEO-07/182-B2: *"I don't know
    where the dense sand is coming from though. it says md on the left and md on
    the right."*  The borehole's clean-sand unit is ONE unit that reaches above
    where the flanks' sand begins in this body group (a clean-over-silty litho
    contact splits the flank sand there).  The tie-driven placement painted that
    overhang with the band immediately below the first placed cut — the flank's
    DENSE band — even though the flank's dense band does not reach that high.

    The rule: where the borehole unit extends ABOVE the shallowest flank band
    (or BELOW the deepest), the overhang takes the conservative floor the flanks
    measured (``floor_class`` — the loosest packing across the two flank stacks,
    the same value the donor-fill path uses for a gap), NOT the class of the
    adjacent band.  Design note §1c ("unread ground is not silently claimed"):
    an overhang LONGER than the minimum layer thickness becomes its own floor
    band; a shorter one keeps the current behaviour and stretches to the
    boundary, so a hairline overhang can never flip a whole band to the floor
    class through the coarsen pass.

    When the unit sits entirely inside the flank coverage
    (``cover_top_m <= band tops`` and ``cover_base_m >= band bases``) this is a
    strict no-op — no band is split and the input is returned unchanged.

    Parameters
    ----------
    bands : Sequence[FillBand]
        The tie-placed bands, contiguous and top to bottom (borehole depths).
    correspondences : Sequence[tuple[str, ...]]
        Per band, the ``litho_layer`` ids it continues.  A floor band continues
        nothing, so its correspondence is empty.
    cover_top_m, cover_base_m : float
        The depth range the flank donor actually covers on the borehole
        (shallowest flank band top .. deepest flank band base).
    floor_class : int
        The conservative NAD class for an overhang — the loosest across both
        flank stacks.
    min_thickness_m : float
        The model's minimum sub-unit thickness; an overhang thinner than this is
        left as part of its adjacent band.

    Returns
    -------
    tuple[list[FillBand], list[tuple[str, ...]]]
        The clamped bands and their correspondences, contiguous over the same
        extent, adjacent same-class rows coalesced.
    """
    out_bands: list[FillBand] = []
    out_corr: list[tuple[str, ...]] = []
    for band, corr in zip(bands, correspondences):
        # Overhang lengths above the cover top and below the cover base.
        head_len = min(band.base, cover_top_m) - band.top
        tail_len = band.base - max(band.top, cover_base_m)
        make_head = head_len >= min_thickness_m - _DEPTH_TOL_M
        make_tail = tail_len >= min_thickness_m - _DEPTH_TOL_M
        cursor = band.top
        if make_head:
            out_bands.append(FillBand(cursor, cover_top_m, floor_class, "body_min"))
            out_corr.append(())
            cursor = cover_top_m
        inside_base = max(cursor, cover_base_m) if make_tail else band.base
        if inside_base - cursor > _DEPTH_TOL_M:
            out_bands.append(FillBand(cursor, inside_base, band.nad_class, band.source))
            out_corr.append(corr)
            cursor = inside_base
        if make_tail and band.base - cursor > _DEPTH_TOL_M:
            out_bands.append(FillBand(cursor, band.base, floor_class, "body_min"))
            out_corr.append(())

    # Coalesce adjacent same-class rows (a floor band beside a same-class inside
    # band), unioning their correspondences so nothing that continues a flank
    # band is dropped by the merge.
    merged_bands: list[FillBand] = []
    merged_corr: list[tuple[str, ...]] = []
    for band, corr in zip(out_bands, out_corr):
        if merged_bands and merged_bands[-1].nad_class == band.nad_class:
            merged_bands[-1] = replace(merged_bands[-1], base=band.base)
            merged_corr[-1] = tuple(dict.fromkeys([*merged_corr[-1], *corr]))
            continue
        merged_bands.append(band)
        merged_corr.append(corr)
    return merged_bands, merged_corr


def layer_donor_picks(
    correlated: Sequence[BodyLayerPick],
    body_picks: Sequence[BodyLayerPick],
    *,
    receiver_formation_id: str,
    layer_top_elev_m: float,
    layer_base_elev_m: float,
    flanking_investigations: set[str],
) -> list[BodyLayerPick]:
    """The columns a borehole litho layer may borrow its packing from.

    Candidates used to be the CPTs in the borehole's ``(body, geological
    band)`` group.  That is the wrong unit twice over: a geological contact can
    put the two ends of one hand-drawn correlation in different groups, and it
    can leave a group with no column near enough to say anything.  Both bit the
    owner on B4 in one afternoon — a band he had tied to two medium dense
    columns 90 m away took LOOSE sand from a CPT 777 m off, the only other
    member of its group.

    So the LAYER names its donors: the columns its correlations point at, else
    the columns sharing its body.  Three constraints are hard.  A donor must be
    the SAME LITHO UNIT — the same ``source_litho_formation_id`` (soil AND
    admixtures), not merely the same soil.  A donor must FLANK the borehole on a
    section.  And elevation picks the sheet.

    The unit test is stricter than the soil test on purpose (owner ruling
    2026-09-14, borehole GEO-07/182-B2: *"i redivided B2 but there is still a
    dense sand, while there is no dense sand in that litho unit on each adjacent
    test"*).  The resolver welds every admixture variant of one soil into ONE
    litho body (``resolve_litho_instances.same_mass``), so a clean ``ZAND`` unit
    and the glauconitic ``ZAND (GL:|KL:)`` unit below it share a body id.  Where
    the borehole's own clean sand reaches deeper than the flank's clean sand,
    the flank's glauconitic pick overlaps the receiver's extent MORE, and the
    old SOIL test admitted it — so the neighbouring unit's DENSE class was lent
    onto a clean sand every adjacent test read medium dense.  A neighbouring
    unit's class is never lent, whatever the body welding says: only the SAME
    litho unit on the flank donates, and where a flank carries no band of that
    unit at all it contributes nothing (the receiver then falls to the
    conservative floor of ``apply_column_floor``, §8-0b).  The finer key still
    floors only from the same soil, because a formation carries exactly one soil.

    Parameters
    ----------
    correlated : Sequence[BodyLayerPick]
        Layers this one is tied to by an approved litho correlation.
    body_picks : Sequence[BodyLayerPick]
        Layers sharing this one's litho body, whatever geological band — and,
        because the body welds admixture variants of one soil, whatever
        litho unit; the ``receiver_formation_id`` gate is what confines them.
    receiver_formation_id : str
        The receiver litho unit's ``source_litho_formation_id``, stringified —
        the group key's litho formation (``_group_segments`` keys each planning
        group on it).  A donor pick donates only when its own
        ``formation_id`` equals this, so a clean sand borrows only from clean
        sand and never from the glauconitic sand welded into the same body.
    layer_top_elev_m, layer_base_elev_m : float
        The borehole layer's extent in elevation, top above base.
    flanking_investigations : set[str]
        The columns immediately left and right of the borehole, on every
        section it appears on — and this IS the donor gate for both candidate
        sets.  Owner ruling, given twice: *"only left and right test on
        section can be donor"* (2026-08-17 midday), and — after the pool was
        kept wide because filtering measured as starving the model
        (donor-backed bands 118 → 37) — *"the sand on B4 has no neighbours so
        it should default to the lowest packing class on B4"* (2026-08-17
        night, when that wide pool donated from 623 m away).  The starvation
        trade-off was his to make and he made it: an honest conservative
        floor beats a confident answer from a test that is nowhere near.

    Returns
    -------
    list[BodyLayerPick]
        At most one layer per column — a body split by an enclosed lens owns
        several, and only elevation says which is the same sheet.
    """
    by_investigation: dict[str, list[BodyLayerPick]] = defaultdict(list)
    tied_columns: set[str] = set()
    for pick in correlated:
        if pick.investigation_id not in flanking_investigations:
            # A tie is a correlation, not a licence past the flank rule —
            # B4's sand borrowed from a tied test 623 m away the night this
            # gate was missing, and the owner chose the floor over it.
            continue
        # SAME litho unit, not merely same soil: a hand tie may cross facies to
        # declare a shared surface, but the packing LEVEL is lent only from the
        # receiver's own unit (owner 2026-09-14 — "no dense sand in that litho
        # unit on each adjacent test").
        if str(pick.formation_id) != receiver_formation_id:
            continue
        by_investigation[pick.investigation_id].append(pick)
        tied_columns.add(pick.investigation_id)
    for pick in body_picks:
        # The tie already said WHICH of that column's layers this one
        # continues; the body must not offer a second.
        if pick.investigation_id in tied_columns:
            continue
        if pick.investigation_id not in flanking_investigations:
            continue
        # A body welds admixture variants of one soil, so the body pool carries
        # the glauconitic sand alongside the clean one; the unit gate keeps only
        # the receiver's own litho unit.
        if str(pick.formation_id) != receiver_formation_id:
            continue
        by_investigation[pick.investigation_id].append(pick)

    return [
        chosen
        for group in by_investigation.values()
        if (
            chosen := flank_pick_for_unit(
                group,
                unit_top_elev_m=layer_top_elev_m,
                unit_base_elev_m=layer_base_elev_m,
            )
        )
        is not None
    ]


def correlated_donor_picks(
    *,
    unit_top_m: float,
    unit_base_m: float,
    borehole_layers: Sequence[tuple[UUID, float, float]],
    partners_by_layer: Mapping[UUID, frozenset[UUID]],
    picks_by_layer: Mapping[UUID, Sequence[BodyLayerPick]],
) -> list[BodyLayerPick]:
    """The columns the engineer's litho correlation ties this unit to.

    Donors are otherwise grouped by ``(body, geological band)``, and a
    geological contact can put two ends of one hand-drawn correlation in
    different groups.  The owner's B4 is the case: he tied its 6.00-8.43 sand
    to S13's 9.69-15.16 and B6's 9.50-12.59, both medium dense, and the group
    held neither — so the search reached 777 m for the only column it could
    see and copied that column's LOOSE sand onto the borehole.

    A tie is the engineer's statement that two layers are the same sheet, so
    it outranks a grouping the engine derived.  Ruling of 2026-08-11 in the
    same words: *"the user's ties will define this"*.

    Parameters
    ----------
    unit_top_m, unit_base_m : float
        The planning unit's extent on the borehole.  Geological bounding cuts
        a litho layer into several units, each of which inherits the layer's
        correlations rather than losing them to the cut.
    borehole_layers : Sequence[tuple[UUID, float, float]]
        The borehole's own litho layers as ``(id, top_m, base_m)``.
    partners_by_layer : Mapping[UUID, frozenset[UUID]]
        Approved litho correlations, layer to the layers it is tied to.
    picks_by_layer : Mapping[UUID, Sequence[BodyLayerPick]]
        Every pick each layer holds.  Geological bounding cuts one layer into
        several picks, so this is a list: the flank rule chooses among them by
        elevation overlap once they are candidates.

    Returns
    -------
    list[BodyLayerPick]
        The correlated columns' picks, in a stable order.  Empty when the
        unit's layer is uncorrelated, or when a partner belongs to no body
        group and therefore has no stack to lend.
    """
    own = next(
        (
            layer_id
            for layer_id, top, base in borehole_layers
            if top <= unit_top_m + _DEPTH_TOL_M and base >= unit_base_m - _DEPTH_TOL_M
        ),
        None,
    )
    if own is None:
        return []
    return [
        pick
        for partner in sorted(partners_by_layer.get(own, frozenset()), key=str)
        for pick in picks_by_layer.get(partner, ())
    ]


def apply_column_floor(bands: Sequence[PlannedBand]) -> list[PlannedBand]:
    """Raise an unanswered band to the loosest class ITS COLUMN measured, PER UNIT.

    Owner, 2026-08-16: *"when the fallback fires, there is already a sand
    beneath it that does have a higher NAD class.  So we take that NAD class as
    the lowest on the column ... the upper bands which fall back to the lowest
    class will get medium instead of loose."*

    The NAD table's floor is not the conservative answer, it is a fictional
    one.  A LOOSE sand band dropped into a column whose every measured sand
    reads medium dense or better is a layer the site shows nowhere on that
    column, and packing density feeds strength — so inventing one can drive a
    design on data that does not exist.  What the column itself measured for
    that unit is the honest floor.

    **The floor is PER LITHO UNIT, not per soil** (owner 2026-09-12,
    *"per unit ofcourse"*).  The unit is the band's ``source_litho_formation_id``
    — its litho formation row, which the litho find-or-create keys on
    ``(soil, admixtures)``, so a glauconitic sand and a pure sand are two rows
    and *"behave differently"*.  Keying the floor on the formation is strictly
    finer than keying on the soil code: a formation is one soil, so the "a sand
    floors from sand, never from the clay next to it" invariant still holds a
    fortiori, while the glauconitic sand no longer borrows the clean sand's
    measured class for an interval it never read.

    Runs AFTER the donor rule has answered everything it can, across all of a
    borehole's segments, because it reads those answers.

    Parameters
    ----------
    bands : Sequence[PlannedBand]
        Every band planned for ONE borehole, any order.

    Returns
    -------
    list[PlannedBand]
        The bands in the given order.  An unanswered band whose OWN litho unit
        the column did measure is replaced by a copy at that unit's loosest
        measured class, stamped :data:`COLUMN_MIN_SOURCE`, still at ``low``
        confidence — the interval was not read, and the badge must keep saying
        so.  Never lowers a class: a standing sub-minimum sliver (his ruling of
        2026-08-11) keeps its own conservative value.
    """
    # Keyed by the band's own litho unit (``source_litho_formation_id``), so a
    # glauconitic sand's floor comes only from glauconitic-sand readings on this
    # column, never from a clean sand of the same soil (owner 2026-09-12).
    loosest_measured: dict[str, int] = {}
    for band in bands:
        if band.source in _UNRESOLVED_SOURCES:
            continue
        unit = str(band.source_litho_formation_id)
        held = loosest_measured.get(unit)
        if held is None or band.nad_class < held:
            loosest_measured[unit] = band.nad_class

    out: list[PlannedBand] = []
    for band in bands:
        unit = str(band.source_litho_formation_id)
        floor = loosest_measured.get(unit)
        if (
            band.source not in _UNRESOLVED_SOURCES
            or floor is None
            # Only ever upward: the guess was already at or above what the
            # column showed, so there is nothing honest to add.
            or floor <= band.nad_class
        ):
            out.append(band)
            continue
        out.append(replace(band, nad_class=floor, source=COLUMN_MIN_SOURCE, confidence="low"))
    return out


def merge_geo_split_bands(bands: Sequence[PlannedBand]) -> list[PlannedBand]:
    """Collapse two touching bands of one class inside ONE litho LAYER into one.

    Owner, 2026-08-17: *"we're still emitting geotech bands to the geological
    boundary that was split off, that's the user's decision"*.  He has the
    gesture for it — right-click a band → "Split band…", and "Link to geology"
    to couple the boundary — so the engine making that split for him is
    unasked-for surface.

    This began as the repair for a geological cut: the builders divided every
    litho pick at the geological surfaces before any packing was derived, so each
    piece was classified alone and the two could land on the same class.  His B4
    carried ``0.00-0.60 SILT (NAD 13)`` over ``0.60-5.19 SILT (NAD 13)`` — a
    contact marking no packing change — and each piece then earned its own
    correlation, which is how one litho tie became two geotech ties.  Both pieces
    come from the SAME litho LAYER, so that is the case this pass exists for.

    **A user "Split here" is NOT this case, and must survive** (owner 2026-09-12,
    *"if a layer is split into two in the litho then it has to stay split in
    geotech ofcourse"*).  When the engineer splits one litho layer into two
    layers of the SAME composition, the two are DIFFERENT ``litho_layer`` rows
    (different ``source_litho_layer_id``) though they share a formation and can
    land on the same class.  Welding them back — which this pass used to do,
    keying only on the formation — moved the split he drew (his b13-style column:
    two same-class bands become one, the boundary at the split depth vanishes).
    So the merge now also requires the SAME ``source_litho_layer_id``: only two
    pieces of ONE litho layer (a geological surface cut inside it) may collapse.

    Merged only when the class, the litho unit AND the source litho LAYER are the
    same and the two bands touch: the litho model owns its own boundaries
    whatever the classes are, and a gap is a different defect than a duplication.

    Parameters
    ----------
    bands : Sequence[PlannedBand]
        One borehole's bands, any order.

    Returns
    -------
    list[PlannedBand]
        Bands top to bottom.  A merged band keeps the SHALLOWER piece's
        geological parent — one band, one parent, and the shallower piece owns
        the contact above it — and the WEAKEST piece's provenance, so merging
        never claims evidence for ground no donor answered.  A pair sharing a
        formation but drawn from two litho layers stays two bands.
    """

    def weakness(source: str) -> int:
        return _WEAKEST_FIRST.index(source) if source in _WEAKEST_FIRST else len(_WEAKEST_FIRST)

    out: list[PlannedBand] = []
    for band in sorted(bands, key=lambda item: item.depth_top_m):
        held = out[-1] if out else None
        if (
            held is not None
            and held.nad_class == band.nad_class
            and held.source_litho_formation_id == band.source_litho_formation_id
            # RULING B (owner 2026-09-12): a band never crosses a litho-layer
            # contact. Two pieces of ONE litho layer (a geo cut inside it) share
            # this id and may merge; a user "Split here" makes two layers with
            # two ids and must stay split.
            and held.source_litho_layer_id == band.source_litho_layer_id
            and abs(held.depth_base_m - band.depth_top_m) <= _DEPTH_TOL_M
        ):
            weaker = min((held, band), key=lambda item: weakness(item.source))
            out[-1] = replace(
                held,
                depth_base_m=band.depth_base_m,
                source=weaker.source,
                confidence=weaker.confidence,
                donors=held.donors or band.donors,
                donor_layer_ids=tuple(
                    dict.fromkeys([*held.donor_layer_ids, *band.donor_layer_ids])
                ),
            )
            continue
        out.append(band)
    return out


def _bands_by_borehole(
    planned_segments: Sequence[PlannedBoreholeSegment],
) -> dict[str, list[tuple[int, int, PlannedBand]]]:
    """Index every planned band by its borehole, carrying its ``(segment, band)`` slot.

    Parameters
    ----------
    planned_segments : Sequence[PlannedBoreholeSegment]
        The per-body-group segments, in plan order.

    Returns
    -------
    dict[str, list[tuple[int, int, PlannedBand]]]
        ``investigation_id -> [(segment_index, band_index, band), ...]``, so a
        per-borehole pass can read every band and write a change back to its
        exact slot.
    """
    out: dict[str, list[tuple[int, int, PlannedBand]]] = defaultdict(list)
    for seg_index, planned in enumerate(planned_segments):
        for band_index, planned_band in enumerate(planned.bands):
            out[planned.investigation_id].append((seg_index, band_index, planned_band))
    return out


def _collapse_touching_same_class_bands(planned_segments: list[PlannedBoreholeSegment]) -> int:
    """Weld each borehole's touching same-class same-layer bands, IN PLACE.

    ``merge_geo_split_bands`` decides which of a borehole's bands are one band;
    this folds its verdict back into ``planned_segments``.  A merged band can
    span two geological slices, so the borehole's merged bands are rewritten into
    its FIRST segment and the other segments emptied — a merged band no longer
    belongs to one slice's segment alone.

    Parameters
    ----------
    planned_segments : list[PlannedBoreholeSegment]
        The segments to collapse; mutated in place.

    Returns
    -------
    int
        How many bands were merged away across all boreholes.
    """
    merged_total = 0
    for entries in _bands_by_borehole(planned_segments).values():
        merged = merge_geo_split_bands([entry[2] for entry in entries])
        if len(merged) == len(entries):
            continue
        merged_total += len(entries) - len(merged)
        # The whole borehole is rewritten into its FIRST segment: a merged band
        # spans two geological slices, so it no longer belongs to either alone.
        first_seg = min(entry[0] for entry in entries)
        for seg_index in {entry[0] for entry in entries}:
            planned_segments[seg_index] = replace(
                planned_segments[seg_index],
                bands=tuple(merged) if seg_index == first_seg else (),
            )
    return merged_total


def finalize_borehole_bands(
    planned_segments: Sequence[PlannedBoreholeSegment],
) -> tuple[list[PlannedBoreholeSegment], int, int, int]:
    """Collapse geo cuts, raise unanswered bands to the column floor, collapse AGAIN.

    Three passes run over every borehole's bands, in this order:

    1. **Merge geo cuts** (:func:`merge_geo_split_bands` via
       :func:`_collapse_touching_same_class_bands`): a geological surface that
       split one litho layer into two same-class pieces is undone, so the floor
       and the ties see the one band the layer actually is.
    2. **Column floor** (:func:`apply_column_floor`): an unanswered band is
       raised to the loosest class ITS OWN column measured for that litho unit,
       rather than the fictional NAD-table floor.
    3. **Merge again**: step 2 can RAISE an unanswered band to the class of a
       touching neighbour in the SAME litho layer — a duplicate the step-1 merge
       could not see, because the two were different classes then.  Left unmerged
       it is the owner's finding (installer #40, GEO-07/182-B2: *"how come i have
       two stacked md sands on B2?"*): a ``body_min`` NAD-5 floor band over a
       measured NAD-6 band, both inside one litho ZAND layer, that the column
       floor lifted to NAD 6 after the first merge had already passed them.  Two
       touching bands of one class in one litho layer are one band, whatever pass
       split them, so the merge runs after the raise as well.

    Parameters
    ----------
    planned_segments : Sequence[PlannedBoreholeSegment]
        The per-body-group segments as first planned.

    Returns
    -------
    tuple[list[PlannedBoreholeSegment], int, int, int]
        ``(segments, merged_away, raised_count, merged_after_floor)`` — the
        finalized segments and the three counts the caller logs.
    """
    segments = list(planned_segments)
    merged_away = _collapse_touching_same_class_bands(segments)

    # The donor rule has now answered everything it can, so the bands it could
    # NOT answer can be honest about this column instead of about the NAD table.
    # Gathered across every segment of a borehole, because the measured sand that
    # sets a sliver's floor is usually in a different body group from the sliver.
    band_updates: dict[int, dict[int, PlannedBand]] = defaultdict(dict)
    raised_count = 0
    for entries in _bands_by_borehole(segments).values():
        raised = apply_column_floor([entry[2] for entry in entries])
        for (seg_index, band_index, before), after in zip(entries, raised):
            if before.source != after.source:
                band_updates[seg_index][band_index] = after
                raised_count += 1
    for seg_index, changes in band_updates.items():
        planned = segments[seg_index]
        segments[seg_index] = replace(
            planned,
            bands=tuple(
                changes.get(band_index, planned_band)
                for band_index, planned_band in enumerate(planned.bands)
            ),
        )

    # A geological cut that split a packing band of unchanged class is undone,
    # then the raise can make two touching bands the same class — so weld once
    # more (owner installer #40, B2's two stacked medium-dense sands).
    merged_after_floor = _collapse_touching_same_class_bands(segments)
    return segments, merged_away, raised_count, merged_after_floor


def coarsen_to_minimum_thickness(
    bands: Sequence[FillBand], *, minimum_thickness_m: float
) -> list[FillBand]:
    """Merge away bands the model's minimum thickness says cannot exist.

    Owner, 2026-08-17: *"just respect minimum thickness and the cpt bands"*.

    Mapping a donor's packing onto a borehole rescales it to the borehole's own
    unit thickness, so a thin unit receives a COMPRESSED copy of the donor's
    structure.  His B5 got seven sub-bands — 2 cm to 19 cm — inside a 0.465 m
    tail, which is not a model of anything.

    Two cases, and the difference matters:

    * A sub-minimum band **grows** to the minimum at the expense of a
      neighbour that can spare the thickness and still stand.  It is a reading
      the flanking column made, and deleting it loses a layer the neighbours
      have: his B4's basal clay lost the KLEI 22 top that both S6 and S13 read,
      because the mapped band was 0.22 m (2026-08-17).
    * Where **no** neighbour can spare it — the run is all slivers, or giving
      would push the neighbour under in its turn — they merge and the survivor
      takes the **loosest** class of the run.  That is his ruling of 2026-08-11
      (audit F05): *"absorbing may never silently make a band denser"*.

    Parameters
    ----------
    bands : Sequence[FillBand]
        The mapped bands, contiguous and top to bottom.
    minimum_thickness_m : float
        The geotech model's minimum sub-unit thickness.

    Returns
    -------
    list[FillBand]
        Contiguous bands tiling the same extent, every one at or above the
        minimum unless the extent itself is thinner.  Adjacent bands of one
        class are coalesced, so a merge never leaves two rows saying the same
        thing.
    """

    def thickness(band: FillBand) -> float:
        return band.base - band.top

    def stands(band: FillBand) -> bool:
        """Whether a band meets the minimum, to the millimetre grain.

        Compared with a tolerance because growing a band to exactly the minimum
        lands a float an atom short of it — and an atom short means "grow it
        again", forever, since growing does not shorten the list.
        """
        return thickness(band) >= minimum_thickness_m - _DEPTH_TOL_M

    def coalesce(rows: list[FillBand]) -> list[FillBand]:
        out: list[FillBand] = []
        for band in rows:
            if out and out[-1].nad_class == band.nad_class:
                out[-1] = replace(out[-1], base=band.base)
                continue
            out.append(band)
        return out

    work = coalesce(list(bands))
    # Each pass either grows one band to the minimum or removes one, so the
    # number of passes is bounded by twice the band count. The cap is a
    # backstop against a rule change reintroducing a non-terminating pass.
    for _pass in range(2 * len(work) + 2):
        if len(work) < 2:
            break
        # The thinnest offender first, so one pass cannot leave a thinner band
        # behind a thicker one it should have absorbed.
        index = min(
            (i for i, band in enumerate(work) if not stands(band)),
            key=lambda i: thickness(work[i]),
            default=None,
        )
        if index is None:
            break
        left = work[index - 1] if index > 0 else None
        right = work[index + 1] if index + 1 < len(work) else None
        # A neighbour that could give the band its missing thickness and still
        # stand on its own. Growing beats absorbing: the band is a reading the
        # flanking column actually made, and deleting it loses a layer the
        # neighbours have (owner's B4 basal clay, 2026-08-17).
        shortfall = minimum_thickness_m - thickness(work[index])
        growable = thickness(work[index]) >= GROWABLE_FRACTION_OF_MINIMUM * minimum_thickness_m
        donors = (
            []
            if not growable
            else [
                neighbour
                for neighbour in (left, right)
                if neighbour is not None and thickness(neighbour) - shortfall >= minimum_thickness_m
            ]
        )
        if donors:
            donor = max(donors, key=thickness)
            donor_index = work.index(donor)
            if donor_index < index:
                work[donor_index] = replace(donor, base=donor.base - shortfall)
                work[index] = replace(work[index], top=work[index].top - shortfall)
            else:
                work[donor_index] = replace(donor, top=donor.top + shortfall)
                work[index] = replace(work[index], base=work[index].base + shortfall)
        else:
            # Nothing here stands: merge with the thicker sliver and never end
            # up denser than the loosest of the two.
            partner_index = (
                index + 1
                if left is None
                else index - 1
                if right is None
                else (index - 1 if thickness(left) >= thickness(right) else index + 1)
            )
            low, high = sorted((index, partner_index))
            work[low] = replace(
                work[low],
                base=work[high].base,
                nad_class=min(work[low].nad_class, work[high].nad_class),
            )
            work.pop(high)
        work = coalesce(work)
    return work


def clip_bands_to_slice(
    bands: Sequence[FillBand], slice_top_m: float, slice_base_m: float
) -> list[FillBand]:
    """Keep the part of a layer's derivation that falls inside one slice.

    A geological contact cuts a litho layer into pieces that are planned and
    written separately.  The packing is derived once across the whole layer, so
    each piece takes its own window out of that one answer instead of reading
    the neighbouring column again — which on the owner's B9 produced the
    flank's ``6 -> 8 -> 7`` sand twice over.

    Parameters
    ----------
    bands : Sequence[FillBand]
        The layer's bands, contiguous and top to bottom.
    slice_top_m, slice_base_m : float
        The slice's own extent, which the result tiles exactly.

    Returns
    -------
    list[FillBand]
        The overlapping bands, trimmed to the slice.  A band shorter than the
        1 mm depth grain after trimming is dropped: it is a boundary that
        coincides with the cut, not a band.
    """
    out: list[FillBand] = []
    for band in bands:
        top = max(band.top, slice_top_m)
        base = min(band.base, slice_base_m)
        if base - top < _DEPTH_TOL_M:
            continue
        out.append(replace(band, top=top, base=base))
    return out


def flank_pick_for_unit(
    picks: Sequence[BodyLayerPick],
    *,
    unit_top_elev_m: float,
    unit_base_elev_m: float,
) -> BodyLayerPick | None:
    """Which of a column's intervals in this body flanks the borehole's unit.

    A body split by an enclosed lens owns MORE THAN ONE interval per column,
    so "the flank column's layer in this body" is not a single thing.  Keying
    them by investigation — as this planner did until 2026-08-16 — silently
    kept whichever came last, and every shallow unit then read its packing off
    the deep interval.  The owner saw the result on Cross-section 1: S6's very
    dense sand from 14.90 m appeared at 11.87 m on B6 and B4, above a lens it
    lies below on S6, at a depth where neither flank is very dense.

    Matched on ELEVATION overlap, not on position in the list: two columns can
    carry a different number of intervals (the lens pinches out), and only
    elevation says which interval is the same sheet.

    Parameters
    ----------
    picks : Sequence[BodyLayerPick]
        One column's intervals in this body group.
    unit_top_elev_m, unit_base_elev_m : float
        The borehole unit's own extent, in elevation (top above base).

    Returns
    -------
    BodyLayerPick | None
        The overlapping interval, the largest overlap winning.  ``None`` when
        nothing overlaps — an interval that shares no elevation with the unit is
        not the same sheet, and answering "nearest" here let a guess be treated
        as evidence: the owner's B4 took its structure, and a correlation, from
        a sand 4 m deeper (2026-08-17).  With no donor the unit falls to the
        column floor, which is one band at the loosest class the column
        measured.
    """
    best: BodyLayerPick | None = None
    best_overlap = 0.0
    for pick in picks:
        top = pick.surface_elev_m - pick.top_depth_m
        base = pick.surface_elev_m - pick.base_depth_m
        overlap = min(top, unit_top_elev_m) - max(base, unit_base_elev_m)
        if overlap > best_overlap:
            best, best_overlap = pick, overlap
    return best


def litho_contact_tie_pairs(
    accepted_ties: Sequence[AcceptedTie],
    geotech_layer_by_inv_depth: Mapping[str, list[tuple[Any, ...]]],
    litho_layer_depths: Mapping[UUID, tuple[str, float, float]],
    litho_body_by_layer: Mapping[UUID, str | None],
    along_by_investigation: Mapping[str, float],
    borehole_ids: set[str],
) -> list[tuple[str, str]]:
    """Ties that declare the BASE CONTACT of one shared litho unit.

    Owner's step 1, 2026-08-16: *"if a cpt to cpt contact is a litho contact,
    then you replace it by the litho bands"*.  Every borehole between the two
    columns carries that contact in its own log, so dividing it re-expresses
    the tie and the tie is deleted with the rest.

    The case that exposed it is the owner's own, and his framing is the one
    encoded here — *"i thought we were talking about the silt unit on top that
    should be one unit"*.  His S13 KLEI-21 ↔ S6 ZAND-5 tie looks like a
    cross-facies oddity if you read the bands it names: clay below on one
    column, sand below on the other.  Read the unit ABOVE instead and it is one
    silt body (measured: S6 1.52–7.542 and S13 1.42–8.16 share a ``body_id``),
    so the tie declares that body's base — a single contact, with the facies
    changing beneath it.

    Both clauses matter.  "Topmost band of its own unit" makes the surface a
    litho contact on each column; "one unit above" makes it the SAME contact
    laterally.  Without the second, this would delete a tie joining two
    unrelated contacts that merely happen to be unit boundaries.

    Parameters
    ----------
    accepted_ties : Sequence[AcceptedTie]
        The engineer's accepted packing correlations on one section.
    geotech_layer_by_inv_depth : Mapping[str, list[tuple[Any, ...]]]
        Every geotech band per investigation, ``(top, base, layer_id, ...)``.
    litho_layer_depths : Mapping[UUID, tuple[str, float, float]]
        ``litho layer id -> (investigation, top_m, base_m)``.
    litho_body_by_layer : Mapping[UUID, str | None]
        ``litho layer id -> body id``; the correlated-unit identity.
    along_by_investigation : Mapping[str, float]
        Along-positions on that section.
    borehole_ids : set[str]
        Investigations that are boreholes.

    Returns
    -------
    list[tuple[str, str]]
        ``(layer_a, layer_b)`` per tie to delete.  Only ties with a borehole
        BETWEEN their columns — with none there nothing was re-expressed.
    """
    layers_by_inv: dict[str, list[tuple[UUID, float, float]]] = {}
    for layer_id, (inv, top, base) in litho_layer_depths.items():
        layers_by_inv.setdefault(inv, []).append((layer_id, top, base))

    band_top: dict[str, tuple[str, float]] = {}
    for inv, rows in geotech_layer_by_inv_depth.items():
        for row in rows:
            band_top[str(row[2])] = (inv, float(row[0]))

    def unit_above(layer_id: str) -> str | None:
        """The body of the litho unit sitting ON this band, when it starts a unit.

        ``None`` when the band is not the topmost of its own unit (the surface
        is an interior packing seam, not a contact) or when nothing sits above
        it (the contact is the ground surface, which no tie restates).
        """
        entry = band_top.get(layer_id)
        if entry is None:
            return None
        inv, top = entry
        own = next(
            # 1 mm: litho_layer stores intervals at that grain and the geotech
            # bands were cut to these contacts, so coincidence within it is the
            # same surface.
            (lid for lid, ltop, _lbase in layers_by_inv.get(inv, []) if abs(ltop - top) <= 0.001),
            None,
        )
        if own is None:
            return None
        above = next(
            (lid for lid, _ltop, lbase in layers_by_inv.get(inv, []) if abs(lbase - top) <= 0.001),
            None,
        )
        return None if above is None else litho_body_by_layer.get(above)

    out: list[tuple[str, str]] = []
    for tie in accepted_ties:
        a_along = along_by_investigation.get(tie.investigation_a)
        b_along = along_by_investigation.get(tie.investigation_b)
        if a_along is None or b_along is None:
            continue
        low, high = sorted((a_along, b_along))
        if not any(
            low < along_by_investigation[inv] < high
            for inv in borehole_ids
            if inv in along_by_investigation
        ):
            continue
        body_a = unit_above(tie.layer_a_id)
        body_b = unit_above(tie.layer_b_id)
        if body_a is not None and body_a == body_b:
            out.append((tie.layer_a_id, tie.layer_b_id))
    return out


def _tiles_extent(bands: Sequence[FillBand], top_m: float, base_m: float) -> bool:
    """Whether *bands* cover ``[top_m, base_m]`` exactly, with no gap or overlap.

    The same property the database's ``litho_layer`` contiguity trigger
    enforces, checked before the write so a failure degrades one column instead
    of aborting the whole divide.

    Parameters
    ----------
    bands : Sequence[FillBand]
        The planned bands for one extent, in depth order.
    top_m, base_m : float
        The extent they must tile.

    Returns
    -------
    bool
        ``True`` when the bands run top to base with every seam shared.
    """
    if not bands:
        return False
    # The trigger works on the stored mm grid, so compare there: a float
    # remainder below that grain is not a gap the database will ever see.
    tolerance = 0.0005
    if abs(bands[0].top - top_m) > tolerance or abs(bands[-1].base - base_m) > tolerance:
        return False
    return all(abs(upper.base - lower.top) <= tolerance for upper, lower in zip(bands, bands[1:]))
