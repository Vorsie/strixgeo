"""Materialise geotech bands for borehole columns using litho-confined CPT fill.

:class:`DivideBoreholes` is a standalone step that runs **after**
:class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`
(and optionally after the user has made manual packing correlations).  SAB
writes CPT geotech layers; DivideBoreholes reads those layers, and for each
borehole's litho-body extent fills it with same-lithology CPT packing data,
clipped to that extent, with a conservative cascade for any uncovered depth.

Where the packing comes from — the flanking CPTs on the section
---------------------------------------------------------------
Owner ruling, 2026-08-04 (dogfeed of the borehole packing preview):

    the borehole's packing must come from the CPT to the right and to the left
    on the cross section

So each borehole is filled from the two donor CPTs that flank it **along a
section line**, blended in thickness-fraction space —
:mod:`groundmodel.domain.services.borehole_flank_donors` holds the whole rule
and its two flagged interpretations.

This replaced an ordinal transition-surface TIN: ``transition_surfaces[k]``
blended the k-th band boundary of EVERY CPT in the body group, whatever pair of
packing classes each of those boundaries actually separated, and then decided
each band's class by a majority vote across the same crowd.  On the real model
that mixed up to ten different class pairs (inversions included) over CPTs as
far as 777 m away, and a borehole outside the resulting TIN footprint silently
degraded to the body-wide mean.  1411-GEO-23/126-B4 came out with its dense
sand starting at elevation −1.1 m while both of its neighbours read it from
≈ +0.6 m upward.

Why litho-confined
------------------
A donor only contributes the geotech layers that fall within the CPT's OWN
litho-body extent for the group being filled (the same-lithology clip).  On a
borehole with sand over basal clay, a CPT column that runs sand from 0–8 m can
have packing transitions at e.g. 6 m; borrowing that transition into the
borehole's clay extent (3–8 m) would stamp a sand packing class onto clay.

Separating borehole division from SAB allows the engineer to:

1. Run SAB (CPT-only subdivision + auto-connect).
2. Review + manually correlate packing bands across tests.
3. Click "Divide boreholes" — boreholes receive litho-confined bands
   reflecting the FINAL body membership and packing structure.

Architecture
------------
The use case inherits :class:`GeotechBoreholeMaterialiser` for the shared
formation find-or-create logic.  Donor gathering and the litho-extent filter
live here (``_plan_borehole_bands_litho_confined``); the decision of WHICH
donors and HOW they blend lives in the pure domain module.  This is the only
borehole packing-division path — SubdivideAllBodies materialises CPT bands
only.

Plan / commit split
-------------------
Everything up to the first write lives in :meth:`DivideBoreholes.plan`, which
returns a :class:`DivideBoreholePlan` and issues nothing but ``SELECT``\\ s.
:meth:`DivideBoreholes.execute` calls it and transcribes the result; the
preview endpoint calls it and reports the result.  The engineer therefore sees
the bands the button will write, from the same code that writes them — a
second implementation of the rules could show one packing class and commit
another, which is the one defect this feature cannot tolerate.

What it persists (one transaction, single commit)
-------------------------------------------------
1. **Deletes** all existing borehole ``litho_layer`` rows in the geotech model.
2. **Inserts** new ``litho_layer`` rows, one per
   :class:`~groundmodel.domain.services.borehole_packing_fill.FillBand`,
   with ``source='segmenter'`` and ``confidence`` driven by band provenance:
   ``"cpt_interpolated"`` → ``high``, ``"body_min"`` / ``"absolute_min"`` → ``low``.
3. The LL→FC trigger auto-derives ``formation_contact`` rows.
4. **Re-creates every ACCEPTED packing tie that touched a borehole column.**
   Deleting the borehole bands cascades their correlation edges away, hand-drawn
   ties included, so the ties are captured by identity beforehand and
   re-anchored onto the rebuilt bands afterwards — the same
   :class:`~groundmodel.application.geotech_tie_reanchor.GeotechTieReanchor`
   SubdivideAllBodies uses.  A tie carried onto a band that is not clearly the
   one it was drawn on comes back FLAGGED (``review_reason``), never silently
   dropped; the counts ride out on :class:`DivideBoreholeResult`.
5. ONE commit.

Idempotency
-----------
A re-run deletes the previous borehole bands before inserting new ones, so
the result is always consistent with the current CPT geotech layers.
"""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_band_edit_helpers import _parse_admixtures
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.geotech_crossing_sweep import sweep_crossing_ties
from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    bridge_edges_over_bandless_columns,
    derive_geotech_edges_from_litho,
    load_accepted_geotech_sided_edges_by_section,
    load_approved_litho_edge_sets,
    load_existing_geotech_edge_pairs_by_section,
    load_existing_geotech_sided_edges_by_section,
    load_geotech_edges_for_supersession,
    load_litho_layer_depths,
    load_project_sections,
)
from groundmodel.application.geotech_tie_reanchor import (
    ANCHOR_BOREHOLE,
    BandIdentity,
    GeotechTieReanchor,
    ReanchorPlan,
    RebuiltBand,
    depth_to_mm,
    plan_tie_reanchor,
    rebuilt_bands_from_layer_index,
)
from groundmodel.application.geotech_tie_tombstones import build_tombstone_gates
from groundmodel.application.geotech_view_state import (
    DEFAULT_MIN_THICKNESS_M,
    read_geotech_min_thickness_m,
)
from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.application.section_membership import (
    load_investigation_names,
    load_section_member_investigation_ids,
)
from groundmodel.domain.services.assign_borehole_band_body import (
    CptBandRef,
    assign_borehole_band_body,
)
from groundmodel.domain.services.assign_sample_to_band import Band, assign_sample_to_band
from groundmodel.domain.services.borehole_flank_donors import (
    DonorBand,
    DonorStack,
    FlankSelection,
    SectionPlacement,
    confidence_from_donor_distance,
    flank_packing_surfaces_with_donors,
    select_flank_donors,
)
from groundmodel.domain.services.borehole_packing_fill import (
    FillBand,
    fill_borehole_litho_body_extent,
)
from groundmodel.domain.services.geotech_column_sampler import (
    LithoFrame,
    locate_column_in_partition,
    place_bands_in_litho_layer,
    sample_regions_at_fraction,
)
from groundmodel.domain.services.geotech_edge_dedup import (
    GeotechEdgeRow,
    duplicate_edge_ids_to_drop,
)
from groundmodel.domain.services.geotech_jump_tie_supersession import (
    superseded_jump_tie_ids,
)
from groundmodel.domain.services.geotech_tie_donors import (
    AcceptedTie,
    select_tie_informed_donors,
)
from groundmodel.domain.services.geotech_unit_boundaries import (
    ColumnBoundary,
    PlacedBoundary,
    place_unit_boundaries,
    replaced_tie_indices,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.domain.services.nad_classifier import loosest_class_for
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm

# Epsilon for the same-lithology depth-overlap filter: a CPT geotech layer
# that starts within this distance of the CPT's litho-body extent boundary
# is still included (avoids dropping bands snapped to the extent edge).
# 1 mm — the grain `litho_layer` stores intervals at.
_DEPTH_OVERLAP_EPS = 0.001

# FillBand.source → litho_layer.confidence used to be a flat map that stamped
# every donor-derived band 'high' — a tie-backed band and a lone flank 623 m out
# were indistinguishable rows after commit (audit F08). Owner ruling 2026-08-11:
# "map the confidence honestly, just take distance to nearest cpt as a measure
# for now" — donor-derived bands take confidence_from_donor_distance(nearest
# donor); the conservative fallbacks (body_min, absolute_min) have no donor and
# stay 'low' via the same helper's None arm.


@dataclass(frozen=True)
class BandDonor:
    """One CPT a borehole band's packing was read from.

    The provenance the engineer asked to see on hover: which test spoke, from
    which side, and how far away it was.  Light on purpose — it names the donor
    rather than carrying its stack.

    Parameters
    ----------
    name : str
        The donor CPT's display name.
    side : str
        ``left`` / ``right`` when the donor flanked the borehole on a section;
        ``nearest`` when no section placed the borehole beside a donor and the
        map-distance fallback chose it.
    along_distance_m : float | None
        Distance from the borehole along the section line (m).  ``None`` in the
        map-distance fallback, where no section was involved.
    map_distance_m : float
        Straight-line map distance from the borehole (m).
    """

    name: str
    side: str
    along_distance_m: float | None
    map_distance_m: float


@dataclass(frozen=True)
class PlannedBand:
    """One packing band the divide WOULD write on a borehole column.

    Carries everything the persistence step needs, so a committed band is a
    verbatim transcription of a planned one and the preview cannot drift from
    the commit.

    Parameters
    ----------
    depth_top_m : float
        Top of the band, metres below the borehole collar.
    depth_base_m : float
        Base of the band, metres below the collar.
    nad_class : int
        The NAD packing class derived for this interval.
    source : str
        Provenance token from
        :func:`~groundmodel.domain.services.borehole_packing_fill.fill_borehole_litho_body_extent`
        — ``cpt_interpolated`` / ``body_min`` / ``absolute_min``.
    confidence : str
        ``litho_layer.confidence`` this band gets, mapped from ``source`` via
        ``_BOREHOLE_CONFIDENCE_MAP``.
    body_id : UUID | None
        The geotech packing body the band joins (nearest same-class CPT), or
        ``None`` for a conservative fallback with no same-class CPT evidence.
    source_litho_formation_id : UUID
        Litho formation this geotech band subdivides — half the find-or-create
        key for the band's geotech formation.
    source_geo_formation_id : UUID | None
        Geological formation the band sits within — the other half of the key.
    mode : str
        How this band's packing was reached: ``tie_interpolated`` (blended
        between the two CPTs an ACCEPTED packing tie joins across this
        borehole's column — the strongest evidence, because the engineer drew
        that correlation himself), ``flank_interpolated`` (blended
        between the CPTs left and right of the borehole on a section),
        ``single_donor`` (one flank, or the nearer of two that read different
        class sequences), ``nearest_fallback`` (no section placed the borehole
        beside a donor), or ``body_min`` / ``absolute_min`` for a conservative
        fill band, which by definition had no donor.
    donors : tuple[BandDonor, ...]
        The CPT(s) the packing was read from — empty for the conservative
        fills.
    donor_layer_ids : tuple[str, ...]
        The ``litho_layer`` id of the donor BAND this band continues, on each
        flank — the correspondence the fraction rescale established (band *i*
        left ↔ band *i* here ↔ band *i* right).  Empty for a conservative fill,
        which continues nothing.  This is what lets the commit write the
        borehole hop outright instead of guessing the pairing back from depths
        (owner 2026-08-15).
    section_id : str | None
        Section the donors were read along; ``None`` outside the flank modes.
        The hop this band licenses is section-scoped, like every other edge.
    section_name : str | None
        That section's display name.
    """

    depth_top_m: float
    depth_base_m: float
    nad_class: int
    source: str
    confidence: str
    body_id: UUID | None
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None
    # Donor provenance — appended with defaults so every existing construction
    # site keeps working and the wire schema stays additive.
    mode: str = ""
    donors: tuple[BandDonor, ...] = ()
    donor_layer_ids: tuple[str, ...] = ()
    section_id: str | None = None
    section_name: str | None = None


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
    """The stack's INTERIOR boundaries as fractions of the unit.

    Parameters
    ----------
    stack : list
        The column's in-extent bands, shallow to deep.
    pick : BodyLayerPick
        The unit extent the fractions are read in.

    Returns
    -------
    list[ColumnBoundary]
        One entry per seam between consecutive bands. The unit's own top and
        base are NOT included: those are litho contacts.
    """
    thickness = pick.base_depth_m - pick.top_depth_m
    if thickness <= 0.0:
        return []
    return [
        ColumnBoundary(
            fraction=(stack[i][1] - pick.top_depth_m) / thickness,
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
) -> tuple[list[FillBand], list[tuple[str, ...]]]:
    """Turn placed boundaries into contiguous bands, with their correspondence.

    Parameters
    ----------
    placed : Sequence[PlacedBoundary]
        Boundaries on the borehole, top to bottom.
    left_stack, right_stack : list
        The two columns' in-extent bands, for the class and the tie endpoints.
    unit_top_m, unit_base_m : float
        The borehole's own unit extent, which the bands tile exactly.

    Returns
    -------
    tuple[list[FillBand], list[tuple[str, ...]]]
        The bands and, per band, the ``litho_layer`` ids it continues — both
        columns' where a tie declared the boundary, one where a lens did.
    """
    class_of: dict[str, int | None] = {}
    for band in [*left_stack, *right_stack]:
        class_of[str(band[0])] = band[3]

    # The band ABOVE the first boundary continues whatever sat above it.
    cuts = [unit_top_m, *[b.depth_m for b in placed], unit_base_m]
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
            opener = placed[i - 1]
            ids = [
                x for x in (opener.left_band_below_id, opener.right_band_below_id) if x is not None
            ]
        elif placed:
            closer = placed[0]
            ids = [
                x for x in (closer.left_band_above_id, closer.right_band_above_id) if x is not None
            ]
        elif left_stack:
            ids = [str(left_stack[0][0])]
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


_DEPTH_TOL_M = 0.001
"""Depth grain: ``litho_layer`` stores intervals to the millimetre."""


GROWABLE_FRACTION_OF_MINIMUM = 0.5
"""How thin a band may be and still be GROWN to the minimum rather than merged.

A band the compression thinned is worth keeping at the minimum: his B4's basal
clay lost the KLEI 22 top both neighbours read because the mapped band was
0.22 m against a 0.35 m minimum (2026-08-17).  A hairline is not — growing a
2 cm reading to 35 cm invents seventeen times the thickness it was measured
over, which is a worse lie than dropping it.

Half the minimum is the cut: at or above it the band was substantially there;
below it, it was an artefact of squeezing a donor into a thin unit.  ⚠ The
fraction is not the owner's number and has not been ruled on.
"""


def layer_donor_picks(
    correlated: Sequence[BodyLayerPick],
    body_picks: Sequence[BodyLayerPick],
    *,
    own_soil_code: str | None,
    soil_by_formation: Mapping[str, str | None],
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
    the columns sharing its body.  Two constraints are hard.  A donor must be
    the SAME SOIL — his litho ties may legitimately cross facies, but a packing
    class belongs to a soil column, and a silt donor on a sand layer would put
    a SILT class inside a ZAND unit (Data Integrity Rule 3).  And a donor must
    be close enough to be evidence at all.

    Parameters
    ----------
    correlated : Sequence[BodyLayerPick]
        Layers this one is tied to by an approved litho correlation.
    body_picks : Sequence[BodyLayerPick]
        Layers sharing this one's litho body, whatever geological band.
    own_soil_code : str | None
        The borehole layer's soil; ``None`` admits nothing, because without it
        the soil cannot be checked at all.
    soil_by_formation : Mapping[str, str | None]
        Soil code per litho formation. Compared by SOIL rather than by
        formation identity: two columns can carry different formation rows of
        the same soil, and refusing those would strand a borehole with no
        donor at all.
    layer_top_elev_m, layer_base_elev_m : float
        The borehole layer's extent in elevation, top above base.
    flanking_investigations : set[str]
        Accepted for the caller's bookkeeping and deliberately NOT used as a
        filter.  Owner ruling, 2026-08-17: *"donor reach is obsolete, only left
        and right test on section can be donor"* — which
        ``select_flank_donors`` already implements downstream, picking the
        nearest candidate each side.  Filtering the POOL to the geometrically
        adjacent tests instead was measured on his model and starves it: the
        flanking test usually does not carry the unit's soil, and donor-backed
        bands fell from 118 to 37 with two thirds of the model dropping to a
        floor. So the pool stays "every column carrying this soil in this body"
        and the flanking rule chooses between them.

    Returns
    -------
    list[BodyLayerPick]
        At most one layer per column — a body split by an enclosed lens owns
        several, and only elevation says which is the same sheet.
    """
    by_investigation: dict[str, list[BodyLayerPick]] = defaultdict(list)
    tied_columns: set[str] = set()
    for pick in correlated:
        if own_soil_code is None or soil_by_formation.get(pick.formation_id) != own_soil_code:
            continue
        by_investigation[pick.investigation_id].append(pick)
        tied_columns.add(pick.investigation_id)
    for pick in body_picks:
        # The tie already said WHICH of that column's layers this one
        # continues; the body must not offer a second.
        if pick.investigation_id in tied_columns:
            continue
        if own_soil_code is None or soil_by_formation.get(pick.formation_id) != own_soil_code:
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


_UNRESOLVED_SOURCES = frozenset({"body_min", "absolute_min"})
"""Provenance tags meaning "no column spoke for this band".

``body_min`` is the weakest class observed anywhere in the body, ``absolute_min``
the NAD table's floor for the soil — both are guesses made when the donor rule
came back empty, not readings.
"""

COLUMN_MIN_SOURCE = "column_min"
"""Provenance for a band raised to the loosest class its own column measured."""


def apply_column_floor(
    bands: Sequence[PlannedBand],
    *,
    soil_of_formation: Mapping[str, str | None],
) -> list[PlannedBand]:
    """Raise an unanswered band to the loosest class ITS COLUMN measured.

    Owner, 2026-08-16: *"when the fallback fires, there is already a sand
    beneath it that does have a higher NAD class.  So we take that NAD class as
    the lowest on the column ... the upper bands which fall back to the lowest
    class will get medium instead of loose."*

    The NAD table's floor is not the conservative answer, it is a fictional
    one.  A LOOSE sand band dropped into a column whose every measured sand
    reads medium dense or better is a layer the site shows nowhere on that
    column, and packing density feeds strength — so inventing one can drive a
    design on data that does not exist.  What the column itself measured for
    that soil is the honest floor.

    Runs AFTER the donor rule has answered everything it can, across all of a
    borehole's segments, because it reads those answers.

    Parameters
    ----------
    bands : Sequence[PlannedBand]
        Every band planned for ONE borehole, any order.
    soil_of_formation : Mapping[str, str | None]
        Soil code per litho formation id — a sand band's floor must come from
        sand, never from the clay next to it.

    Returns
    -------
    list[PlannedBand]
        The bands in the given order.  An unanswered band whose soil the column
        did measure is replaced by a copy at that soil's loosest measured class,
        stamped :data:`COLUMN_MIN_SOURCE`, still at ``low`` confidence — the
        interval was not read, and the badge must keep saying so.  Never lowers
        a class: a standing sub-minimum sliver (his ruling of 2026-08-11) keeps
        its own conservative value.
    """
    loosest_measured: dict[str, int] = {}
    for band in bands:
        if band.source in _UNRESOLVED_SOURCES:
            continue
        soil = soil_of_formation.get(str(band.source_litho_formation_id))
        if soil is None:
            continue
        held = loosest_measured.get(soil)
        if held is None or band.nad_class < held:
            loosest_measured[soil] = band.nad_class

    out: list[PlannedBand] = []
    for band in bands:
        soil = soil_of_formation.get(str(band.source_litho_formation_id))
        floor = loosest_measured.get(soil) if soil is not None else None
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


_WEAKEST_FIRST = ("absolute_min", "body_min", "column_min", "layer_inherited")
"""Provenance tags ordered weakest-first, for a merge that must not upgrade."""


def merge_geo_split_bands(bands: Sequence[PlannedBand]) -> list[PlannedBand]:
    """Undo a geological cut that split a packing band of unchanged class.

    Owner, 2026-08-17: *"we're still emitting geotech bands to the geological
    boundary that was split off, that's the user's decision"*.  He has the
    gesture for it — right-click a band → "Split band…", and "Link to geology"
    to couple the boundary — so the engine making that split for him is
    unasked-for surface.

    Where it came from: ``divide_picks_by_geology`` cuts every litho pick at the
    geological surfaces BEFORE any packing is derived, so each piece is
    classified on its own and can land on the same class.  His B4 carried
    ``0.00-0.60 SILT (NAD 13)`` over ``0.60-5.19 SILT (NAD 13)`` — a contact
    marking no packing change — and each piece then earned its own correlation,
    which is how one litho tie became two geotech ties on one contact.

    Merged only when the class AND the litho unit are the same and the two
    bands touch: the litho model owns its own boundaries whatever the classes
    are, and a gap is a different defect than a cut.

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
        never claims evidence for ground no donor answered.
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


@dataclass(frozen=True)
class UnitTiePlacement:
    """One litho unit's bands on a borehole, laid from the ties.

    Parameters
    ----------
    bands : list[FillBand]
        The bands, tiling the borehole's own unit extent.
    correspondences : list[tuple[str, ...]]
        Per band, the ``litho_layer`` ids it continues — both columns' where a
        tie declared the boundary, one where a lens or onlap did.
    replaced_tie_layer_pairs : list[tuple[str, str]]
        The ``(left band, right band)`` pairs whose tie was re-expressed here,
        and which the caller therefore deletes (owner, 2026-08-16: *"then you
        delete all the bands you checked and replaced by hops"*).
    section_name : str
        The section the bracket was read on.
    gap_width_m : float
        Along-distance between the two bracketing CPTs.
    """

    bands: list[FillBand]
    correspondences: list[tuple[str, ...]]
    replaced_tie_layer_pairs: list[tuple[str, str]]
    section_name: str
    gap_width_m: float


@dataclass(frozen=True)
class GeometrySampling:
    """What a borehole's vertical line read out of the section partition.

    Parameters
    ----------
    bands : list[FillBand]
        The bands, already rescaled into the borehole's own litho extent.
    correspondences : list[tuple[str, ...]]
        Per band, the ``litho_layer`` ids of the region it was cut from — the
        tie endpoints the column earns by standing there. Same order and length
        as ``bands``.
    section_id, section_name : str
        The section whose partition was read.
    left_investigation_id, right_investigation_id : str
        The two columns bracketing the borehole in that partition.
    gap_width_m : float
        Along-distance between them; the tightest bracket wins when several
        sections draw this borehole.
    """

    bands: list[FillBand]
    correspondences: list[tuple[str, ...]]
    section_id: str
    section_name: str
    left_investigation_id: str
    right_investigation_id: str
    gap_width_m: float


@dataclass(frozen=True)
class PlannedBoreholeSegment:
    """One borehole's planned bands **within one body group**.

    A borehole that spans several litho bodies produces one segment per body
    group, in the order :class:`DivideBoreholes` iterates them.  Keeping the
    segments flat (rather than pre-aggregating per borehole) is what makes the
    commit's write order identical to the plan's order.

    Parameters
    ----------
    borehole_id : UUID
        The borehole these bands sit on.
    investigation_id : str
        ``str(borehole_id)`` — the key used by the per-investigation layer index.
    bands : tuple[PlannedBand, ...]
        The bands, top to bottom.
    """

    borehole_id: UUID
    investigation_id: str
    bands: tuple[PlannedBand, ...]


@dataclass(frozen=True)
class PlannedBoreholeColumn:
    """Every planned band on one borehole, across all of its body groups.

    The shape the preview endpoint reports: the engineer thinks in columns, not
    in body groups.

    Parameters
    ----------
    borehole_id : UUID
        The borehole.
    name : str
        The borehole's display name (falls back to the id when the row is gone).
    bands : tuple[PlannedBand, ...]
        All planned bands on the column, sorted by ``depth_top_m``.
    """

    borehole_id: UUID
    name: str
    bands: tuple[PlannedBand, ...]


@dataclass(frozen=True)
class DivideBoreholePlan:
    """What :class:`DivideBoreholes` would write, computed without writing it.

    Produced by :meth:`DivideBoreholes.plan` and consumed by BOTH
    :meth:`DivideBoreholes.execute` (which persists it) and the preview
    endpoint (which reports it).  There is exactly one planner, so the ghost
    bands the engineer sees before pressing the button are the rows the button
    writes — a divergence between the two would be indistinguishable from the
    machine lying about the geology.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotech child model the bands belong to.
    segments : tuple[PlannedBoreholeSegment, ...]
        Per (body group, borehole) planned bands, in write order.
    divided_borehole_count : int
        Segments that received ≥ 2 bands.
    single_band_borehole_count : int
        Segments that received exactly 1 band.
    layer_count : int
        Total bands across all segments — the ``litho_layer`` rows a commit
        would insert.
    pick_count : int
        Litho body picks the plan was built from.  ``0`` means there is no
        litho model content at all, and the commit short-circuits.
    cpt_layer_index : dict
        ALL CPT geotech layers keyed by investigation id string, as
        ``(top, base, layer_id, formation_id, nad_class, body_id)``.  Carried
        on the plan because the commit's tie re-anchor and edge derivation both
        need it and re-reading it would be a second source of truth.
    borehole_names : dict[str, str]
        Borehole id (stringified) → display name, for the preview payload.
    """

    geotech_model_id: UUID
    segments: tuple[PlannedBoreholeSegment, ...]
    divided_borehole_count: int
    single_band_borehole_count: int
    layer_count: int
    pick_count: int
    cpt_layer_index: dict[str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]]
    borehole_names: dict[str, str]
    # (left band, right band) per tie the tie-driven placement re-expressed
    # on a borehole. The commit deletes them once the hops are written
    # (owner 2026-08-16: "then you delete all the bands you checked and
    # replaced by hops"). Defaulted so the empty-plan early return and every
    # existing construction site stay valid.
    replaced_tie_layer_pairs: tuple[tuple[str, str], ...] = ()

    def columns(self) -> list[PlannedBoreholeColumn]:
        """Aggregate the flat segments into one entry per borehole column.

        Returns
        -------
        list[PlannedBoreholeColumn]
            One column per borehole that received at least one band, in first-
            seen order, each with its bands sorted top to bottom.
        """
        by_borehole: dict[str, list[PlannedBand]] = {}
        order: list[str] = []
        for segment in self.segments:
            if segment.investigation_id not in by_borehole:
                by_borehole[segment.investigation_id] = []
                order.append(segment.investigation_id)
            by_borehole[segment.investigation_id].extend(segment.bands)
        return [
            PlannedBoreholeColumn(
                borehole_id=UUID(inv_id),
                name=self.borehole_names.get(inv_id, inv_id),
                bands=tuple(sorted(by_borehole[inv_id], key=lambda b: b.depth_top_m)),
            )
            for inv_id in order
        ]


@dataclass(frozen=True)
class DivideBoreholeResult:
    """Result of :class:`DivideBoreholes`.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotech model that was updated.
    divided_borehole_count : int
        Number of borehole columns that received ≥ 2 packing bands from
        ``fill_borehole_litho_body_extent``.
    single_band_borehole_count : int
        Number of borehole columns that received exactly 1 band (no CPT split
        surfaces existed or all splits were clamped out).
    layer_count : int
        Total ``litho_layer`` rows inserted for boreholes in this call.
    created_formation_ids : list[UUID]
        Newly created geotech ``geological_formation`` rows (find-or-create;
        a re-run only lists rows not already in the DB).
    reanchored_tie_count : int
        Accepted packing ties that touched a borehole column and were carried
        onto the rebuilt bands.  Includes the ones counted in
        ``review_tie_reasons`` — those are carried, just flagged.
    review_tie_reasons : dict[str, int]
        Carried ties the engineer has to confirm, per reason:
        ``class_changed`` (the qc re-derived a different packing class over
        those depths) or ``ambiguous_band`` (several same-class bands overlap
        where the old one was, so which inherited the tie is unknowable).
    lost_tie_count : int
        Accepted ties that touched a borehole column and could NOT be carried
        — the rebuild draws nothing where they were anchored.
    lost_tie_reasons : dict[str, int]
        Per-reason breakdown of ``lost_tie_count``.
    lost_tie_labels : list[str]
        One line per lost tie naming BOTH investigations and the depth of each
        endpoint (``"GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m"``).  The
        count alone tells the engineer that accepted work vanished and nothing
        about WHERE to redraw it (audit 2026-08-02).
    superseded_jump_tie_count : int
        Bridged CPT↔CPT jump ties deleted because the borehole-mediated chain
        now carries the same connection (owner ruling 2026-08-14: the chain
        REPLACES the jump tie — hand-drawn or machine, accepted or pending).
    crossing_tie_count : int
        MACHINE ties deleted because they crossed another tie in the same gap
        (owner ruling 2026-08-17: *"ties shouldn't be able to cross"*).  Legacy
        rows from an older derivation: the guard refuses a crossing candidate at
        emit time, so nothing this pass writes can add to this count.  Hand-drawn
        ties are never deleted — *"user made ties should be left alone"*.
    """

    geotech_model_id: UUID
    divided_borehole_count: int
    single_band_borehole_count: int
    layer_count: int
    created_formation_ids: list[UUID] = field(default_factory=list)
    reanchored_tie_count: int = 0
    review_tie_reasons: dict[str, int] = field(default_factory=dict)
    lost_tie_count: int = 0
    lost_tie_reasons: dict[str, int] = field(default_factory=dict)
    lost_tie_labels: list[str] = field(default_factory=list)
    superseded_jump_tie_count: int = 0
    crossing_tie_count: int = 0


class DivideBoreholes(GeotechBoreholeMaterialiser):
    """Fill borehole columns in an existing geotech model, litho-confined.

    For each borehole, for each litho body it belongs to: reads the CPT
    geotech layers already in the geotech model (written by SAB), restricts
    them to the CPT's own litho-body extent (same-lithology clip), TIN-
    interpolates the packing transitions at the borehole XY, and fills the
    borehole's litho-body extent using
    :func:`~groundmodel.domain.services.borehole_packing_fill.fill_borehole_litho_body_extent`.
    Gaps in CPT coverage are filled conservatively with ``body_min`` or
    ``absolute_min`` bands.

    The operation is idempotent: prior borehole geotech layers are deleted
    before new ones are written.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__, session)

    async def _scoped_borehole_ids(
        self,
        *,
        project_id: UUID,
        section_id: UUID | None,
        borehole_ids: set[UUID] | None,
    ) -> set[UUID] | None:
        """Fold a ``section_id`` scope into the ``borehole_ids`` subset.

        Owner ruling 2026-08-15, reading the pipeline menu after steps 1-3 were
        scoped: *"i'm reading divide boreholes (whole model), no that should
        also be section scoped"*.  Rather than a second scoping mechanism, a
        section resolves to ITS member boreholes and drives the subset path
        that already exists — which scopes the delete, seeds the layer index
        with the columns it leaves alone, and restricts the tie capture.

        A borehole that projects onto TWO sections is divided by either
        section's press, and that is correct: its bands come from its own
        donors and its body membership, not from the section it is being viewed
        on, so both presses produce the same rows for it.

        Parameters
        ----------
        project_id : UUID
            Owning project — membership is resolved within it.
        section_id : UUID | None
            The section being divided; ``None`` leaves *borehole_ids* alone.
        borehole_ids : set[UUID] | None
            A caller-named subset, or ``None`` for "every borehole".

        Returns
        -------
        set[UUID] | None
            The effective subset.  ``None`` only when no scope was asked for at
            all.  An EMPTY set is a real answer — a section with no borehole on
            it divides nothing, which is not the same as dividing everything.
        """
        if section_id is None:
            return borehole_ids
        members = await load_section_member_investigation_ids(
            self._session, project_id=project_id, section_id=section_id
        )
        # The membership set mixes CPTs and boreholes; only the boreholes are
        # this verb's business.
        section_boreholes: set[UUID] = (
            set(
                (
                    await self._session.execute(
                        select(BoreholeOrm.id).where(BoreholeOrm.id.in_(members))
                    )
                )
                .scalars()
                .all()
            )
            if members
            else set()
        )
        scoped = section_boreholes if borehole_ids is None else borehole_ids & section_boreholes
        self.info(
            f"DivideBoreholes: section {section_id} scopes the run to "
            f"{len(scoped)} borehole(s) of {len(section_boreholes)} on it"
        )
        return scoped

    async def plan(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        borehole_ids: set[UUID] | None = None,
        section_id: UUID | None = None,
        section_partitions: Mapping[UUID, SectionPartitionInput] | None = None,
    ) -> DivideBoreholePlan:
        """Compute every band this verb would write, WITHOUT writing anything.

        This is the whole engine up to (and excluding) the delete / insert /
        tie-re-anchor mutations: it loads the litho picks, geo-bounds them,
        groups them, reads the CPT geotech layers and the sections' column
        order, borrows each borehole's packing from the CPTs flanking it on a
        section, and assigns each resulting band its NAD class, provenance and
        geotech body.

        :meth:`execute` calls this and persists the result verbatim, and the
        preview endpoint calls it and reports the result.  There is deliberately
        no second implementation: a preview that ran its own copy of the rules
        could tell the engineer one thing and commit another, which on this
        feature is the worst failure available.

        Only ``SELECT``\\ s are issued, so a caller that never commits leaves the
        database untouched.

        Parameters
        ----------
        project_id : UUID
            Owning project id (used for scope guards and formation queries).
        litho_model_id : UUID
            The lithostratigraphic model whose geotech child model holds the
            CPT geotech layers.
        borehole_ids : set[UUID] | None
            Restrict the plan to these borehole columns.  ``None`` (the
            default) plans every borehole in the model — exactly today's
            semantics.  A subset is what lets the engineer accept the ghost
            bands on one borehole at a time instead of all-or-nothing.
        section_id : UUID | None
            Restrict the plan to ONE section's member boreholes (owner ruling
            2026-08-15).  Resolved into *borehole_ids* — see
            :meth:`_scoped_borehole_ids` — so the preview and the commit are
            scoped by the identical mechanism and cannot drift.

        Returns
        -------
        DivideBoreholePlan
            The planned bands per (body group, borehole), the summary counts,
            and the CPT layer index the commit re-uses.

        Raises
        ------
        HTTPException
            404 when the litho model or geotech model does not exist.
        """
        borehole_ids = await self._scoped_borehole_ids(
            project_id=project_id, section_id=section_id, borehole_ids=borehole_ids
        )
        self.info(
            f"DivideBoreholes.plan: project={project_id} litho_model={litho_model_id} "
            f"boreholes={'ALL' if borehole_ids is None else sorted(str(b) for b in borehole_ids)}"
        )

        # Phase 1 — load and validate litho model.
        litho_model = await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            litho_model_id,
            project_id,
            label="Litho model",
        )

        # Phase 2 — locate the geotech child model (must already exist).
        geotech_model = (
            (
                await self._session.execute(
                    select(GeologicalModelOrm).where(
                        GeologicalModelOrm.parent_model_id == litho_model.id,
                        GeologicalModelOrm.kind == "geotechnical",
                    )
                )
            )
            .scalars()
            .first()
        )
        if geotech_model is None:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=404,
                detail={
                    "code": "geotech_model_not_found",
                    "message": (
                        f"No geotechnical model exists for litho model {litho_model_id}. "
                        "Run 'Subdivide all bodies' first."
                    ),
                },
            )
        self.info(f"DivideBoreholes: geotech_model={geotech_model.id}")

        # The sampled region names a geotech formation; turning it into a band
        # needs that formation's class and its find-or-create key. Loaded once
        # here rather than per borehole — the geometry path reads it for every
        # cut it makes.
        # The ties the tie-driven placement re-expressed on a borehole, as
        # (left band, right band). Deleted after the hops are written -
        # owner 2026-08-16: "then you delete all the bands you checked and
        # replaced by hops".
        replaced_tie_pairs: list[tuple[str, str]] = []
        geotech_formation_info: dict[str, tuple[int | None, UUID, UUID | None]] = {}
        if section_partitions:
            for formation_row in (
                await self._session.execute(
                    select(
                        GeologicalFormationOrm.id,
                        GeologicalFormationOrm.nad_class,
                        GeologicalFormationOrm.source_litho_formation_id,
                        GeologicalFormationOrm.source_geo_formation_id,
                    ).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.source_litho_formation_id.is_not(None),
                    )
                )
            ).all():
                geotech_formation_info[str(formation_row.id)] = (
                    formation_row.nad_class,
                    formation_row.source_litho_formation_id,
                    formation_row.source_geo_formation_id,
                )
            self.info(
                f"DivideBoreholes: section geometry supplied for "
                f"{len(section_partitions)} section(s); "
                f"{len(geotech_formation_info)} geotech formation(s) indexed"
            )

        # Phase 3 — load litho body picks, keep only the ones on a section, and
        # geo-bound them.
        #
        # The membership rule (owner ruling 2026-08-15) applies here for the
        # same reason it applies to the subdivide: a borehole that projects
        # onto no cross-section cannot be drawn, correlated or corrected, so
        # bands written on it are unreachable. Verified 2026-08-15 that this
        # guard is NOT redundant — before it, an off-section borehole sharing a
        # body with an on-section CPT was filled from that CPT's transition
        # surfaces and entered the model.
        all_picks = await self._litho_repo.load_body_picks(litho_model_id)
        members = await load_section_member_investigation_ids(self._session, project_id=project_id)
        picks = [pick for pick in all_picks if UUID(pick.investigation_id) in members]
        off_section_ids = {UUID(pick.investigation_id) for pick in all_picks} - members
        if off_section_ids:
            names = await load_investigation_names(self._session, off_section_ids)
            self.info(
                f"DivideBoreholes: {len(off_section_ids)} interpreted column(s) skipped — "
                f"they project onto no cross-section: "
                f"{', '.join(sorted(names.get(i, str(i)) for i in off_section_ids))}"
            )
        self.info(
            f"DivideBoreholes: {len(picks)} pick(s) on section "
            f"(of {len(all_picks)} in the litho model)"
        )
        if not picks:
            self.warning("DivideBoreholes: no litho picks found — no borehole bands to materialise")
            return DivideBoreholePlan(
                geotech_model_id=geotech_model.id,
                segments=(),
                divided_borehole_count=0,
                single_band_borehole_count=0,
                layer_count=0,
                pick_count=0,
                cpt_layer_index={},
                borehole_names={},
            )

        snap_tol = await self._read_geotech_snap_tolerance_m(project_id)
        min_thickness_m = await read_geotech_min_thickness_m(self._session, project_id)
        geo_surfaces = await self._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        boundary_sampler = self._make_boundary_sampler(geo_surfaces)
        lowest_sampler = self._make_lowest_boundary_sampler(geo_surfaces)

        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        divided = divide_picks_by_geology(shallow.picks, boundary_sampler, snap_tol)
        self.debug(f"DivideBoreholes: {len(divided)} geo-bounded segment(s)")

        # Phase 4 — group by (body_id, source_geo_formation_id).
        groups = await self._group_segments(divided, geo_surfaces)

        # The engineer's own litho correlations. Donors are grouped by (body,
        # geological band), and a geological contact can put the two ends of
        # one hand-drawn tie in different groups — which is how the owner's B4
        # ended up taking loose sand from a CPT 777 m away while the two medium
        # dense columns he had tied it to sat one gap either side. A tie
        # outranks a grouping the engine derived.
        plan_litho_depths = await load_litho_layer_depths(self._session, litho_model_id, None)
        partner_rows = (
            await self._session.execute(
                text(
                    """
                    SELECT ed.layer_a_id, ed.layer_b_id
                    FROM litho_contact_correlation_edge ed
                    WHERE ed.model_id = :model_id AND ed.user_approved IS TRUE
                    """
                ),
                {"model_id": litho_model_id},
            )
        ).all()
        partner_sets: dict[UUID, set[UUID]] = defaultdict(set)
        for partner_row in partner_rows:
            partner_sets[partner_row.layer_a_id].add(partner_row.layer_b_id)
            partner_sets[partner_row.layer_b_id].add(partner_row.layer_a_id)
        partners_by_layer = {k: frozenset(v) for k, v in partner_sets.items()}

        layers_by_investigation: dict[str, list[tuple[UUID, float, float]]] = defaultdict(list)
        for plan_layer_id, (plan_inv, plan_top, plan_base) in plan_litho_depths.items():
            layers_by_investigation[plan_inv].append((plan_layer_id, plan_top, plan_base))
        # A pick is a GEO-BOUNDED slice of a litho layer, so one layer owns
        # several; all of them are lent, and the flank rule chooses between
        # them by elevation overlap.
        layer_picks_by_layer: dict[UUID, list[BodyLayerPick]] = defaultdict(list)
        for group_pick in shallow.picks:
            if True:
                owner_layer = next(
                    (
                        plan_layer_id
                        for plan_layer_id, plan_top, plan_base in layers_by_investigation.get(
                            group_pick.investigation_id, []
                        )
                        if plan_top <= group_pick.top_depth_m + _DEPTH_TOL_M
                        and plan_base >= group_pick.base_depth_m - _DEPTH_TOL_M
                    ),
                    None,
                )
                if owner_layer is not None:
                    layer_picks_by_layer[owner_layer].append(group_pick)
        self.info(f"DivideBoreholes: {len(groups)} body group(s)")

        # Phase 5 — classify each investigation as borehole or CPT.
        all_inv_ids = {UUID(s.investigation_id) for segs in groups.values() for s in segs}
        anchor_kind = await self._resolve_anchor_kinds(all_inv_ids)

        # Phase 6 — load all CPT geotech layers from the geotech model.
        # body_id is included so each CPT band's geotech connected-component
        # identity is available for borehole band assignment (Task B).  SAB
        # runs ResolveLithoInstances (Phase 10) before committing, so every
        # CPT band already has its body_id stamped when DivideBoreholes reads it.
        cpt_layer_rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    LithoLayerOrm.id,
                    LithoLayerOrm.formation_id,
                    GeologicalFormationOrm.nad_class,
                    LithoLayerOrm.body_id,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(
                    LithoLayerOrm.model_id == geotech_model.id,
                    LithoLayerOrm.cpt_id.is_not(None),
                )
                .order_by(LithoLayerOrm.cpt_id, LithoLayerOrm.depth_top_m)
            )
        ).all()
        self.info(f"DivideBoreholes: {len(cpt_layer_rows)} CPT geotech layer(s) found in model")
        if len(cpt_layer_rows) == 0:
            self.warning(
                "DivideBoreholes: 0 CPT geotech layers in model — every borehole band will fall "
                "to the conservative litho-floor (absolute_min) fallback with no geotech body_id. "
                "Run SubdivideAllBodies first."
            )

        # geotech_layer_by_inv_depth: ALL geotech layers for every CPT across
        # ALL body groups.  6-tuple: (top, base, layer_id, formation_id,
        # nad_class, geotech_body_id).  The litho-confined filter (see
        # _plan_borehole_bands_litho_confined) restricts each CPT's
        # contribution to the depth range of the CPT's litho-body extent for
        # the current group.  geotech_body_id is the resolver-stamped body_id
        # from SAB, used by assign_borehole_band_body to pick the correct
        # geotech body for each borehole fill band.
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ] = defaultdict(list)
        for row in cpt_layer_rows:
            inv_str = str(row.cpt_id)
            geotech_layer_by_inv_depth[inv_str].append(
                (
                    row.depth_top_m,
                    row.depth_base_m,
                    row.id,
                    row.formation_id,
                    row.nad_class,
                    row.body_id,
                )
            )

        # CPT location + name lookup — the donor's map distance and the name the
        # provenance reports.
        cpt_ids_in_model = {row.cpt_id for row in cpt_layer_rows}
        cpt_xy: dict[UUID, tuple[float, float, float]] = {}
        cpt_names: dict[UUID, str] = {}
        if cpt_ids_in_model:
            from groundmodel.infrastructure.db.models.cpt_orm import CptOrm

            cpt_rows = (
                await self._session.execute(
                    select(
                        CptOrm.id,
                        CptOrm.name,
                        CptOrm.location_x,
                        CptOrm.location_y,
                        CptOrm.elevation_m,
                    ).where(CptOrm.id.in_(cpt_ids_in_model))
                )
            ).all()
            for cr in cpt_rows:
                cpt_xy[cr.id] = (cr.location_x, cr.location_y, cr.elevation_m or 0.0)
                cpt_names[cr.id] = cr.name

        # Phase 7 — where "left" and "right" are defined.
        #
        # The owner's rule is about the CROSS SECTION, so the along-positions of
        # every column on every section are loaded once here rather than
        # per-borehole: the same maps serve every body group below.
        section_placements = await self._load_section_placements(project_id)

        # Phase 7b — the engineer's ACCEPTED packing ties between two CPT bands.
        #
        # A tie whose span crosses a borehole's column outranks the flanking
        # guess: the engineer has said, in the model, that this band over here
        # IS that band over there (owner ruling 2026-08-04).  Proposals are
        # deliberately not loaded — an unaccepted tie is the machine's guess and
        # carries no more authority than the flanking rule's own.
        accepted_ties = self._accepted_cpt_ties(
            await self._load_accepted_tie_rows(geotech_model.id),
            layer_to_investigation={
                row.id: str(row.cpt_id) for row in cpt_layer_rows if row.cpt_id is not None
            },
        )
        self.info(
            f"DivideBoreholes: {len(accepted_ties)} accepted CPT↔CPT packing tie(s) "
            f"available to inform donor selection"
        )

        # Owner's step 1, 2026-08-16, with his own guard: a tie whose surface is
        # the BASE CONTACT OF ONE SHARED litho unit is already on every borehole
        # between the two columns — the litho log carries it — so dividing them
        # re-expresses it and it is deleted with the rest.
        #
        # His framing is what makes this findable: read the unit ABOVE, not the
        # bands the tie names. His S13 KLEI ↔ S6 ZAND tie looks cross-facies
        # from the bands, and its two bands live in different body groups so the
        # per-unit placement never sees the pair — but one silt body sits on
        # both columns and the tie declares its base.
        plan_litho_depths = await load_litho_layer_depths(self._session, litho_model.id, None)
        litho_body_by_layer = {
            row.id: (str(row.body_id) if row.body_id is not None else None)
            for row in (
                await self._session.execute(
                    select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                        LithoLayerOrm.model_id == litho_model.id
                    )
                )
            ).all()
        }
        borehole_id_strings = {
            inv
            for placement in section_placements
            for inv in placement.along_m
            if inv not in geotech_layer_by_inv_depth
        }
        for placement in section_placements:
            replaced_tie_pairs.extend(
                litho_contact_tie_pairs(
                    [t for t in accepted_ties if t.section_id == placement.section_id],
                    geotech_layer_by_inv_depth,
                    plan_litho_depths,
                    litho_body_by_layer,
                    placement.along_m,
                    borehole_id_strings,
                )
            )

        # The donor pool, at LITHO-LAYER extent and with the geological banding
        # deliberately ignored.
        #
        # Candidates used to be the CPTs in the borehole's own (body,
        # geological band) group, which is the wrong unit twice over: a
        # geological contact can put the two ends of one hand-drawn correlation
        # in different groups, and it can leave a group with no column near
        # enough to say anything. The owner met both on B4 — a band he had tied
        # to two medium dense columns 90 m away took LOOSE sand from a CPT
        # 777 m away, because that CPT was the only member of the group.
        #
        # The litho layer is what owns a borehole's packing, so the layer names
        # its own donors: the columns its correlations point at, else the
        # columns sharing its body that overlap it in elevation and stand close
        # enough to be evidence.
        litho_soil_by_formation: dict[str, str | None] = {
            str(formation_row.id): formation_row.litho_main_soil_code
            for formation_row in (
                await self._session.execute(
                    select(
                        GeologicalFormationOrm.id,
                        GeologicalFormationOrm.litho_main_soil_code,
                    )
                )
            ).all()
        }
        # The columns immediately left and right of each borehole, unioned over
        # every section it appears on. Owner ruling, 2026-08-17: only these may
        # donate, so adjacency replaces the old distance cap outright.
        flanking_by_borehole: dict[str, set[str]] = defaultdict(set)
        for flank_placement in section_placements:
            in_order = sorted(flank_placement.along_m.items(), key=lambda item: item[1])
            for position, (inv_here, _along_here) in enumerate(in_order):
                if anchor_kind.get(inv_here) != "borehole":
                    continue
                # The nearest TEST each side, walking past other boreholes: a
                # borehole has no qc and cannot donate packing, so stopping at
                # one would leave the unit with no donor at all (measured
                # 2026-08-17: donor-backed bands fell 118 -> 33).
                for step in (-1, 1):
                    probe = position + step
                    while 0 <= probe < len(in_order):
                        candidate_inv = in_order[probe][0]
                        if anchor_kind.get(candidate_inv) == "cpt":
                            flanking_by_borehole[inv_here].add(candidate_inv)
                            break
                        probe += step

        cpt_layer_picks_by_body: dict[str, list[BodyLayerPick]] = defaultdict(list)
        for pool_pick in shallow.picks:
            if anchor_kind.get(pool_pick.investigation_id) == "cpt":
                cpt_layer_picks_by_body[pool_pick.body_id].append(pool_pick)

        # Phase 8 (planning half) — litho-confined borehole fill per body group.
        #
        # Nothing below writes.  The delete of the PRIOR borehole bands lives in
        # ``execute`` and deliberately does not run here: the plan does not read
        # them.  Its inputs are the litho picks, the geological surfaces and the
        # CPT geotech layers, none of which the delete touches, so planning
        # before or after the delete yields byte-identical bands.
        planned_segments: list[PlannedBoreholeSegment] = []
        borehole_names: dict[str, str] = {}
        total_layers = 0
        divided_borehole_count = 0
        single_band_borehole_count = 0

        for (body_id_str, source_geo_fid), group_segs in groups.items():
            source_litho_fid = UUID(group_segs[0].formation_id) if group_segs else uuid7()

            borehole_segs = [
                s
                for s in group_segs
                if anchor_kind.get(s.investigation_id) == "borehole"
                # A subset run leaves every other borehole exactly as it is —
                # planned, deleted and written are all filtered by this one set.
                and (borehole_ids is None or UUID(s.investigation_id) in borehole_ids)
            ]
            if not borehole_segs:
                continue

            cpt_segs = [s for s in group_segs if anchor_kind.get(s.investigation_id) == "cpt"]

            # Load borehole XY (+ name, which only the preview payload reads).
            bh_ids = {UUID(s.investigation_id) for s in borehole_segs}
            bh_rows = (
                await self._session.execute(
                    select(
                        BoreholeOrm.id,
                        BoreholeOrm.name,
                        BoreholeOrm.location_x,
                        BoreholeOrm.location_y,
                        BoreholeOrm.elevation_m,
                    ).where(BoreholeOrm.id.in_(bh_ids))
                )
            ).all()
            bh_xy: dict[UUID, tuple[float, float, float]] = {
                br.id: (br.location_x, br.location_y, br.elevation_m or 0.0) for br in bh_rows
            }
            for br in bh_rows:
                borehole_names[str(br.id)] = br.name

            # Load the litho formation's soil code once per group (drives the
            # absolute-min fallback and is cached in SQLAlchemy's identity map).
            source_litho_orm = await self._session.get(GeologicalFormationOrm, source_litho_fid)
            soil_code: str | None = (
                source_litho_orm.litho_main_soil_code if source_litho_orm is not None else None
            )
            # Variant-aware floor (audit F19): a silthoudend zand floors to the
            # SECONDARY column's loosest class (9), not the clean one (5) —
            # derived from the classifier's own table + variant rule, so the
            # fallback and the classifier can never disagree about columns.
            unit_admixtures = (
                _parse_admixtures(source_litho_orm) if source_litho_orm is not None else ()
            )
            litho_abs_min_class = (
                loosest_class_for(soil_code, unit_admixtures) if soil_code else None
            )
            if litho_abs_min_class is None:
                # Cannot determine the lithology floor for an unknown soil code.
                # SKIP this group's borehole fill rather than default to a
                # specific lithology (a ZAND-5 floor stamped on a KLEI/VEEN body
                # would violate the very litho-class invariant this fill enforces
                # — Data Integrity Rule 3). Real DOV formations always carry one
                # of the five families; this guards a malformed/manual formation.
                self.warning(
                    f"DivideBoreholes: formation {source_litho_fid} has "
                    f"soil_code={soil_code!r} has no NAD column (loosest_class_for) — "
                    "skipping this group's borehole fill (no lithology floor)"
                )
                continue

            self.debug(
                f"DivideBoreholes: group body={body_id_str} "
                f"soil={soil_code} abs_min_nad={litho_abs_min_class} "
                f"borehole_segs={len(borehole_segs)} cpt_segs={len(cpt_segs)}"
            )

            for bh_seg in borehole_segs:
                inv_id = bh_seg.investigation_id
                inv_uuid = UUID(inv_id)
                _bh_xy_lookup = bh_xy.get(inv_uuid)
                if _bh_xy_lookup is None:
                    self.warning(
                        f"DivideBoreholes: borehole={inv_id} has no XY location in DB — "
                        "defaulting to (0,0,0); donor distances and body assignment will be wrong"
                    )
                bh_x, bh_y, bh_elev = (
                    _bh_xy_lookup if _bh_xy_lookup is not None else (0.0, 0.0, 0.0)
                )
                geo_top = bh_seg.top_depth_m
                geo_base = bh_seg.base_depth_m
                if geo_base <= geo_top:
                    continue

                # The litho layer this slice belongs to. A geological contact
                # can cut one layer into several slices, and each would
                # otherwise read the neighbouring column again and re-derive
                # its whole succession — the owner's B9 got S9's 6-8-7 sand
                # twice for exactly this reason.
                unit_layer = next(
                    (
                        (own_layer_id, layer_top, layer_base)
                        for own_layer_id, layer_top, layer_base in layers_by_investigation.get(
                            inv_id, []
                        )
                        if layer_top <= geo_top + _DEPTH_TOL_M
                        and layer_base >= geo_base - _DEPTH_TOL_M
                    ),
                    None,
                )
                # ``divide_picks_by_geology`` re-stamps body_id on the slices it
                # cuts, so the slice cannot name the litho body it came from.
                # Its layer can.
                unit_body_id = (
                    None if unit_layer is None else litho_body_by_layer.get(unit_layer[0])
                )

                # The columns this LAYER may borrow from. Correlations first —
                # a tie is the engineer's statement that two layers are the same
                # sheet, and it outranks anything the engine grouped. Where he
                # drew none, the body answers, bounded by reach.
                correlated = [
                    correlated_pick
                    for correlated_pick in correlated_donor_picks(
                        unit_top_m=geo_top,
                        unit_base_m=geo_base,
                        borehole_layers=layers_by_investigation.get(inv_id, []),
                        partners_by_layer=partners_by_layer,
                        picks_by_layer=layer_picks_by_layer,
                    )
                    if anchor_kind.get(correlated_pick.investigation_id) == "cpt"
                ]
                # A donor must be the SAME SOIL. The engineer's litho ties may
                # legitimately cross facies — his own cross-soil correlations do
                # — but a packing class belongs to a soil column, so a silt
                # donor on a sand layer would put a SILT class inside a ZAND
                # unit and break the invariant the whole fill exists to keep
                # (Data Integrity Rule 3). Body grouping used to enforce this
                # for free; naming donors by correlation does not.

                unit_cpt_segs = layer_donor_picks(
                    correlated,
                    cpt_layer_picks_by_body.get(unit_body_id or "", []),
                    own_soil_code=soil_code,
                    soil_by_formation=litho_soil_by_formation,
                    layer_top_elev_m=bh_elev - (geo_top if unit_layer is None else unit_layer[1]),
                    layer_base_elev_m=bh_elev - (geo_base if unit_layer is None else unit_layer[2]),
                    flanking_investigations=flanking_by_borehole.get(inv_id, set()),
                )

                (
                    fill_band_list,
                    fill_band_body_ids,
                    fill_band_donor_ids,
                    selection,
                ) = self._plan_borehole_bands_litho_confined(
                    inv_id=inv_id,
                    bh_x=bh_x,
                    bh_y=bh_y,
                    bh_surface_elev=bh_elev,
                    geo_top_m=geo_top,
                    geo_base_m=geo_base,
                    litho_layer_top_m=None if unit_layer is None else unit_layer[1],
                    litho_layer_base_m=None if unit_layer is None else unit_layer[2],
                    min_thickness_m=min_thickness_m,
                    cpt_segs=unit_cpt_segs,
                    litho_abs_min_class=litho_abs_min_class,
                    geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                    cpt_xy=cpt_xy,
                    cpt_names=cpt_names,
                    section_placements=section_placements,
                    accepted_ties=accepted_ties,
                    section_partitions=section_partitions,
                    geotech_formation_info=geotech_formation_info,
                    replaced_tie_pairs=replaced_tie_pairs,
                )
                n_bands = len(fill_band_list)
                total_layers += n_bands
                if n_bands >= 2:
                    divided_borehole_count += 1
                else:
                    single_band_borehole_count += 1
                band_donors = tuple(
                    BandDonor(
                        name=donor.stack.name,
                        side=donor.side,
                        along_distance_m=donor.along_distance_m,
                        map_distance_m=donor.stack.map_distance_m,
                    )
                    for donor in selection.donors
                )
                # The measure the ruling names: metres to the NEAREST donor —
                # along-section where the donor came from a flank, map distance
                # for the fallback. min() over the selection's donors.
                nearest_donor_distance_m: float | None = None
                for donor in selection.donors:
                    d = (
                        donor.along_distance_m
                        if donor.along_distance_m is not None
                        else donor.stack.map_distance_m
                    )
                    if d is not None and (
                        nearest_donor_distance_m is None or d < nearest_donor_distance_m
                    ):
                        nearest_donor_distance_m = d
                planned_segments.append(
                    PlannedBoreholeSegment(
                        borehole_id=inv_uuid,
                        investigation_id=inv_id,
                        bands=tuple(
                            PlannedBand(
                                depth_top_m=fb.top,
                                depth_base_m=fb.base,
                                nad_class=fb.nad_class,
                                source=fb.source,
                                confidence=(
                                    confidence_from_donor_distance(nearest_donor_distance_m)
                                    if fb.source == "cpt_interpolated"
                                    else "low"
                                ),
                                body_id=body_id,
                                source_litho_formation_id=source_litho_fid,
                                source_geo_formation_id=source_geo_fid,
                                # A conservative fill band came from no donor —
                                # saying otherwise would credit a CPT with a
                                # value it never read.
                                mode=(
                                    selection.mode if fb.source == "cpt_interpolated" else fb.source
                                ),
                                donors=(band_donors if fb.source == "cpt_interpolated" else ()),
                                donor_layer_ids=donor_layer_ids,
                                section_id=(
                                    selection.section_id
                                    if fb.source == "cpt_interpolated"
                                    else None
                                ),
                                section_name=(
                                    selection.section_name
                                    if fb.source == "cpt_interpolated"
                                    else None
                                ),
                            )
                            for fb, body_id, donor_layer_ids in zip(
                                fill_band_list, fill_band_body_ids, fill_band_donor_ids
                            )
                        ),
                    )
                )

        # The donor rule has now answered everything it can, so the bands it
        # could NOT answer can be honest about this column instead of about the
        # NAD table. Gathered across every segment of a borehole, because the
        # measured sand that sets a sliver's floor is usually in a different
        # body group from the sliver.
        bands_by_borehole: dict[str, list[tuple[int, int, PlannedBand]]] = defaultdict(list)
        for seg_index, planned in enumerate(planned_segments):
            for band_index, planned_band in enumerate(planned.bands):
                bands_by_borehole[planned.investigation_id].append(
                    (seg_index, band_index, planned_band)
                )

        # A geological cut that split a packing band of unchanged class is undone
        # first: the merged band is what the floor and the ties should see, and
        # the split was never a packing decision (owner, 2026-08-17 — he has the
        # "Split band…" gesture for the ones he wants).
        merged_away = 0
        for inv, entries in bands_by_borehole.items():
            merged = merge_geo_split_bands([entry[2] for entry in entries])
            if len(merged) == len(entries):
                continue
            merged_away += len(entries) - len(merged)
            # The whole borehole is rewritten into its FIRST segment: a merged
            # band spans two geological slices, so it no longer belongs to
            # either one's segment alone.
            first_seg = min(entry[0] for entry in entries)
            for seg_index in {entry[0] for entry in entries}:
                planned_segments[seg_index] = replace(
                    planned_segments[seg_index],
                    bands=tuple(merged) if seg_index == first_seg else (),
                )
            bands_by_borehole[inv] = [
                (first_seg, band_index, band) for band_index, band in enumerate(merged)
            ]
        if merged_away:
            self.info(
                f"DivideBoreholes: {merged_away} band(s) merged back — a geological "
                "contact had split a packing band whose class does not change across it"
            )

        band_updates: dict[int, dict[int, PlannedBand]] = defaultdict(dict)
        raised_count = 0
        for entries in bands_by_borehole.values():
            raised = apply_column_floor(
                [entry[2] for entry in entries],
                soil_of_formation=litho_soil_by_formation,
            )
            for (seg_index, band_index, before), after in zip(entries, raised):
                if before.source != after.source:
                    band_updates[seg_index][band_index] = after
                    raised_count += 1
        for seg_index, changes in band_updates.items():
            planned = planned_segments[seg_index]
            planned_segments[seg_index] = replace(
                planned,
                bands=tuple(
                    changes.get(band_index, planned_band)
                    for band_index, planned_band in enumerate(planned.bands)
                ),
            )
        if raised_count:
            self.info(
                f"DivideBoreholes: {raised_count} unanswered band(s) raised to the loosest "
                "class their own column measured for that soil, rather than the NAD floor"
            )

        self.info(
            f"DivideBoreholes.plan: geotech_model={geotech_model.id} "
            f"segments={len(planned_segments)} bands={total_layers} "
            f"divided={divided_borehole_count} single={single_band_borehole_count}"
        )
        return DivideBoreholePlan(
            replaced_tie_layer_pairs=tuple(replaced_tie_pairs),
            geotech_model_id=geotech_model.id,
            segments=tuple(planned_segments),
            divided_borehole_count=divided_borehole_count,
            single_band_borehole_count=single_band_borehole_count,
            layer_count=total_layers,
            pick_count=len(picks),
            cpt_layer_index=dict(geotech_layer_by_inv_depth),
            borehole_names=borehole_names,
        )

    async def _load_section_placements(self, project_id: UUID) -> list[SectionPlacement]:
        """Load every section's along-positions once, for the flanking rule.

        "The CPT to the left and to the right" is only meaningful along a
        section line, so the planner needs, per section, the along-distance of
        every column the section actually draws.  The projection used here is
        the SAME one the section view, the DXF export and the correlation
        adjacency use (``project_investigations_onto_section``) — a borehole the
        engineer sees between two CPTs is the borehole this rule sees between
        them.

        Parameters
        ----------
        project_id : UUID
            Owning project.

        Returns
        -------
        list[SectionPlacement]
            One entry per section that draws at least one investigation, in the
            sections' display order.
        """
        placements: list[SectionPlacement] = []
        for section in await load_project_sections(self._session, project_id):
            along = await project_investigations_onto_section(
                self._session,
                project_id=project_id,
                section_id=section.id,
                missing_ok=True,
            )
            if not along:
                continue
            placements.append(
                SectionPlacement(
                    section_id=str(section.id),
                    section_name=section.name,
                    along_m={str(inv_id): value for inv_id, value in along.items()},
                )
            )
        self.info(
            f"DivideBoreholes: {len(placements)} section(s) carry columns; "
            f"columns per section={[len(p.along_m) for p in placements]}"
        )
        if not placements:
            self.warning(
                "DivideBoreholes: no section places any investigation — every borehole "
                "falls back to its nearest CPT by map distance (the flanking rule needs "
                "a cross section to define left and right)"
            )
        return placements

    async def _load_accepted_tie_rows(self, geotech_model_id: UUID) -> list[Any]:
        """Load every ACCEPTED correlation edge of the geotech model.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model whose ties are read.

        Returns
        -------
        list[Any]
            Rows of ``(section_id, layer_a_id, layer_b_id)``.  Unapproved
            proposals are excluded by the query: only what the engineer accepted
            may steer where a borehole's packing comes from.
        """
        rows = (
            await self._session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.section_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                ).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
            )
        ).all()
        return list(rows)

    @staticmethod
    def _accepted_cpt_ties(
        rows: list[Any], *, layer_to_investigation: dict[UUID, str]
    ) -> list[AcceptedTie]:
        """Keep the accepted ties whose BOTH endpoints are CPT packing bands.

        Parameters
        ----------
        rows : list[Any]
            ``(section_id, layer_a_id, layer_b_id)`` rows from
            :meth:`_load_accepted_tie_rows`.
        layer_to_investigation : dict[UUID, str]
            ``geotech layer id → CPT investigation id`` for every CPT band in
            the model.  A tie endpoint missing from this map sits on a borehole
            column, and the ruling names a CPT pair.

        Returns
        -------
        list[AcceptedTie]
            The CPT↔CPT ties, in the domain rule's own vocabulary.
        """
        ties: list[AcceptedTie] = []
        for section_id, layer_a_id, layer_b_id in rows:
            inv_a = layer_to_investigation.get(layer_a_id)
            inv_b = layer_to_investigation.get(layer_b_id)
            if inv_a is None or inv_b is None or inv_a == inv_b:
                continue
            ties.append(
                AcceptedTie(
                    investigation_a=inv_a,
                    layer_a_id=str(layer_a_id),
                    investigation_b=inv_b,
                    layer_b_id=str(layer_b_id),
                    section_id=str(section_id),
                )
            )
        return ties

    async def preview_tie_carry(self, plan: DivideBoreholePlan) -> ReanchorPlan:
        """Say what a commit of *plan* would do to the accepted borehole ties.

        Reads the accepted ties exactly as :meth:`execute` does, then runs the
        SAME pure matcher (:func:`plan_tie_reanchor`) against the bands the plan
        would write.  Nothing is captured "for later" and nothing is written —
        the ties are still in the table when this returns.

        The matcher keys on ``(investigation, depth interval, NAD class)``, none
        of which depends on a row id, so the counts here are the counts the
        commit produces even though the planned bands carry placeholder ids.

        Parameters
        ----------
        plan : DivideBoreholePlan
            The plan whose consequences are being reported.

        Returns
        -------
        ReanchorPlan
            Matched (with review flags), lost (with reasons), and duplicate
            counts.  ``lost_tie_labels`` is left empty — naming the losses costs
            an extra query and only the commit's toast needs it.
        """
        captured = await GeotechTieReanchor(self._session).capture(
            plan.geotech_model_id, restrict_to_anchor_kind=ANCHOR_BOREHOLE
        )
        if not captured:
            return ReanchorPlan()
        # The CPT bands this verb leaves untouched, plus the borehole bands it
        # would write.  Placeholder layer ids: the match is by identity, and the
        # ids are only used to de-duplicate pairs, which placeholders do equally
        # well because they are unique per planned band.
        bands = rebuilt_bands_from_layer_index(plan.cpt_layer_index)
        bands.extend(
            RebuiltBand(
                identity=BandIdentity(
                    investigation_id=segment.investigation_id,
                    depth_top_mm=depth_to_mm(band.depth_top_m),
                    depth_base_mm=depth_to_mm(band.depth_base_m),
                    nad_class=band.nad_class,
                ),
                layer_id=uuid7(),
            )
            for segment in plan.segments
            for band in segment.bands
        )
        # borehole_bands_are_final=True for the same reason execute passes it:
        # THIS verb is the step a deferred borehole endpoint was waiting for.
        return plan_tie_reanchor(captured, bands, borehole_bands_are_final=True)

    async def execute(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        borehole_ids: set[UUID] | None = None,
        section_id: UUID | None = None,
        section_partitions: Mapping[UUID, SectionPartitionInput] | None = None,
    ) -> DivideBoreholeResult:
        """Materialise litho-confined borehole bands for *litho_model_id*.

        Persists exactly what :meth:`plan` computed — the plan is the single
        source of the band geometry and classes, so what the preview showed is
        what lands in the table.

        Parameters
        ----------
        project_id : UUID
            Owning project id (used for scope guards and formation queries).
        litho_model_id : UUID
            The lithostratigraphic model whose geotech child model holds the
            CPT geotech layers.
        borehole_ids : set[UUID] | None
            Divide only these borehole columns.  ``None`` (the default) divides
            every borehole — exactly today's semantics.  With a subset, the
            delete is scoped to the same set, so a borehole left out keeps the
            bands (and the ties anchored on them) it already had.
        section_id : UUID | None
            Divide only the boreholes on ONE section, and derive that section's
            borehole-mediated edges only (owner ruling 2026-08-15: *"i'm
            reading divide boreholes (whole model), no that should also be
            section scoped"*).  Resolved into *borehole_ids* by
            :meth:`_scoped_borehole_ids`, which is what makes the delete, the
            untouched-column seeding and the tie capture follow the scope
            without a second mechanism.  ``None`` keeps the whole-model run.

            A borehole on TWO sections is divided by either section's press:
            its bands come from its own donors and its body membership, not
            from the section it is drawn on, so each press produces the same
            rows for it.

        Returns
        -------
        DivideBoreholeResult
            Summary counts + the list of newly created geotech formation ids.

        Raises
        ------
        HTTPException
            404 when the litho model or geotech model does not exist.
        """
        t0 = time.monotonic()
        # Resolved ONCE, here, and handed to ``plan`` already narrowed — the
        # phases below read ``borehole_ids`` directly, so the commit and its
        # own plan must be looking at the same set.
        borehole_ids = await self._scoped_borehole_ids(
            project_id=project_id, section_id=section_id, borehole_ids=borehole_ids
        )
        self.info(
            f"DivideBoreholes: start project={project_id} litho_model={litho_model_id} "
            f"scope={section_id or 'all sections'} "
            f"boreholes={'ALL' if borehole_ids is None else len(borehole_ids)}"
        )

        plan = await self.plan(
            project_id=project_id,
            litho_model_id=litho_model_id,
            borehole_ids=borehole_ids,
            section_partitions=section_partitions,
        )
        geotech_model_id = plan.geotech_model_id
        if plan.pick_count == 0:
            await self._session.commit()
            return DivideBoreholeResult(
                geotech_model_id=geotech_model_id,
                divided_borehole_count=0,
                single_band_borehole_count=0,
                layer_count=0,
                created_formation_ids=[],
            )

        # The per-investigation layer index the rest of the verb writes into.
        # Seeded with the plan's CPT bands; the borehole bands are appended as
        # they are inserted below.
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ] = defaultdict(list)
        for inv_id_key, entries in plan.cpt_layer_index.items():
            geotech_layer_by_inv_depth[inv_id_key].extend(entries)

        # A subset run leaves other boreholes' bands in the table.  Seed the
        # index with them so they read as divided columns: without this the
        # bridging pass would jump over a borehole that HAS packing, and the tie
        # re-anchor would report a tie anchored on one as lost.
        if borehole_ids is not None:
            untouched_rows = (
                await self._session.execute(
                    select(
                        LithoLayerOrm.borehole_id,
                        LithoLayerOrm.depth_top_m,
                        LithoLayerOrm.depth_base_m,
                        LithoLayerOrm.id,
                        LithoLayerOrm.formation_id,
                        GeologicalFormationOrm.nad_class,
                        LithoLayerOrm.body_id,
                    )
                    .join(
                        GeologicalFormationOrm,
                        LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                    )
                    .where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.borehole_id.is_not(None),
                        LithoLayerOrm.borehole_id.notin_(borehole_ids),
                    )
                )
            ).all()
            for row in untouched_rows:
                geotech_layer_by_inv_depth[str(row.borehole_id)].append(
                    (
                        row.depth_top_m,
                        row.depth_base_m,
                        row.id,
                        row.formation_id,
                        row.nad_class,
                        row.body_id,
                    )
                )
            self.info(
                f"DivideBoreholes: subset run — {len(untouched_rows)} band(s) on "
                f"boreholes outside the subset left untouched and kept visible"
            )

        # Phase 6b — capture the engineer's ACCEPTED packing ties that touch a
        # borehole column, BEFORE Phase 7 removes their endpoints.
        #
        # Both endpoint FKs are ON DELETE CASCADE, so the delete below takes
        # every edge with a borehole endpoint with it — including the ties the
        # engineer drew and accepted by hand, silently, without passing through
        # any application code.  Sparing them in the delete's WHERE clause
        # cannot help: the rows they point at genuinely cease to exist, because
        # Phase 8 rebuilds every borehole band with a fresh uuid7.  The tie is
        # preserved one level up instead — recorded by identity here and
        # re-created against the matching rebuilt band in Phase 8c.
        #
        # CPT↔CPT ties are deliberately NOT captured: Phase 7 does not touch
        # their endpoints, so their rows survive untouched and counting them as
        # "carried" would overstate what this verb did.
        # A correlation from a column to ITSELF is never valid — a column needs
        # no tie to say its own bands are stacked — and the section draws one as
        # a diagonal line through the column's own interior (owner, 2026-08-16:
        # "weird as diagonal bands over columns").
        #
        # Swept here rather than only guarded at the write site because the
        # re-anchor CARRIES an existing tie onto the rebuilt bands: both
        # endpoints are on the borehole being re-divided, so a self-tie already
        # in the model survives every subsequent press. Whatever wrote it, this
        # is the pass that can see it and clear it.
        #
        # BEFORE the capture below, and that ordering is the whole point:
        # the re-anchor picks a self-tie up like any other, cannot place it
        # on the rebuilt bands, and reports it LOST — "1 accepted packing
        # tie could not be kept ... B9 13.29-13.40 <-> B9 13.40-16.12"
        # (owner, 2026-08-16). Sweeping afterwards deletes the row but the
        # engineer has already been told he lost work he never drew.
        self_tie_rows = (
            await self._session.execute(
                text(
                    """
                    SELECT ed.id
                    FROM litho_contact_correlation_edge ed
                    JOIN litho_layer la ON la.id = ed.layer_a_id
                    JOIN litho_layer lb ON lb.id = ed.layer_b_id
                    WHERE ed.model_id = :model_id
                      AND COALESCE(la.cpt_id, la.borehole_id)
                        = COALESCE(lb.cpt_id, lb.borehole_id)
                    """
                ),
                {"model_id": geotech_model_id},
            )
        ).all()
        self_tie_ids = [row.id for row in self_tie_rows]
        if self_tie_ids:
            await self._session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id.in_(self_tie_ids)
                )
            )
            self.info(
                f"DivideBoreholes: {len(self_tie_ids)} self-tie(s) deleted — "
                "a correlation from a column to itself draws as a diagonal "
                "through that column and means nothing"
            )

        tie_reanchor = GeotechTieReanchor(self._session)
        captured_ties = await tie_reanchor.capture(
            geotech_model_id, restrict_to_anchor_kind=ANCHOR_BOREHOLE
        )
        if borehole_ids is not None:
            # Only the subset's bands are deleted, so only the ties anchored on
            # THOSE columns are at risk. Re-creating a tie whose row was never
            # destroyed would double it.
            subset_keys = {str(b) for b in borehole_ids}
            captured_ties = [
                tie
                for tie in captured_ties
                if (
                    tie.anchor_kind_a == ANCHOR_BOREHOLE
                    and tie.identity_a.investigation_id in subset_keys
                )
                or (
                    tie.anchor_kind_b == ANCHOR_BOREHOLE
                    and tie.identity_b.investigation_id in subset_keys
                )
            ]

        # Phase 7 — delete existing borehole geotech layers (subset-scoped when
        # the caller named the boreholes to divide).
        delete_conditions = [
            LithoLayerOrm.model_id == geotech_model_id,
            LithoLayerOrm.borehole_id.is_not(None),
        ]
        if borehole_ids is not None:
            delete_conditions.append(LithoLayerOrm.borehole_id.in_(borehole_ids))
        deleted = (
            await self._session.execute(delete(LithoLayerOrm).where(*delete_conditions))
        ).rowcount
        self.info(f"DivideBoreholes: deleted {deleted} prior borehole geotech layer(s)")

        # Phase 8 (write half) — transcribe the plan into rows, in plan order.
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm] = {}
        created_formation_ids: list[UUID] = []
        # borehole_fill_bands: accumulates Band objects per borehole across ALL
        # body groups so Phase 9 (sample assignment) has the complete picture for
        # each borehole even when it spans multiple litho bodies.
        borehole_fill_bands: dict[str, list[Band]] = defaultdict(list)
        # (section, donor band, borehole band) — the hops the fraction rescale
        # already established when it laid each borehole band between a known
        # pair of flank bands. Phase 8.5 writes them; nothing downstream has to
        # rediscover the pairing.
        donor_hops: list[tuple[UUID, UUID, UUID, str, float]] = []

        for segment in plan.segments:
            await self._persist_planned_segment(
                project_id=project_id,
                geotech_model_id=geotech_model_id,
                segment=segment,
                classified_by_key=classified_by_key,
                skeleton_by_key=skeleton_by_key,
                created_formation_ids=created_formation_ids,
                geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                borehole_fill_bands=borehole_fill_bands,
                donor_hops=donor_hops,
            )

        total_layers = plan.layer_count
        divided_borehole_count = plan.divided_borehole_count
        single_band_borehole_count = plan.single_band_borehole_count

        # Phase 8c — re-anchor the ties captured in Phase 6b onto the bands
        # that now exist.  ``geotech_layer_by_inv_depth`` holds BOTH the CPT
        # bands Phase 6 loaded (untouched by this verb, so a CPT endpoint
        # matches its own unchanged band exactly) and the borehole bands
        # Phase 8 just wrote, which is what a borehole endpoint needs.
        #
        # Runs BEFORE Phase 8.5 so that pass's per-section dedup set is loaded
        # AFTER these ties are in the table and cannot stack an unapproved
        # proposal beside one of them.
        #
        # ``borehole_bands_are_final=True``: this verb IS the "one verb later"
        # that SubdivideAllBodies defers borehole endpoints to.  A borehole that
        # still carries no band here (excluded, outside every litho body, or
        # nothing materialised for it) has permanently lost the tie, and must be
        # reported as ``band_absent`` rather than as waiting for a step that
        # already ran.
        reanchor_plan = await tie_reanchor.reanchor(
            geotech_model_id=geotech_model_id,
            captured=captured_ties,
            rebuilt_bands=rebuilt_bands_from_layer_index(geotech_layer_by_inv_depth),
            borehole_bands_are_final=True,
        )

        # Phase 8.5 — derive the borehole-mediated geotech edges + re-resolve.
        #
        # SubdivideAllBodies derives geotech edges BEFORE boreholes exist, so
        # every litho edge with a borehole endpoint is skipped (empty geotech
        # stack). Now that the borehole geotech bands are materialised (and in
        # `geotech_layer_by_inv_depth`), run the SAME shared derivation to add
        # exactly those borehole-involving edges — a chain like S13↔B4↔B6↔S6
        # (CPT↔borehole↔borehole↔CPT) is entirely borehole-mediated and gets 0
        # edges without this pass. The persisted edge graph feeds the resolver
        # (body identity), the inspector, and the 3D geotech build.
        #
        # Phase 7 already cascade-deleted any borehole-involving edges when it
        # deleted the prior borehole layers (edge→layer FK is ON DELETE CASCADE),
        # so the surviving edges are the CPT↔CPT set from SubdivideAllBodies —
        # preload the dedup set with them so this pass ADDS only new pairs.
        # Dedup is PER SECTION: geotech edges are section-scoped, so the same
        # layer pair can legitimately exist on two sections. Preload each
        # section's seen-set with only that section's existing edges — a single
        # model-global set would suppress a legitimate same-pair edge on a
        # second section.
        seen_pairs_by_section = await load_existing_geotech_edge_pairs_by_section(
            self._session, geotech_model_id
        )
        seen_sided_by_section = await load_existing_geotech_sided_edges_by_section(
            self._session, geotech_model_id
        )
        # Seeds the crossing guard: a proposal that would cross an approval
        # already in the model is refused rather than shipped as a conflict
        # that stops the whole gap from banding (owner §8 Q4).
        accepted_sided_by_section = await load_accepted_geotech_sided_edges_by_section(
            self._session, geotech_model_id
        )
        # The engineer's deleted ties, per section — consulted at the emit
        # gate so a deletion stays deleted (owner 2026-08-17). Empty dict in
        # the ordinary never-deleted case.
        tombstone_gates = await build_tombstone_gates(self._session, geotech_model_id, project_id)
        litho_layer_depths = await load_litho_layer_depths(self._session, litho_model_id, None)
        sections = await load_project_sections(self._session, project_id)
        if section_id is not None:
            # A scoped press authors edges on its own section only. Deriving
            # for the neighbour would stamp proposals onto a section this call
            # left undivided — ties pointing at bands that were never written,
            # on a section the engineer has not reached yet.
            sections = [section for section in sections if section.id == section_id]
        edge_totals = EdgeDerivationCounts()
        # ------------------------------------------------------------------
        # ------------------------------------------------------------------
        # Step 4 does not invent correlations.
        #
        # Owner, 2026-08-17: *"you don't need to invent correlations, just put
        # the litho correlations on there and if a density band has an obvious
        # match then you link it too, other than that, you don't link jack
        # shit"*.
        #
        # So the donor-hop machinery is gone. It derived a correlation from the
        # fraction rescale that produced a band — a chain through the boreholes,
        # bridged over columns, born accepted — and every one of those was a
        # claim about lateral continuity that nothing in his model made. What
        # remains is the derivation below: the restatement of his own litho
        # ties, plus same-class pairs where the match is obvious.
        #
        # Deleted with it: the re-expression sweep that removed his CPT-to-CPT
        # ties on the grounds that a chain had replaced them. With no chain,
        # nothing replaces them, so nothing of his is removed.
        # ------------------------------------------------------------------
        hops_written = 0
        superseded_edge_ids: list[UUID] = []
        superseded_labels: list[str] = []
        for section in sections:
            edge_sets = await load_approved_litho_edge_sets(
                self._session, litho_model_id, section.id
            )
            approved = edge_sets.pairs
            if not approved:
                continue
            # Bridging is a no-op for a fully divided model (every column now
            # carries bands); it still runs so a borehole this call deliberately
            # left undivided (``borehole_ids`` subset) is jumped over rather
            # than blocking the CPT pair either side of it.
            bridged = bridge_edges_over_bandless_columns(
                approved, litho_layer_depths, geotech_layer_by_inv_depth
            )
            edge_totals.add(
                await derive_geotech_edges_from_litho(
                    self._session,
                    self,
                    geotech_model_id=geotech_model_id,
                    section_id=section.id,
                    litho_approved_edges=bridged,
                    litho_layer_depths=litho_layer_depths,
                    geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                    seen_layer_pairs=seen_pairs_by_section.setdefault(section.id, set()),
                    # 2026-08-06 refinement: restating pairs accepted,
                    # interior + bridged pairs pending.
                    direct_litho_pairs=approved,
                    # Owner rulings 2026-08-13/14: every non-top↔top litho
                    # tie (bottom ties AND mixed onlap declarations) restates
                    # side-preserved onto the bands owning its contacts.
                    litho_sided_edges=edge_sets.sided_edges,
                    seen_sided_edges=seen_sided_by_section.setdefault(section.id, set()),
                    existing_accepted_sided_edges=accepted_sided_by_section.get(section.id, set()),
                    # Owner ruling 2026-08-15: "subdivision hops should be born
                    # accepted". These hops re-express, through the borehole
                    # this press just divided, correlations he already drew —
                    # so making him accept them turned one press into
                    # press-accept-press, and the second press only wrote more
                    # of them. Step 2 keeps the ghost/review flow.
                    born_accepted=True,
                    tie_tombstoned=tombstone_gates.get(section.id),
                )
            )
            # Owner ruling 2026-08-14: "those cpt to cpt ties should be
            # replaced by cpt to borehole to borehole to cpt ties once i click
            # subdivide boreholes" / "just delete all".  A tie kept alongside
            # the chain would still weld one body straight across a borehole
            # whose bands disagree, and the fill would still draw its straight
            # bridge line over the real bands.  Deletion only fires when an
            # ACCEPTED chain of shorter hops inside the tie's own span already
            # connects the same two bands, so connectivity is unchanged by
            # construction and the resolver pass below needs no extra trigger.
            #
            # The judgment is GEOMETRIC, so it needs the section's own column
            # order — the same projection the section view, the DXF export and
            # the flanking rule use, so a borehole the engineer sees between
            # two CPTs is the borehole this rule sees between them.  (Keying on
            # provenance instead spared every restatement of a direct litho tie,
            # which on the owner's model is exactly the tie he wanted replaced:
            # he correlates CPT→CPT ACROSS the boreholes at the litho stage.)
            along_by_investigation = {
                str(inv_id): value
                for inv_id, value in (
                    await project_investigations_onto_section(
                        self._session,
                        project_id=project_id,
                        section_id=section.id,
                        missing_ok=True,
                    )
                ).items()
            }
            section_edges = await load_geotech_edges_for_supersession(
                self._session, geotech_model_id, section.id
            )
            edge_by_id = {e.edge_id: e for e in section_edges}
            for edge_id in superseded_jump_tie_ids(section_edges, along_by_investigation):
                superseded_edge_ids.append(edge_id)
                doomed = edge_by_id[edge_id]
                superseded_labels.append(
                    f"{doomed.investigation_a} <-> {doomed.investigation_b} "
                    f"(edge {edge_id}, section {section.id})"
                )
        if superseded_edge_ids:
            await self._session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id.in_(superseded_edge_ids)
                )
            )
            self.info(
                f"DivideBoreholes: {len(superseded_edge_ids)} jump tie(s) superseded by "
                f"the borehole-mediated chain and deleted"
            )
            for label in superseded_labels:
                self.debug(f"DivideBoreholes: superseded jump tie {label}")
        self.info(
            f"DivideBoreholes: Phase 8.5 — {edge_totals.edges_emitted} borehole-mediated "
            f"geotech edge(s) added (skipped_empty_stack={edge_totals.skipped_empty_stack}, "
            f"skipped_no_lcs={edge_totals.skipped_no_lcs})"
        )

        # Re-run the resolver over the geotech model so body_id spans the newly
        # connected borehole chains. This is what fixes an orphan borehole band
        # (body_id NULL because no same-class CPT sat in its group) — once it is
        # edge-connected to a CPT band, the resolver puts them in one body.
        #
        # The 8.5a hops count here too. They connect the same bands the
        # alignment pass used to, so once they claim a pair the pass reports
        # zero emitted — and gating the resolver on that count alone silently
        # skipped the re-resolve, leaving a borehole band tied but body-less and
        # its samples unanchored (integration SA-5, caught 2026-08-15).
        if edge_totals.edges_emitted or hops_written:
            await ResolveLithoInstances(self._session).execute(
                model_id=geotech_model_id, commit=False
            )
            # Re-read the resolver-stamped body_id for each borehole geotech
            # layer and reconcile the in-memory fill bands, so Phase 9 assigns
            # each sample the SAME body the layer now belongs to (Band is frozen
            # — rebuild via replace). Keyed on (borehole, top, base): the layer
            # was created from the same fill band, so the depths match to mm.
            bh_layer_rows = (
                await self._session.execute(
                    select(
                        LithoLayerOrm.borehole_id,
                        LithoLayerOrm.depth_top_m,
                        LithoLayerOrm.depth_base_m,
                        LithoLayerOrm.body_id,
                    ).where(
                        LithoLayerOrm.model_id == geotech_model_id,
                        LithoLayerOrm.borehole_id.is_not(None),
                    )
                )
            ).all()
            body_by_key: dict[tuple[str, float, float], UUID | None] = {
                (str(r.borehole_id), round(r.depth_top_m, 3), round(r.depth_base_m, 3)): r.body_id
                for r in bh_layer_rows
            }
            reconciled = 0
            for inv_id, bands in borehole_fill_bands.items():
                new_bands: list[Band] = []
                for b in bands:
                    key = (inv_id, round(b.top, 3), round(b.base, 3))
                    resolved = body_by_key.get(key)
                    new_body = str(resolved) if resolved is not None else b.body_id
                    if new_body != b.body_id:
                        reconciled += 1
                    new_bands.append(replace(b, body_id=new_body))
                borehole_fill_bands[inv_id] = new_bands
            self.info(
                f"DivideBoreholes: reconciled {reconciled} fill-band body_id(s) to the "
                f"resolver after edge derivation"
            )

        # Phase 9 — assign samples to geotech bands.
        # For each borehole that received bands, load its samples and stamp the
        # three geotech assignment columns using the midpoint lookup.
        all_bh_ids = {UUID(inv_id) for inv_id in borehole_fill_bands}
        if all_bh_ids:
            self.info(
                f"DivideBoreholes: Phase 9 — assigning samples for {len(all_bh_ids)} borehole(s)"
            )
            sample_rows = (
                (
                    await self._session.execute(
                        select(SampleOrm).where(SampleOrm.borehole_id.in_(all_bh_ids))
                    )
                )
                .scalars()
                .all()
            )

            assigned = 0
            fallback_no_body = 0  # matched a band, but body_id None (no same-class CPT)
            unresolved = 0
            total = len(sample_rows)
            for i, sample in enumerate(sample_rows, 1):
                inv_id_str = str(sample.borehole_id)
                bands_for_bh = borehole_fill_bands.get(inv_id_str, [])
                body_id, nad_class, source = assign_sample_to_band(
                    sample.depth_top_m,
                    sample.depth_base_m,
                    bands_for_bh,
                )
                sample.geotech_body_id = UUID(body_id) if body_id else None
                sample.geotech_nad_class = nad_class
                sample.geotech_assignment_source = source
                # source != "unresolved" means a band WAS matched (nad_class +
                # source persisted), even when body_id is None for a conservative
                # body_min / absolute_min fallback band — those are not failures.
                if source != "unresolved":
                    assigned += 1
                    if body_id is None:
                        fallback_no_body += 1
                else:
                    unresolved += 1
                    # Midpoint fell outside every litho-body extent on this
                    # borehole — log it so the gap is diagnosable without a re-run.
                    self.debug(
                        f"[{i}/{total}] sample {sample.id} "
                        f"depth=[{sample.depth_top_m},{sample.depth_base_m}]: "
                        f"unresolved (borehole has {len(bands_for_bh)} band(s))"
                    )
            self.info(
                f"DivideBoreholes: sample assignment assigned={assigned} "
                f"(fallback_no_body={fallback_no_body}) unresolved={unresolved}"
            )

        # Both writers have now had their say: the re-anchor carried the
        # engineer's ties across the rebuild, and the derivation re-emitted the
        # ones the litho model restates. They write their endpoints in whatever
        # order they hold them, so the same correlation can land twice with the
        # columns reversed — the owner met this as flagged ties he deleted by
        # hand after every press (2026-08-16), the flagged copy being the
        # carried one and the clean copy the freshly derived one.
        edge_rows = (
            await self._session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.id,
                    LithoContactCorrelationEdgeOrm.section_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                    LithoContactCorrelationEdgeOrm.layer_a_side,
                    LithoContactCorrelationEdgeOrm.layer_b_side,
                    LithoContactCorrelationEdgeOrm.source,
                    LithoContactCorrelationEdgeOrm.review_reason,
                ).where(LithoContactCorrelationEdgeOrm.model_id == geotech_model_id)
            )
        ).all()
        duplicate_ids = duplicate_edge_ids_to_drop(
            [
                GeotechEdgeRow(
                    edge_id=edge_row.id,
                    section_id=edge_row.section_id,
                    layer_a_id=edge_row.layer_a_id,
                    layer_b_id=edge_row.layer_b_id,
                    layer_a_side=edge_row.layer_a_side,
                    layer_b_side=edge_row.layer_b_side,
                    source=edge_row.source,
                    review_reason=edge_row.review_reason,
                )
                for edge_row in edge_rows
            ]
        )
        if duplicate_ids:
            await self._session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id.in_(duplicate_ids)
                )
            )
            self.info(
                f"DivideBoreholes: {len(duplicate_ids)} duplicate packing tie(s) dropped "
                "— the same correlation had been both carried across the rebuild and "
                "re-derived from the litho model"
            )

        # Legacy crossings the guard cannot reach: it refuses new candidates,
        # while the re-anchor carries stored ties across every rebuild. Owner
        # 2026-08-17 — "ties shouldn't be able to cross"; hand-drawn ties are
        # never candidates ("user made ties should be left alone").
        crossing_dropped = await sweep_crossing_ties(self._session, self, geotech_model_id)

        await self._session.flush()
        await self._session.commit()

        elapsed = time.monotonic() - t0
        result = DivideBoreholeResult(
            geotech_model_id=geotech_model_id,
            divided_borehole_count=divided_borehole_count,
            single_band_borehole_count=single_band_borehole_count,
            layer_count=total_layers,
            created_formation_ids=created_formation_ids,
            reanchored_tie_count=len(reanchor_plan.matched),
            review_tie_reasons=reanchor_plan.review_reason_counts(),
            lost_tie_count=len(reanchor_plan.lost),
            lost_tie_reasons=reanchor_plan.loss_reason_counts(),
            lost_tie_labels=reanchor_plan.lost_tie_labels,
            # Only the geometric supersession deletes ties now: step 4 no
            # longer re-expresses anything as a hop, so there is no second
            # source of deletions to report.
            superseded_jump_tie_count=len(superseded_edge_ids),
            crossing_tie_count=crossing_dropped,
        )
        self.success(
            f"DivideBoreholes: geotech_model={geotech_model_id} "
            f"divided_bh={divided_borehole_count} "
            f"single_bh={single_band_borehole_count} "
            f"layers={total_layers} "
            f"borehole_ties_reanchored={len(reanchor_plan.matched)}/{len(captured_ties)} "
            f"borehole_ties_lost={len(reanchor_plan.lost)} "
            f"elapsed={elapsed:.1f}s"
        )
        return result

    # ------------------------------------------------------------------
    # Litho-confined borehole materialisation
    # ------------------------------------------------------------------

    def _plan_borehole_bands_litho_confined(
        self,
        *,
        inv_id: str,
        bh_x: float,
        bh_y: float,
        bh_surface_elev: float,
        geo_top_m: float,
        geo_base_m: float,
        litho_layer_top_m: float | None = None,
        litho_layer_base_m: float | None = None,
        min_thickness_m: float = DEFAULT_MIN_THICKNESS_M,
        cpt_segs: list[BodyLayerPick],
        litho_abs_min_class: int,
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ],
        cpt_xy: dict[UUID, tuple[float, float, float]],
        cpt_names: dict[UUID, str],
        section_placements: list[SectionPlacement],
        accepted_ties: Sequence[AcceptedTie] = (),
        section_partitions: Mapping[UUID, SectionPartitionInput] | None = None,
        geotech_formation_info: Mapping[str, tuple[int | None, UUID, UUID | None]] | None = None,
        replaced_tie_pairs: list[tuple[str, str]] | None = None,
    ) -> tuple[list[FillBand], list[UUID | None], list[tuple[str, ...]], FlankSelection]:
        """Compute one borehole's litho-confined bands. Reads nothing, writes nothing.

        Gathers the eligible donor CPTs for this body group — those whose
        geotech layers fall within the CPT's OWN litho-body extent, the
        same-lithology clip — hands them to
        :func:`~groundmodel.domain.services.borehole_flank_donors.select_flank_donors`,
        which applies the owner's flanking rule, and lays the chosen donors'
        packing onto the borehole's extent in thickness-fraction space.  Depth
        the donors leave unclassified is filled conservatively by
        :func:`~groundmodel.domain.services.borehole_packing_fill.fill_borehole_litho_body_extent`,
        exactly as before.

        Pure with respect to the database — every input is already in memory —
        which is what lets the preview endpoint run the real engine instead of
        a re-statement of it.

        Parameters
        ----------
        inv_id : str
            Borehole id string.
        bh_x : float
            Borehole world x-coordinate (m).
        bh_y : float
            Borehole world y-coordinate (m).
        bh_surface_elev : float
            Borehole collar elevation (m, positive up).
        geo_top_m : float
            Top of the litho-body extent on this borehole (m).
        geo_base_m : float
            Base of the litho-body extent on this borehole (m).
        cpt_segs : list[BodyLayerPick]
            CPT body-layer picks in this group, each carrying the CPT's own
            litho extent (``top_depth_m``, ``base_depth_m``).
        litho_abs_min_class : int
            Absolute weakest NAD class for the lithology family (from
            ``loosest_class_for(soil, admixtures)`` — the variant-aware floor).
        geotech_layer_by_inv_depth : dict
            ALL CPT geotech layers keyed by investigation id string.
        cpt_xy : dict[UUID, tuple[float, float, float]]
            XY coordinates of CPTs keyed by id.
        cpt_names : dict[UUID, str]
            CPT display names keyed by id — donor provenance names the test.
        section_placements : list[SectionPlacement]
            Every project section with the along-positions of the columns it
            draws.  This is what makes "left" and "right" meaningful.
        accepted_ties : Sequence[AcceptedTie]
            The engineer's ACCEPTED CPT↔CPT packing ties.  One whose span
            crosses this borehole's column names the donor pair outright and
            outranks the flanking guess (owner ruling 2026-08-04).  Defaults to
            empty, which is exactly "no tie spans anything" — the flanking rule
            then answers as it always did.
        section_partitions : Mapping[UUID, SectionPartitionInput] | None
            The 2-D partitions, per section id.  When one covers this borehole
            it OUTRANKS the donor rule entirely (owner ruling 2026-08-15): the
            geometry between the two CPTs already says what is in the gap, so
            reading the column's line through it beats interpolating a stack
            onto it.  ``None`` / absent keeps the donor path, which is what the
            preview and every caller that has no partition still use.
        geotech_formation_info : Mapping[str, tuple[int | None, UUID, UUID | None]] | None
            ``geotech formation id -> (nad_class, source litho formation,
            source geo formation)``, needed to turn a sampled region into a
            band.  ``None`` disables the geometry path.

        Returns
        -------
        tuple[list[FillBand], list[UUID | None], list[tuple[str, ...]], FlankSelection]
            ``(fill_bands, fill_band_body_ids, fill_band_donor_ids, selection)`` — the bands to
            write, the parallel per-band geotech body_id list (``None`` for
            conservative fallback bands with no same-class CPT evidence), and
            the donor selection those bands came from.
        """
        # -------------------------------------------------------------------
        # Step 1: for each CPT in this body group, collect its geotech layers
        # that are WITHIN the CPT's own litho-body extent for this group.
        # This is the same-lithology filter: a CPT that has ZAND 0–4 m and
        # KLEI 4–8 m contributes its geotech bands for ZAND [0,4] only (not
        # the KLEI ones) when the body group is the ZAND body.
        # -------------------------------------------------------------------
        # filtered_cpt_layers: inv_id_str -> list[(top, base, lid, fid, nc, body_id)]
        # Unchanged from the ordinal era on purpose: this dict feeds the
        # conservative body_min floor and the per-band body assignment, neither
        # of which the flanking ruling touches.
        # A geological contact splits a litho layer into slices that are planned
        # separately. The packing is mapped across the WHOLE layer so the
        # neighbouring column is read once; the slice takes its own window out
        # of that answer at the end. Absent a layer extent the slice IS the
        # layer, which is the uncut case.
        layer_top_m = geo_top_m if litho_layer_top_m is None else litho_layer_top_m
        layer_base_m = geo_base_m if litho_layer_base_m is None else litho_layer_base_m
        derive_top_m, derive_base_m = layer_top_m, layer_base_m

        filtered_cpt_layers: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ] = {}
        for cpt_seg in cpt_segs:
            cpt_inv = cpt_seg.investigation_id
            seg_top = cpt_seg.top_depth_m
            seg_base = cpt_seg.base_depth_m
            in_extent = [
                entry
                for entry in geotech_layer_by_inv_depth.get(cpt_inv, [])
                # Keep layers whose depth range overlaps [seg_top, seg_base].
                if entry[0] >= seg_top - _DEPTH_OVERLAP_EPS
                and entry[1] <= seg_base + _DEPTH_OVERLAP_EPS
            ]
            if in_extent:
                if cpt_inv not in filtered_cpt_layers:
                    filtered_cpt_layers[cpt_inv] = []
                filtered_cpt_layers[cpt_inv].extend(in_extent)

        # -------------------------------------------------------------------
        # Step 2: turn each CPT in the group into a candidate donor stack.
        # -------------------------------------------------------------------
        donors = self._build_donor_stacks(
            bh_x=bh_x,
            bh_y=bh_y,
            bh_surface_elev=bh_surface_elev,
            geo_top_m=geo_top_m,
            geo_base_m=geo_base_m,
            cpt_segs=cpt_segs,
            geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
            cpt_xy=cpt_xy,
            cpt_names=cpt_names,
        )

        # -------------------------------------------------------------------
        # Step 3: the owner's rule — the CPT to the left and to the right of
        # this borehole on the section — then lay their packing onto the
        # borehole's extent in thickness-fraction space.
        # -------------------------------------------------------------------
        # An accepted tie that spans this borehole names the donor pair
        # outright; the flanking rule is what answers when none does.
        selection = select_tie_informed_donors(
            borehole_id=inv_id,
            donors=donors,
            sections=section_placements,
            ties=accepted_ties,
        ) or select_flank_donors(borehole_id=inv_id, donors=donors, sections=section_placements)
        donor_surfaces = flank_packing_surfaces_with_donors(
            selection, extent_top_m=derive_top_m, extent_base_m=derive_base_m
        )
        cpt_packing_surfaces = [(s.top, s.base, s.nad_class) for s in donor_surfaces]
        self.info(
            f"DivideBoreholes: borehole={inv_id} "
            f"extent=[{geo_top_m:.2f},{geo_base_m:.2f}] mode={selection.mode} "
            f"section={selection.section_name or '-'} donors="
            + (
                ", ".join(
                    f"{d.side}:{d.stack.name}"
                    f"(along={'-' if d.along_distance_m is None else f'{d.along_distance_m:.0f}'}m,"
                    f"map={d.stack.map_distance_m:.0f}m,w={d.weight:.2f})"
                    for d in selection.donors
                )
                or "none"
            )
            + f" candidates={len(donors)}"
        )

        # -------------------------------------------------------------------
        # Step 4: compute body_min_class = weakest NAD class across all
        # same-lithology CPT bands in this group.
        # -------------------------------------------------------------------
        all_classes = [
            nc
            for layers in filtered_cpt_layers.values()
            for (_t, _b, _lid, _fid, nc, _bid) in layers
            if nc is not None
        ]
        body_min_class: int | None = min(all_classes) if all_classes else None

        self.debug(
            f"_plan_borehole_bands_litho_confined: borehole={inv_id} "
            f"geo=[{geo_top_m:.2f},{geo_base_m:.2f}] "
            f"cpt_packing_surfaces={len(cpt_packing_surfaces)} "
            f"body_min={body_min_class} abs_min={litho_abs_min_class}"
        )

        # -------------------------------------------------------------------
        # Step 5: call the pure helper to produce litho-confined fill bands.
        # -------------------------------------------------------------------
        fill_bands = fill_borehole_litho_body_extent(
            extent_top=derive_top_m,
            extent_base=derive_base_m,
            cpt_packing_surfaces=cpt_packing_surfaces,
            body_min_class=body_min_class,
            litho_abs_min_class=litho_abs_min_class,
        )
        # Owner, 2026-08-17: "just respect minimum thickness and the cpt bands".
        # Rescaling a donor onto a thinner unit compresses its structure, and a
        # 0.465 m tail cannot hold the seven sub-bands his B5 received.
        fill_bands = coarsen_to_minimum_thickness(fill_bands, minimum_thickness_m=min_thickness_m)

        # The layer answered once; this slice takes its own window out of it.
        if (derive_top_m, derive_base_m) != (geo_top_m, geo_base_m):
            fill_bands = clip_bands_to_slice(fill_bands, geo_top_m, geo_base_m)

        # -------------------------------------------------------------------
        # Step 6: build CptBandRef list for geotech body_id assignment.
        # One entry per (CPT, band) pair in filtered_cpt_layers — the resolver
        # already stamped body_id on each CPT geotech layer during SAB Phase 10
        # (ResolveLithoInstances), so the 6th tuple element carries it.
        # -------------------------------------------------------------------
        cpt_band_refs: list[CptBandRef] = []
        for cpt_inv_str, layers in filtered_cpt_layers.items():
            cpt_inv_uuid = UUID(cpt_inv_str)
            _cpt_band_xy = cpt_xy.get(cpt_inv_uuid)
            if _cpt_band_xy is None:
                self.warning(
                    f"DivideBoreholes: CPT={cpt_inv_str} has no XY location for body assignment — "
                    "defaulting to (0,0,0); nearest-CPT body_id selection will be wrong"
                )
            x_m, y_m, _surf = _cpt_band_xy if _cpt_band_xy is not None else (0.0, 0.0, 0.0)
            for _t, _b, _lid, _fid, nc, bid in layers:
                if nc is not None:
                    cpt_band_refs.append(
                        CptBandRef(cpt_x=x_m, cpt_y=y_m, nad_class=nc, body_id=bid)
                    )

        # -------------------------------------------------------------------
        # Step 7: assign the geotech packing body_id per band — nearest
        # same-class CPT in the group.  None for conservative fallbacks that
        # have no same-class CPT evidence (body_min / absolute_min).
        # -------------------------------------------------------------------
        fill_band_body_ids: list[UUID | None] = [
            assign_borehole_band_body(
                band_nad_class=fb.nad_class,
                borehole_x=bh_x,
                borehole_y=bh_y,
                cpt_bands_in_group=cpt_band_refs,
            )
            for fb in fill_bands
        ]

        # -------------------------------------------------------------------
        # Step 5b: the section geometry outranks the donor stack.
        #
        # Owner ruling 2026-08-15. Where a partition covers this borehole, what
        # the gap contains has ALREADY been decided from his own ties — bands
        # that span it, lenses that end inside it, onlaps that lap a tie line.
        # Reading the column's vertical line through that geometry is both more
        # faithful (a lens that pinched out before the borehole is absent, not
        # averaged in) and self-consistent (the region names the layers it
        # belongs to, so the ties close into a chain instead of being guessed
        # twice, once per gap, with two different answers).
        #
        # The donor rule remains the answer wherever no partition reaches: the
        # preview, a borehole off every section, a bracketing column with no
        # layer in this body group.
        # -------------------------------------------------------------------
        # Owner's rule, 2026-08-16 — the ties place the boundaries, not the
        # polygons. Tried first because a tie names BOTH bands it joins, so the
        # hops it licenses reach both CPTs and the chain closes; the region
        # sampler below could only ever name one side.
        # Derived across the whole litho layer, for the same reason the donor
        # path is: a geological cut must not buy a second copy of the flank's
        # succession. The slice takes its window out of the answer below.
        tied = self._plan_bands_from_unit_ties(
            inv_id=inv_id,
            geo_top_m=derive_top_m,
            geo_base_m=derive_base_m,
            bh_surface_elev=bh_surface_elev,
            cpt_segs=cpt_segs,
            geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
            section_placements=section_placements,
            accepted_ties=accepted_ties,
        )
        if tied is not None:
            # The minimum applies to the TIE path too — same reason, same rule.
            # Correspondences ride along per band, so they are carried by the
            # index of the band that survives each merge.
            coarsened = coarsen_to_minimum_thickness(
                tied.bands, minimum_thickness_m=min_thickness_m
            )
            # Compared by VALUE, not by count: growing a band to the minimum
            # changes its boundaries and leaves the count alone, so a
            # length check silently threw the result away.
            if list(coarsened) != list(tied.bands):
                # A survivor keeps the correspondences of every original band
                # it overlaps — growing shifts a boundary, merging unions two,
                # and both are covered by overlap rather than containment.
                kept_correspondences = [
                    tuple(
                        dict.fromkeys(
                            item
                            for band, correspondence in zip(tied.bands, tied.correspondences)
                            if min(band.base, survivor.base) - max(band.top, survivor.top)
                            > _DEPTH_TOL_M
                            for item in correspondence
                        )
                    )
                    for survivor in coarsened
                ]
                tied = replace(tied, bands=coarsened, correspondences=kept_correspondences)

        if tied is not None and (derive_top_m, derive_base_m) != (geo_top_m, geo_base_m):
            kept = [
                (
                    replace(band, top=max(band.top, geo_top_m), base=min(band.base, geo_base_m)),
                    correspondence,
                )
                for band, correspondence in zip(tied.bands, tied.correspondences)
                if min(band.base, geo_base_m) - max(band.top, geo_top_m) >= _DEPTH_TOL_M
            ]
            tied = (
                replace(
                    tied,
                    bands=[band for band, _ in kept],
                    correspondences=[correspondence for _, correspondence in kept],
                )
                if kept
                else None
            )
        if tied is not None and _tiles_extent(tied.bands, geo_top_m, geo_base_m):
            self.info(
                f"DivideBoreholes: borehole={inv_id} "
                f"extent=[{geo_top_m:.2f},{geo_base_m:.2f}] mode=unit_ties "
                f"section={tied.section_name} ({tied.gap_width_m:.0f}m) "
                f"bands={len(tied.bands)} replaced_ties={len(tied.replaced_tie_layer_pairs)}"
            )
            if replaced_tie_pairs is not None:
                replaced_tie_pairs.extend(tied.replaced_tie_layer_pairs)
            return (
                tied.bands,
                [
                    assign_borehole_band_body(
                        band_nad_class=fb.nad_class,
                        borehole_x=bh_x,
                        borehole_y=bh_y,
                        cpt_bands_in_group=cpt_band_refs,
                    )
                    for fb in tied.bands
                ],
                tied.correspondences,
                selection,
            )

        sampled: GeometrySampling | None = None
        if section_partitions and geotech_formation_info:
            sampled = self._plan_bands_from_section_geometry(
                inv_id=inv_id,
                geo_top_m=geo_top_m,
                geo_base_m=geo_base_m,
                cpt_segs=cpt_segs,
                section_placements=section_placements,
                section_partitions=section_partitions,
                geotech_formation_info=geotech_formation_info,
            )
        if sampled is not None:
            self.info(
                f"DivideBoreholes: borehole={inv_id} "
                f"extent=[{geo_top_m:.2f},{geo_base_m:.2f}] mode=section_geometry "
                f"section={sampled.section_name} "
                f"between={sampled.left_investigation_id}|{sampled.right_investigation_id} "
                f"({sampled.gap_width_m:.0f}m) bands={len(sampled.bands)}"
            )
            # The geometry PRESERVES gaps on purpose — depth the partition does
            # not cover at this position is genuinely unclassified, and the
            # sampler is in no position to invent a class for it. But a
            # ``litho_layer`` column must be contiguous (the DB trigger rejects
            # the whole transaction otherwise: "column not contiguous: N
            # gap/overlap(s)", which is exactly how this surfaced on the owner's
            # first geometry press). So the cuts go through the SAME
            # conservative filler the donor path uses: it clips them to the
            # extent and closes every remaining stretch with body_min /
            # absolute_min, which is the honest answer for ground no CPT spoke
            # for.
            geometry_bands = fill_borehole_litho_body_extent(
                extent_top=geo_top_m,
                extent_base=geo_base_m,
                cpt_packing_surfaces=[(b.top, b.base, b.nad_class) for b in sampled.bands],
                body_min_class=body_min_class,
                litho_abs_min_class=litho_abs_min_class,
            )
            # Re-attach each cut's correspondence by midpoint: the filler only
            # ever clips the spans it was given, so a band it marks
            # ``cpt_interpolated`` lies inside exactly one of them. A
            # conservative fill continues nothing and carries no tie.
            geometry_correspondences: list[tuple[str, ...]] = []
            for band in geometry_bands:
                midpoint = 0.5 * (band.top + band.base)
                match: tuple[str, ...] = ()
                if band.source == "cpt_interpolated":
                    for cut, ids in zip(sampled.bands, sampled.correspondences):
                        if cut.top <= midpoint <= cut.base:
                            match = ids
                            break
                geometry_correspondences.append(match)
            self.debug(
                f"DivideBoreholes: borehole={inv_id} geometry cuts={len(sampled.bands)} "
                f"→ {len(geometry_bands)} contiguous band(s) after the conservative fill"
            )
            # A ``litho_layer`` column must tile its extent exactly: the
            # database trigger refuses the WHOLE transaction on any gap or
            # overlap, so a defect anywhere in the geometry path takes the
            # entire press down with it and nothing is written (that is how the
            # owner's first two geometry presses both died, on 10 and then 5
            # gap/overlap(s)). Prove the tiling here rather than discover it at
            # commit: if it does not hold, say so loudly and let the donor rule
            # answer for this column. A borehole divided by the older rule is a
            # far better outcome than a press that writes nothing at all.
            if not _tiles_extent(geometry_bands, geo_top_m, geo_base_m):
                self.error(
                    f"DivideBoreholes: borehole={inv_id} — the section geometry produced a "
                    f"non-contiguous column over [{geo_top_m:.3f},{geo_base_m:.3f}]; falling "
                    "back to the donor rule for this column. This is a bug in the sampler, "
                    "not in the data — please report the borehole id."
                )
            else:
                fill_band_body_ids = [
                    assign_borehole_band_body(
                        band_nad_class=fb.nad_class,
                        borehole_x=bh_x,
                        borehole_y=bh_y,
                        cpt_bands_in_group=cpt_band_refs,
                    )
                    for fb in geometry_bands
                ]
                return (
                    geometry_bands,
                    fill_band_body_ids,
                    geometry_correspondences,
                    selection,
                )

        # -------------------------------------------------------------------
        # Step 7b: name the donor band each fill band continues.
        #
        # The fraction rescale laid every surface between a known pair of flank
        # bands, and the fill only ever CLIPS those surfaces — so a
        # ``cpt_interpolated`` band lies inside exactly one of them and its
        # midpoint identifies which.  Attributing here rather than threading a
        # new field through the fill keeps the fill's contract (and its whole
        # test suite) untouched, and the containment is exact by construction.
        # A conservative fallback band continues nothing and stays empty.
        # -------------------------------------------------------------------
        fill_band_donor_ids: list[tuple[str, ...]] = []
        for fb in fill_bands:
            midpoint = 0.5 * (fb.top + fb.base)
            donors_here: tuple[str, ...] = ()
            if fb.source == "cpt_interpolated":
                for surface in donor_surfaces:
                    if surface.top <= midpoint <= surface.base:
                        donors_here = surface.donor_layer_ids
                        break
            fill_band_donor_ids.append(donors_here)

        # A single band is no longer proof that no CPT spoke: a donor that reads
        # one packing class across the whole unit legitimately yields one band.
        self.debug(
            f"_plan_borehole_bands_litho_confined: borehole={inv_id} "
            f"planned {len(fill_bands)} band(s) over [{geo_top_m:.2f},{geo_base_m:.2f}] "
            f"mode={selection.mode} donor_boundaries={len(cpt_packing_surfaces)}"
        )

        return fill_bands, fill_band_body_ids, fill_band_donor_ids, selection

    def _plan_bands_from_unit_ties(
        self,
        *,
        inv_id: str,
        geo_top_m: float,
        geo_base_m: float,
        bh_surface_elev: float,
        cpt_segs: list[BodyLayerPick],
        geotech_layer_by_inv_depth: dict[str, list[tuple[Any, ...]]],
        section_placements: list[SectionPlacement],
        accepted_ties: Sequence[AcceptedTie],
    ) -> UnitTiePlacement | None:
        """Lay this litho unit's packing boundaries on the borehole, from the TIES.

        Owner's rule, 2026-08-16.  A boundary that is a litho contact is already
        on the borehole and is never interpolated; an interior packing boundary
        is placed at its fraction between the bounding litho contacts; a
        continuous one is drawn; a lens or onlap only when the borehole stands
        within half the gap of the column that declared it.

        Reads no partition.  The ties already say what is continuous, and each
        one NAMES the two bands it joins — which is what makes the hop
        two-sided and the chain CPT→BH→BH→CPT close by construction.

        Parameters
        ----------
        inv_id : str
            The borehole, stringified.
        geo_top_m, geo_base_m : float
            The unit's extent on the BOREHOLE's own log.  Never moved.
        bh_surface_elev : float
            The borehole's collar, to compare its unit against a flank's
            intervals in elevation rather than in each column's own depths.
        cpt_segs : list[BodyLayerPick]
            The CPT picks in this body group; the bracketing pair's own extents
            are the frames the fractions are read in.
        geotech_layer_by_inv_depth : dict
            Every geotech band, per investigation id.
        section_placements : list[SectionPlacement]
            Along-positions per section; the tightest bracket wins.
        accepted_ties : Sequence[AcceptedTie]
            The engineer's accepted packing correlations.

        Returns
        -------
        UnitTiePlacement | None
            The bands, their per-band correspondence and the ties they replaced,
            or ``None`` when no section brackets this borehole with two picks of
            this group — the donor rule answers there, and an uncorrelated pair
            is the engineer's own choice to leave uncorrelated (owner,
            2026-08-16), not something to invent across.
        """
        picks_by_inv: dict[str, list[BodyLayerPick]] = defaultdict(list)
        for seg in cpt_segs:
            picks_by_inv[seg.investigation_id].append(seg)
        # An enclosed lens splits a body into several intervals per column,
        # so the flank is chosen per unit rather than per column.
        picks = {
            inv: pick
            for inv, group in picks_by_inv.items()
            if (
                pick := flank_pick_for_unit(
                    group,
                    unit_top_elev_m=bh_surface_elev - geo_top_m,
                    unit_base_elev_m=bh_surface_elev - geo_base_m,
                )
            )
            is not None
        }
        best: UnitTiePlacement | None = None
        best_width = float("inf")
        for placement in section_placements:
            bh_along = placement.along_m.get(inv_id)
            if bh_along is None:
                continue
            # An accepted tie STRADDLING this borehole names the pair outright
            # and outranks the nearest flanks — the owner's ruling of
            # 2026-08-11: "we correlate over the boreholes from cpt to cpt, so
            # the user's ties will define this". Only when no tie spans the
            # column does the nearest pair either side answer.
            left_id = right_id = None
            left_along = right_along = 0.0
            for tie in accepted_ties:
                if tie.section_id != placement.section_id:
                    continue
                a_along = placement.along_m.get(tie.investigation_a)
                b_along = placement.along_m.get(tie.investigation_b)
                if a_along is None or b_along is None:
                    continue
                if tie.investigation_a not in picks or tie.investigation_b not in picks:
                    continue
                low, high = sorted((a_along, b_along))
                if not (low < bh_along < high):
                    continue
                if left_id is not None and high - low >= right_along - left_along:
                    continue
                if a_along <= b_along:
                    left_id, left_along, right_id, right_along = (
                        tie.investigation_a,
                        a_along,
                        tie.investigation_b,
                        b_along,
                    )
                else:
                    left_id, left_along, right_id, right_along = (
                        tie.investigation_b,
                        b_along,
                        tie.investigation_a,
                        a_along,
                    )
            if left_id is None:
                for inv, along in placement.along_m.items():
                    if inv not in picks:
                        continue
                    if along <= bh_along and (left_id is None or along > left_along):
                        left_id, left_along = inv, along
                    if along >= bh_along and (right_id is None or along < right_along):
                        right_id, right_along = inv, along
            if left_id is None or right_id is None or left_id == right_id:
                continue
            width = right_along - left_along
            if width <= 0.0 or width >= best_width:
                continue

            left_stack = _bands_in_extent(geotech_layer_by_inv_depth, picks[left_id])
            right_stack = _bands_in_extent(geotech_layer_by_inv_depth, picks[right_id])
            if not left_stack or not right_stack:
                continue
            left_bounds = _interior_boundaries(left_stack, picks[left_id])
            right_bounds = _interior_boundaries(right_stack, picks[right_id])
            index_of_left = {b[0]: i for i, b in enumerate(left_stack)}
            index_of_right = {b[0]: i for i, b in enumerate(right_stack)}
            ties: list[tuple[int, int]] = []
            for tie in accepted_ties:
                pair = {tie.investigation_a: tie.layer_a_id, tie.investigation_b: tie.layer_b_id}
                if left_id not in pair or right_id not in pair:
                    continue
                li = index_of_left.get(UUID(pair[left_id]))
                ri = index_of_right.get(UUID(pair[right_id]))
                # A tie names two BANDS; the boundary it declares is the one
                # above each. The topmost band's "boundary above" is the litho
                # contact, which the litho model already owns.
                if li is None or ri is None or li == 0 or ri == 0:
                    continue
                ties.append((li - 1, ri - 1))

            placed = place_unit_boundaries(
                left_bounds,
                right_bounds,
                ties,
                fraction=(bh_along - left_along) / width,
                unit_top_m=geo_top_m,
                unit_base_m=geo_base_m,
            )
            bands, correspondences = _bands_between(
                placed, left_stack, right_stack, geo_top_m, geo_base_m
            )
            if not bands:
                continue
            best_width = width
            best = UnitTiePlacement(
                bands=bands,
                correspondences=correspondences,
                replaced_tie_layer_pairs=[
                    (
                        str(left_stack[ties[i][0] + 1][0]),
                        str(right_stack[ties[i][1] + 1][0]),
                    )
                    for i in replaced_tie_indices(placed)
                ],
                section_name=placement.section_name,
                gap_width_m=width,
            )
        return best

    def _plan_bands_from_section_geometry(
        self,
        *,
        inv_id: str,
        geo_top_m: float,
        geo_base_m: float,
        cpt_segs: list[BodyLayerPick],
        section_placements: list[SectionPlacement],
        section_partitions: Mapping[UUID, SectionPartitionInput],
        geotech_formation_info: Mapping[str, tuple[int | None, UUID, UUID | None]],
    ) -> GeometrySampling | None:
        """Read this borehole's bands off the section geometry it stands in.

        Owner ruling 2026-08-15: *"the borehole thing is really a geometry
        problem ... you just need to check if a borehole column intersects a
        lens or onlap"*, with *"litho is authoritative still"* and *"only invent
        inside existing litho at boreholes"*.

        The partition between the two CPTs bracketing this borehole has already
        decided, from the engineer's own ties, what lies in the gap.  This casts
        the borehole's vertical line through it, rescales what the line cuts into
        the borehole's OWN litho extent, and reports the layers each cut
        corresponds to — which are the tie endpoints the column earns by
        standing there.  Nothing is interpolated: a lens that pinched out before
        the borehole is simply absent.

        Parameters
        ----------
        inv_id : str
            The borehole's id, stringified.
        geo_top_m, geo_base_m : float
            The borehole's OWN litho-body extent for this group (m below its
            collar).  Never moved — the geometry only subdivides it.
        cpt_segs : list[BodyLayerPick]
            The CPT picks in this body group; the bracketing pair's own litho
            extents are what the ``0 → 1`` frame is built from.
        section_placements : list[SectionPlacement]
            Along-positions per section, used to choose the section whose
            columns bracket this borehole most tightly.
        section_partitions : Mapping[UUID, SectionPartitionInput]
            The 2-D partitions the caller supplied, per section id.
        geotech_formation_info : Mapping[str, tuple[int | None, UUID, UUID | None]]
            ``geotech formation id -> (nad_class, source litho formation,
            source geo formation)`` — the region names a formation, and the
            plan needs its class and find-or-create key.

        Returns
        -------
        GeometrySampling | None
            The bands and their per-band correspondence, or ``None`` when the
            geometry cannot answer here (no partition for the section, the
            borehole outside every gap, a bracketing column absent from this
            body group, or a degenerate frame).  ``None`` means the caller
            falls back to the donor rule rather than inventing anything.
        """
        picks_by_inv = {seg.investigation_id: seg for seg in cpt_segs}
        best: GeometrySampling | None = None
        best_width = float("inf")
        for placement in section_placements:
            partition = section_partitions.get(UUID(placement.section_id))
            if partition is None:
                continue
            along = placement.along_m.get(inv_id)
            if along is None:
                continue
            columns = [(c.investigation_id, c.along_m) for c in partition.columns]
            located = locate_column_in_partition(columns, along)
            if located is None:
                continue
            gap_index, fraction = located
            ordered = sorted(range(len(columns)), key=lambda i: columns[i][1])
            position = ordered.index(gap_index)
            left_inv = columns[gap_index][0]
            right_inv = columns[ordered[position + 1]][0]
            left_pick, right_pick = picks_by_inv.get(left_inv), picks_by_inv.get(right_inv)
            if left_pick is None or right_pick is None:
                # A bracketing column carries no layer of this body group, so
                # the unit it would frame does not exist there. Nothing to
                # rescale against; the donor rule still has an answer.
                continue
            width = abs(columns[ordered[position + 1]][1] - columns[gap_index][1])
            if width >= best_width:
                continue
            frame = LithoFrame(
                left_top_elev_m=left_pick.surface_elev_m - left_pick.top_depth_m,
                left_base_elev_m=left_pick.surface_elev_m - left_pick.base_depth_m,
                right_top_elev_m=right_pick.surface_elev_m - right_pick.top_depth_m,
                right_base_elev_m=right_pick.surface_elev_m - right_pick.base_depth_m,
            )
            unit_top, unit_base = frame.bounds_at(fraction)
            cuts = [
                band
                for band in sample_regions_at_fraction(
                    partition.regions, gap_index=gap_index, fraction=fraction
                )
                # The partition is built inside the litho frame, so a region
                # belongs to exactly one unit; overlap with THIS unit's window
                # is what selects the ones that subdivide it.
                if band.base_elev_m < unit_top and band.top_elev_m > unit_base
            ]
            placed = place_bands_in_litho_layer(
                cuts,
                fraction=fraction,
                frame=frame,
                layer_top_m=geo_top_m,
                layer_base_m=geo_base_m,
            )
            if not placed:
                continue
            bands: list[FillBand] = []
            correspondences: list[tuple[str, ...]] = []
            usable = True
            for band in placed:
                info = geotech_formation_info.get(band.formation_id)
                if info is None or info[0] is None:
                    # A region naming a formation this model does not know is
                    # not something to guess a class for.
                    usable = False
                    break
                bands.append(
                    FillBand(
                        top=band.depth_top_m,
                        base=band.depth_base_m,
                        nad_class=int(info[0]),
                        source="cpt_interpolated",
                    )
                )
                correspondences.append(band.layer_ids)
            if not usable:
                continue
            best_width = width
            best = GeometrySampling(
                bands=bands,
                correspondences=correspondences,
                section_id=placement.section_id,
                section_name=placement.section_name,
                left_investigation_id=left_inv,
                right_investigation_id=right_inv,
                gap_width_m=width,
            )
        return best

    def _build_donor_stacks(
        self,
        *,
        bh_x: float,
        bh_y: float,
        bh_surface_elev: float,
        geo_top_m: float,
        geo_base_m: float,
        cpt_segs: list[BodyLayerPick],
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ],
        cpt_xy: dict[UUID, tuple[float, float, float]],
        cpt_names: dict[UUID, str],
    ) -> list[DonorStack]:
        """Turn the body group's CPT picks into candidate donor stacks.

        A CPT qualifies as a donor only when it reads packing INSIDE its own
        litho extent for this group — a CPT whose geotech bands all sit in a
        different lithology has nothing to say about this unit.

        When a CPT holds several picks in the same group (the geo-bounding pass
        can slice one column into two segments of the same body), the pick that
        overlaps the borehole's own extent most in ELEVATION is used.  Merging
        the picks instead would stretch the donor's extent across the gap
        between them and distort every fraction read from it.

        Parameters
        ----------
        bh_x : float
            Borehole world x-coordinate (m) — for the map distance.
        bh_y : float
            Borehole world y-coordinate (m).
        bh_surface_elev : float
            Borehole collar elevation (m, positive up) — the frame the pick
            overlap is measured in.
        geo_top_m : float
            Top of the borehole's litho-body extent (m below its collar).
        geo_base_m : float
            Base of that extent (m below its collar).
        cpt_segs : list[BodyLayerPick]
            CPT body-layer picks in this group.
        geotech_layer_by_inv_depth : dict
            ALL CPT geotech layers keyed by investigation id string.
        cpt_xy : dict[UUID, tuple[float, float, float]]
            CPT ``(x, y, surface elevation)`` keyed by id.
        cpt_names : dict[UUID, str]
            CPT display names keyed by id.

        Returns
        -------
        list[DonorStack]
            One stack per eligible CPT, each carrying that CPT's litho extent
            and the packing bands it read inside it.
        """
        picks_by_cpt: dict[str, list[BodyLayerPick]] = defaultdict(list)
        for cpt_seg in cpt_segs:
            picks_by_cpt[cpt_seg.investigation_id].append(cpt_seg)

        donors: list[DonorStack] = []
        for cpt_inv, picks in picks_by_cpt.items():
            cpt_uuid = UUID(cpt_inv)
            location = cpt_xy.get(cpt_uuid)
            if location is None:
                self.warning(
                    f"DivideBoreholes: CPT={cpt_inv} has no XY location — "
                    "excluded from the donor set (its distance to the borehole is unknowable)"
                )
                continue
            x_m, y_m, cpt_surface_elev = location

            # Pick the segment that overlaps the borehole's extent most, in
            # ELEVATION — depths below two different collars are not comparable,
            # and the whole point is "the same geological interval over there".
            # Ties (no overlap at all included) break on the thicker segment and
            # then on depth, so the choice never depends on dict order.
            bh_top_elev = bh_surface_elev - geo_top_m
            bh_base_elev = bh_surface_elev - geo_base_m
            best_pick = max(
                picks,
                key=lambda p: (
                    max(
                        0.0,
                        min(bh_top_elev, cpt_surface_elev - p.top_depth_m)
                        - max(bh_base_elev, cpt_surface_elev - p.base_depth_m),
                    ),
                    p.base_depth_m - p.top_depth_m,
                    -p.top_depth_m,
                ),
            )
            in_extent = sorted(
                (
                    entry
                    for entry in geotech_layer_by_inv_depth.get(cpt_inv, [])
                    if entry[0] >= best_pick.top_depth_m - _DEPTH_OVERLAP_EPS
                    and entry[1] <= best_pick.base_depth_m + _DEPTH_OVERLAP_EPS
                    and entry[4] is not None
                ),
                key=lambda entry: entry[0],
            )
            if not in_extent:
                continue
            donors.append(
                DonorStack(
                    investigation_id=cpt_inv,
                    name=cpt_names.get(cpt_uuid, cpt_inv),
                    extent_top_m=best_pick.top_depth_m,
                    extent_base_m=best_pick.base_depth_m,
                    bands=tuple(
                        # nad_class is not None — the comprehension filtered it.
                        # The layer id rides along because an accepted packing
                        # tie names bands by it.
                        DonorBand(
                            top_m=top,
                            base_m=base,
                            nad_class=int(nad_class or 0),
                            layer_id=str(lid),
                        )
                        for top, base, lid, _fid, nad_class, _bid in in_extent
                    ),
                    map_distance_m=((x_m - bh_x) ** 2 + (y_m - bh_y) ** 2) ** 0.5,
                )
            )
        # No distance gate here: the candidate set is already only the
        # flanking tests (owner, 2026-08-17), and a flank is a flank however far
        # away it is — there is nothing between it and the borehole.
        return donors

    # ------------------------------------------------------------------
    # Persistence — transcribe a planned segment into rows
    # ------------------------------------------------------------------

    async def _persist_planned_segment(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        segment: PlannedBoreholeSegment,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ],
        borehole_fill_bands: dict[str, list[Band]],
        donor_hops: list[tuple[UUID, UUID, UUID, str, float]],
    ) -> None:
        """Write one planned segment's bands as ``litho_layer`` rows.

        Decides nothing: every depth, class, provenance and body id comes off
        the plan unchanged.  The only thing resolved here is the band's geotech
        ``geological_formation`` (find-or-create on the plan's
        ``(nad_class, source litho, source geo)`` triple), which is an identity
        lookup rather than a geological choice.

        Confidence: ``cpt_interpolated`` → high; ``body_min`` / ``absolute_min``
        → low (see ``_BOREHOLE_CONFIDENCE_MAP``); the plan already applied that
        map, so this reads it off ``PlannedBand.confidence``.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        geotech_model_id : UUID
            Geotech model to write into.
        segment : PlannedBoreholeSegment
            The planned bands for one (body group, borehole) pair.
        classified_by_key : dict
            In-memory find-or-create cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory find-or-create cache for skeleton formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified formation ids created (mutated).
        geotech_layer_by_inv_depth : dict
            Per-investigation layer index (mutated) — the freshly written
            borehole bands are appended so the tie re-anchor and the
            borehole-mediated edge derivation can see them.
        borehole_fill_bands : dict[str, list[Band]]
            Per-borehole accumulator for the Phase-9 sample assignment (mutated).
        donor_hops : list[tuple[UUID, UUID, UUID, str]]
            Accumulator (mutated) of ``(section_id, donor_band_id,
            borehole_band_id, borehole_investigation_id, borehole_band_top_m)``
            — the borehole hops the fraction rescale licensed, ready for
            Phase 8.5 to write as accepted edges.
        """
        for band in segment.bands:
            # All planned nad_class values are concrete (no None) — the fill
            # helper always emits the weakest observed class or the absolute
            # minimum, never a None sentinel.  Route every band through
            # _find_or_create_classified (not the skeleton branch).
            formation = await self._find_or_create_formation(
                project_id=project_id,
                classified_by_key=classified_by_key,
                skeleton_by_key=skeleton_by_key,
                created_formation_ids=created_formation_ids,
                nad_class=band.nad_class,
                source_litho_formation_id=band.source_litho_formation_id,
                source_geo_formation_id=band.source_geo_formation_id,
            )
            layer = LithoLayerOrm(
                id=uuid7(),
                model_id=geotech_model_id,
                formation_id=formation.id,
                depth_top_m=band.depth_top_m,
                depth_base_m=band.depth_base_m,
                status="accepted",
                source="segmenter",
                confidence=band.confidence,
                borehole_id=segment.borehole_id,
                body_id=band.body_id,
            )
            self._session.add(layer)
            geotech_layer_by_inv_depth[segment.investigation_id].append(
                (
                    band.depth_top_m,
                    band.depth_base_m,
                    layer.id,
                    formation.id,
                    band.nad_class,
                    band.body_id,
                )
            )
            # Phase 9 (sample assignment) needs the complete per-borehole
            # picture, across every body group the column spans.
            borehole_fill_bands[segment.investigation_id].append(
                Band(
                    top=band.depth_top_m,
                    base=band.depth_base_m,
                    body_id=str(band.body_id) if band.body_id is not None else None,
                    nad_class=band.nad_class,
                    source=band.source,
                )
            )
