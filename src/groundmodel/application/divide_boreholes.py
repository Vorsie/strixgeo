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
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol, TypeVar
from uuid import UUID

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.body_separation_reanchor import BodySeparationReanchor
from groundmodel.application.body_union_reanchor import BodyUnionReanchor
from groundmodel.application.geotech_band_edit_constants import MANUAL_BAND_SOURCE
from groundmodel.application.geotech_band_edit_helpers import _parse_admixtures
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.geotech_crossing_sweep import sweep_crossing_ties
from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    band_at_contact,
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
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.application.section_membership import (
    load_investigation_labels,
    load_investigation_names,
    load_members_by_section,
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
    depth_aware_flanks,
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
from groundmodel.domain.services.geotech_span_splitting import (
    SpanColumn,
    SpanTie,
    crossings_through_banded_range,
    split_span,
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
from groundmodel.domain.services.litho_geo_bounding import mark_and_truncate_shallow_tests
from groundmodel.domain.services.nad_admixture_choice import resolve_admixture_variant
from groundmodel.domain.services.nad_classification_constants import Variant
from groundmodel.domain.services.nad_classifier import (
    clamp_class_to_soil,
    loosest_class_for,
    remap_class_to_variant,
    resolve_variant,
    soil_family_of,
)
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
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


class _BoreholeAnchored(Protocol):
    """A captured item whose two anchors expose their kind + band identity.

    Both :class:`~groundmodel.application.geotech_tie_reanchor.CapturedTie` and
    :class:`~groundmodel.application.body_separation_reanchor.CapturedSeparation`
    satisfy this structurally, so the borehole-scope filter below serves both.

    Members are read-only (``@property``) so the FROZEN dataclasses that
    implement them match: a plain annotated Protocol member is read-write, which
    a frozen field cannot satisfy.
    """

    @property
    def anchor_kind_a(self) -> str: ...
    @property
    def anchor_kind_b(self) -> str: ...
    @property
    def identity_a(self) -> BandIdentity: ...
    @property
    def identity_b(self) -> BandIdentity: ...


_BoreholeAnchoredT = TypeVar("_BoreholeAnchoredT", bound=_BoreholeAnchored)


def _filter_by_borehole_scope(
    items: list[_BoreholeAnchoredT], keys: set[str], *, require_in: bool
) -> list[_BoreholeAnchoredT]:
    """Keep captured items with a borehole anchor whose column is in/out of ``keys``.

    DivideBoreholes rebuilds only the borehole bands, so only rows anchored on a
    rebuilt borehole column are at risk of the cascade — a row whose sole touched
    anchor's row survives must NOT be re-created (it would be doubled). Both the
    geotech-tie and the body-separation captures need the identical subset /
    skipped filter, differing only in element type, so it lives here once
    (extract-on-second-copy).

    Parameters
    ----------
    items : list[_BoreholeAnchoredT]
        Captured ties or separations.
    keys : set[str]
        Stringified borehole investigation ids to match against.
    require_in : bool
        ``True`` keeps an item with a borehole anchor whose column is IN ``keys``
        (the subset filter — these columns are being rebuilt); ``False`` keeps an
        item with a borehole anchor whose column is NOT in ``keys`` (the skipped
        filter — these columns are being spared).

    Returns
    -------
    list[_BoreholeAnchoredT]
        The kept items, order preserved.
    """

    def kept(item: _BoreholeAnchoredT) -> bool:
        return (
            item.anchor_kind_a == ANCHOR_BOREHOLE
            and (item.identity_a.investigation_id in keys) == require_in
        ) or (
            item.anchor_kind_b == ANCHOR_BOREHOLE
            and (item.identity_b.investigation_id in keys) == require_in
        )

    return [item for item in items if kept(item)]


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
    # The borehole's OWN accepted litho band this band fills within — the
    # covering litho band stamped onto ``parent_litho_layer_id`` so the
    # Parameters tree can place the band under its litho body. ``None`` when the
    # segment spans no single litho layer (a conservative fill over the whole
    # body extent). Additive default keeps every existing construction site
    # working and the preview/commit wire schema stable.
    source_litho_layer_id: UUID | None = None


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
    the columns sharing its body.  Three constraints are hard.  A donor must be
    the SAME SOIL — his litho ties may legitimately cross facies, but a packing
    class belongs to a soil column, and a silt donor on a sand layer would put
    a SILT class inside a ZAND unit (Data Integrity Rule 3).  A donor must
    FLANK the borehole on a section.  And elevation picks the sheet.

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
        if own_soil_code is None or soil_by_formation.get(pick.formation_id) != own_soil_code:
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


_WEAKEST_FIRST = ("absolute_min", "body_min", "column_min", "layer_inherited")
"""Provenance tags ordered weakest-first, for a merge that must not upgrade."""


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
    skipped_existing_borehole_ids: tuple[str, ...] = ()

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
    skipped_existing_borehole_count : int
        Boreholes imported as-is because they already carried bands
        (owner ruling 2026-08-18, ``skip_existing`` — first subdivision wins).
    superseded_jump_tie_count : int
        Bridged CPT↔CPT jump ties deleted because the borehole-mediated chain
        now carries the same connection (owner ruling 2026-08-14: the chain
        REPLACES the jump tie — hand-drawn or machine, accepted or pending).
    replaced_span_count : int
        Accepted ties spanning columns that NOW have data at the line, replaced
        by chains landing on those columns' nearest contacts (owner ruling
        2026-08-17 night). Sub-TD spans are kept — there the span is the only
        way the statement can be made.
    deleted_crossing_span_count : int
        Accepted CPT↔CPT ties DELETED because they still passed through a
        borehole's own banded range after the split (owner ruling 2026-08-24:
        *"if no hops can be made, you just auto delete the crossing
        correlation"*).  Sub-TD spans are not counted here — they are kept.
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
    skipped_existing_borehole_count: int = 0
    crossing_tie_count: int = 0
    replaced_span_count: int = 0
    deleted_crossing_span_count: int = 0


@dataclass(frozen=True)
class SpanPassCounts:
    """What the Phase 8.6 span pass did, in its two halves.

    Parameters
    ----------
    replaced : int
        Spanning ties replaced by a chain of hops at columns with data.
    deleted_crossings : int
        Surviving CPT↔CPT ties deleted for still crossing a borehole inside
        its banded range (owner ruling 2026-08-24).
    """

    replaced: int
    deleted_crossings: int


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
        skip_existing: bool = False,
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

        # Owner ruling 2026-08-18 (*"does this test already have a subdivision?
        # if yes import and skip"*): a borehole divided once — usually before
        # the tie section — is imported as-is, so a later press on a section
        # that shares it can never tell a second story. The set feeds the
        # planner's segment filter AND execute's delete/capture exclusions.
        #
        # NARROWED by the owner ruling 2026-08-23 (*"you only decide how the
        # boreholes get divided after user review"*): what first-subdivision-
        # wins protects is the ENGINEER's work, not the machine's first guess.
        #
        # This verb derives ties of its own AFTER placing its bands, so a
        # borehole's first pass is necessarily planned against a thinner tie
        # set than the one the engineer ends up approving. Skipping every
        # already-banded borehole froze that first guess permanently: pressing
        # 4 again was a no-op and the only escape was Clear subdivision, one
        # column at a time. Measured on the dev model the day of the ruling,
        # 126-B8 kept a single NAD 6 band over 10.97-16.00 m where a re-plan
        # reads 6/5/7/6/8 — and a CPT-to-CPT span survived across it purely
        # because a mid-band crossing has no contact to land on.
        #
        # So the skip is keyed on HAND EVIDENCE: any band the engineer touched
        # carries ``source='manual'``, stamped by every band-edit writer
        # (set-class, split, merge, move-boundary, move-restated-contact). A
        # purely machine-placed borehole is re-planned and picks up the review;
        # a touched one is imported as-is, exactly as before.
        skip_set: set[UUID] = set()
        if skip_existing:
            skip_set = {
                row
                for (row,) in (
                    await self._session.execute(
                        select(LithoLayerOrm.borehole_id)
                        .where(
                            LithoLayerOrm.model_id == geotech_model.id,
                            LithoLayerOrm.borehole_id.is_not(None),
                            LithoLayerOrm.source == MANUAL_BAND_SOURCE,
                        )
                        .distinct()
                    )
                ).all()
            }
        skipped_existing_ids: set[str] = set()

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
                skipped_existing_borehole_ids=tuple(sorted(skipped_existing_ids)),
            )

        min_thickness_m = await read_geotech_min_thickness_m(self._session, project_id)
        geo_surfaces = await self._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        lowest_sampler = self._make_lowest_boundary_sampler(geo_surfaces)

        # NOTHING cuts the picks at a geological surface (owner, 2026-08-26 —
        # "just drop the wall everywhere, user wil have to manually do it"). The
        # shallow flag is informational and truncates nothing.
        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        divided = shallow.picks
        self.debug(
            f"DivideBoreholes: {len(divided)} litho segment(s) uncut across "
            f"{len(geo_surfaces)} geological surface(s)"
        )

        # Phase 4 — LABEL each segment with its geological unit and group by
        # (body_id, source_geo_formation_id). The label is derived, never a cut.
        groups = self._group_segments(divided, geo_surfaces)

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
                # A missing collar (NULL) falls back to a 0 m datum; a surveyed
                # collar of exactly 0.0 m TAW is a real value and must NOT be
                # conflated with "no elevation" (owner ruling 2026-08-28). The
                # explicit ``is not None`` guards against that — ``or 0.0``
                # would map a real 0.0 collar through the same fallback branch.
                surface_elev = cr.elevation_m if cr.elevation_m is not None else 0.0
                cpt_xy[cr.id] = (cr.location_x, cr.location_y, surface_elev)
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
        # The columns immediately left and right of each borehole, per layer
        # window, unioned over every section it appears on. Owner ruling,
        # 2026-08-17: only these may donate, so adjacency replaces the old
        # distance cap. Refined 2026-08-18 after B2's sand came back as one
        # band: *"If there are no cpt data below TD, then you look to the next
        # cpt over ofcourse. Close cpt where there is data, further away below
        # TD."* — the walk (``depth_aware_flanks``) is therefore run per LAYER
        # at the donor-pick site below; only the section orderings and the
        # per-column banded elevation extents are prepared here.
        ordered_columns_by_section: list[list[str]] = [
            [inv for inv, _along in sorted(placement.along_m.items(), key=lambda item: item[1])]
            for placement in section_placements
        ]
        banded_extent_by_inv: dict[str, tuple[float, float]] = {}
        for extent_inv, extent_rows in geotech_layer_by_inv_depth.items():
            extent_surf = cpt_xy.get(UUID(extent_inv))
            if not extent_rows or extent_surf is None:
                continue
            banded_extent_by_inv[extent_inv] = (
                extent_surf[2] - min(r[0] for r in extent_rows),
                extent_surf[2] - max(r[1] for r in extent_rows),
            )

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

        for (body_id_str, source_geo_fid, litho_fid_str), group_segs in groups.items():
            # The group IS one litho unit — the key carries its formation, so
            # this cannot be the formation of a neighbouring unit welded into
            # the same body (owner 2026-09-11, his b13 glauconitic sand).
            source_litho_fid = UUID(litho_fid_str)

            in_scope_bh_segs = [
                s
                for s in group_segs
                if anchor_kind.get(s.investigation_id) == "borehole"
                # A subset run leaves every other borehole exactly as it is —
                # planned, deleted and written are all filtered by this one set.
                and (borehole_ids is None or UUID(s.investigation_id) in borehole_ids)
            ]
            # First subdivision wins (owner 2026-08-18): an already-banded
            # borehole leaves the plan here, so it is neither re-planned nor
            # (via execute's exclusions) deleted.
            skipped_existing_ids.update(
                s.investigation_id for s in in_scope_bh_segs if UUID(s.investigation_id) in skip_set
            )
            borehole_segs = [
                s for s in in_scope_bh_segs if UUID(s.investigation_id) not in skip_set
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
            # As above: a real 0.0 m TAW collar is a value, not "no elevation";
            # only a NULL collar takes the 0 m datum fallback (owner ruling
            # 2026-08-28).
            bh_xy: dict[UUID, tuple[float, float, float]] = {
                br.id: (
                    br.location_x,
                    br.location_y,
                    br.elevation_m if br.elevation_m is not None else 0.0,
                )
                for br in bh_rows
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
            # Owner ruling 2026-09-04: the engineer's persisted NAD-family answer
            # forces the floor's column too, so a borehole floor lands in the
            # same family the CPT bands do. NULL → no override (unchanged).
            admixture_choice = (
                source_litho_orm.nad_admixture_choice if source_litho_orm is not None else None
            )
            variant_override = resolve_admixture_variant(
                soil_code, unit_admixtures, admixture_choice
            )
            litho_abs_min_class = (
                loosest_class_for(soil_code, unit_admixtures, variant_override=variant_override)
                if soil_code
                else None
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

            # The receiver unit's OWN NAD column (owner 2026-09-13). A donor CPT
            # lends its class number, which encodes the donor's family; the lend
            # must land in the family this borehole's litho unit actually is, so
            # a clean sand flanked by silt-/kleihoudend CPTs stays clean. Past
            # the guard ``soil_code`` is a known family, so this is concrete.
            receiver_variant = resolve_variant(soil_code, unit_admixtures, variant_override)

            self.debug(
                f"DivideBoreholes: group body={body_id_str} "
                # The litho unit, not just the body: two admixture variants of
                # one soil share a body, and a log that names only the body
                # cannot show which of them a band belongs to.
                f"litho_formation={source_litho_fid} "
                f"soil={soil_code} admixtures={unit_admixtures or '-'} "
                f"abs_min_nad={litho_abs_min_class} "
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
                # The segment names its litho body through its LAYER rather than
                # directly. Until 2026-08-26 that was forced — the geological cut
                # re-stamped body_id on every slice it made. The cut is gone and
                # the segment now carries the resolver's own body id, but the
                # layer stays the source of truth here: it is the row the donor
                # rules, the correlations and the flank pass all key on.
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

                layer_top_elev = bh_elev - (geo_top if unit_layer is None else unit_layer[1])
                layer_base_elev = bh_elev - (geo_base if unit_layer is None else unit_layer[2])
                layer_flanks: set[str] = set()
                for section_columns in ordered_columns_by_section:
                    layer_flanks |= depth_aware_flanks(
                        inv_id,
                        ordered_columns=section_columns,
                        kind_of=anchor_kind,
                        banded_extent_by_inv=banded_extent_by_inv,
                        window_top_elev_m=layer_top_elev,
                        window_base_elev_m=layer_base_elev,
                        min_data_m=min_thickness_m,
                    )
                unit_cpt_segs = layer_donor_picks(
                    correlated,
                    cpt_layer_picks_by_body.get(unit_body_id or "", []),
                    own_soil_code=soil_code,
                    soil_by_formation=litho_soil_by_formation,
                    layer_top_elev_m=layer_top_elev,
                    layer_base_elev_m=layer_base_elev,
                    flanking_investigations=layer_flanks,
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
                    unit_soil_code=soil_code,
                    soil_by_formation=litho_soil_by_formation,
                    section_partitions=section_partitions,
                    geotech_formation_info=geotech_formation_info,
                    replaced_tie_pairs=replaced_tie_pairs,
                    preferred_section_id=str(section_id) if section_id is not None else None,
                    receiver_variant=receiver_variant,
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
                                # Every band on this segment fills within ONE
                                # borehole litho layer (``unit_layer``), so that
                                # layer is the covering litho band the tree needs.
                                # ``None`` when the slice spans no single layer.
                                source_litho_layer_id=(
                                    unit_layer[0] if unit_layer is not None else None
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
            raised = apply_column_floor([entry[2] for entry in entries])
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
            skipped_existing_borehole_ids=tuple(sorted(skipped_existing_ids)),
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

    async def _resolve_spanning_ties(
        self,
        *,
        geotech_model_id: UUID,
        project_id: UUID,
        borehole_ids: set[UUID] | None,
    ) -> SpanPassCounts:
        """Split accepted spanning ties, then delete what still crosses data.

        The application half of
        :mod:`~groundmodel.domain.services.geotech_span_splitting` — load,
        judge, write the chain, delete the span, report.  Runs after Phase 8.5
        has written the borehole bands and BEFORE the dedup and the crossing
        sweep, so both passes judge the post-split model.

        Two rulings in sequence.  First (2026-08-17) the split: a span over a
        column that HAS data at the line becomes the chain of hops that column
        expresses.  Then (2026-08-24) the sweep: *"if no hops can be made, you
        just auto delete the crossing correlation"* — whatever the split left
        standing that still passes through a borehole's own banded range is
        deleted, because it welds one body straight across bands that disagree
        with it and the fill draws that weld.  Sub-TD spans survive both: there
        the borehole says nothing at that depth, and the span is the only way
        the statement can be made.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model just divided.
        project_id : UUID
            Its project — the section placements live per project.
        borehole_ids : set[UUID] | None
            The run's borehole scope.  Only a borehole this press could have
            divided is grounds for deleting a tie; ``None`` = every borehole.

        Returns
        -------
        SpanPassCounts
            How many spans were replaced by chains and how many surviving
            CPT↔CPT ties were deleted for crossing a banded borehole.  Both 0
            in the ordinary no-spans case.
        """
        await self._session.flush()
        band_rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    LithoLayerOrm.formation_id,
                ).where(LithoLayerOrm.model_id == geotech_model_id)
            )
        ).all()
        # The soil each band carries — the landing guard needs the SEAM soils
        # (band above, band below) so a sand span cannot land on a clay top.
        soil_by_formation: dict[UUID, str | None] = {
            formation_row.id: formation_row.litho_main_soil_code
            for formation_row in (
                await self._session.execute(
                    select(GeologicalFormationOrm.id, GeologicalFormationOrm.litho_main_soil_code)
                )
            ).all()
        }
        stacks: dict[str, list[tuple[float, float, UUID, str | None]]] = defaultdict(list)
        for row in band_rows:
            stacks[str(row.cpt_id or row.borehole_id)].append(
                (row.depth_top_m, row.depth_base_m, row.id, soil_by_formation.get(row.formation_id))
            )
        for stack in stacks.values():
            stack.sort()

        def _column_seams(
            stack: list[tuple[float, float, UUID, str | None]],
        ) -> tuple[tuple[float, ...], tuple[tuple[str | None, str | None], ...]]:
            """Every contact on the column with its (above, below) soils."""
            contacts: list[float] = []
            soils: list[tuple[str | None, str | None]] = []
            for index, (top, _base, _band_id, soil) in enumerate(stack):
                contacts.append(top)
                soils.append((stack[index - 1][3] if index > 0 else None, soil))
            if stack:
                contacts.append(stack[-1][1])
                soils.append((stack[-1][3], None))
            return tuple(contacts), tuple(soils)

        placements = await self._load_section_placements(project_id)
        placement_by_section = {UUID(pl.section_id): pl for pl in placements}
        collar_rows = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.name, CptOrm.elevation_m).where(
                    CptOrm.app_project_id == project_id
                )
            )
        ).all()
        bh_rows = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.name, BoreholeOrm.elevation_m).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all()
        collars = {
            str(row.id): row.elevation_m
            for row in [*collar_rows, *bh_rows]
            if row.elevation_m is not None
        }
        # Names, not ids, in the deletion warnings: the engineer has to be able
        # to find the tie he lost in the section without a database round-trip.
        names = {str(row.id): row.name for row in [*collar_rows, *bh_rows]}

        # ALL edges, not accepted-only: the dedup registry below must know the
        # PENDING rows too, or a chain piece collides with a machine proposal
        # already occupying the same (pair, sides) slot at the flush.
        all_edges = (
            (
                await self._session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                    )
                )
            )
            .scalars()
            .all()
        )
        edges = [edge for edge in all_edges if edge.user_approved]
        band_home = {
            str(band_id): (inv, top, base)
            for inv, stack in stacks.items()
            for top, base, band_id, _soil in stack
        }

        def _endpoint_seam_soils(
            inv: str, band_id: UUID, side: str
        ) -> tuple[str | None, str | None] | None:
            """The (above, below) soils of the seam a tie endpoint names."""
            stack = stacks.get(inv, [])
            index = next((i for i, entry in enumerate(stack) if entry[2] == band_id), None)
            if index is None:
                return None
            if side == "top":
                return (stack[index - 1][3] if index > 0 else None, stack[index][3])
            return (stack[index][3], stack[index + 1][3] if index + 1 < len(stack) else None)

        existing_sided: dict[tuple[UUID, UUID, str, str], LithoContactCorrelationEdgeOrm] = {}
        for edge in all_edges:
            a, b = edge.layer_a_id, edge.layer_b_id
            existing_sided[
                (a, b, edge.layer_a_side, edge.layer_b_side)
                if a < b
                else (b, a, edge.layer_b_side, edge.layer_a_side)
            ] = edge

        def node_to_surface(inv: str, depth: float) -> tuple[UUID, str] | None:
            """The (band, side) owning a contact depth on a column."""
            resolved = band_at_contact(
                [(top, base, band_id) for top, base, band_id, _soil in stacks.get(inv, [])], depth
            )
            return resolved

        def _span_columns(
            placement: SectionPlacement, endpoints: tuple[str, str]
        ) -> list[SpanColumn]:
            """Every column of a section, as the span geometry needs to see it."""
            columns: list[SpanColumn] = []
            for inv, along in placement.along_m.items():
                if inv not in collars and inv not in endpoints:
                    continue
                seam_depths, seam_soils = _column_seams(stacks.get(inv, []))
                columns.append(
                    SpanColumn(
                        investigation_id=inv,
                        along_m=along,
                        collar_elev_m=collars.get(inv, 0.0),
                        contacts_m=seam_depths,
                        deepest_base_m=(
                            max(b for _t, b, _i, _s in stacks[inv]) if stacks.get(inv) else None
                        ),
                        contact_soils=seam_soils,
                    )
                )
            return columns

        replaced = 0
        pieces_created = 0
        doomed_spans: list[UUID] = []
        for edge in edges:
            home_a = band_home.get(str(edge.layer_a_id))
            home_b = band_home.get(str(edge.layer_b_id))
            if home_a is None or home_b is None:
                continue
            placement = placement_by_section.get(edge.section_id)
            if placement is None:
                continue
            depth_a = home_a[1] if edge.layer_a_side == "top" else home_a[2]
            depth_b = home_b[1] if edge.layer_b_side == "top" else home_b[2]
            columns = _span_columns(placement, (home_a[0], home_b[0]))
            plan = split_span(
                SpanTie(
                    edge_id=edge.id,
                    inv_a=home_a[0],
                    depth_a_m=depth_a,
                    inv_b=home_b[0],
                    depth_b_m=depth_b,
                    soils_a=_endpoint_seam_soils(home_a[0], edge.layer_a_id, edge.layer_a_side),
                    soils_b=_endpoint_seam_soils(home_b[0], edge.layer_b_id, edge.layer_b_side),
                ),
                columns,
            )
            if plan is None:
                continue
            maybe_surfaces = [node_to_surface(node.investigation_id, node.depth_m) for node in plan]
            surfaces = [surface for surface in maybe_surfaces if surface is not None]
            if len(surfaces) != len(maybe_surfaces):
                # A landing that resolves to no real contact would leave a hole
                # in the chain — keep the span rather than lose the statement.
                self.warning(
                    f"DivideBoreholes: span {edge.id} not split — a landing "
                    f"resolved to no contact; the span stands"
                )
                continue
            # The span may only die when EVERY hop slot ends ACCEPTED — the
            # 2026-08-15 ruling stands: approved information must never ride
            # on pending rows. A slot already held by a pending machine
            # proposal is PROMOTED (the accepted-tie-evicts-a-pending-proposal
            # precedent): the piece re-expresses an accepted statement, so the
            # proposal for its exact surfaces becomes that statement.
            queued: list[tuple[UUID, UUID, str, str]] = []
            promotions: list[LithoContactCorrelationEdgeOrm] = []
            for (band_a, side_a), (band_b, side_b) in zip(surfaces, surfaces[1:]):
                if band_a == band_b:
                    continue  # defensive; adjacent nodes sit on different columns
                key = (
                    (band_a, band_b, side_a, side_b)
                    if band_a < band_b
                    else (band_b, band_a, side_b, side_a)
                )
                held = existing_sided.get(key)
                if held is not None and held.id == edge.id:
                    held = None  # the span itself is not a carrier of its pieces
                if held is None and key not in queued:
                    queued.append(key)
                elif held is not None and not held.user_approved:
                    promotions.append(held)
            for key in queued:
                existing_sided[key] = LithoContactCorrelationEdgeOrm(
                    id=uuid7(),
                    model_id=geotech_model_id,
                    section_id=edge.section_id,
                    layer_a_id=key[0],
                    layer_b_id=key[1],
                    layer_a_side=key[2],
                    layer_b_side=key[3],
                    source="auto",
                    user_approved=True,
                )
                self._session.add(existing_sided[key])
                pieces_created += 1
            for held in promotions:
                held.user_approved = True
                pieces_created += 1
            doomed_spans.append(edge.id)
            replaced += 1

        if doomed_spans:
            await self._session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id.in_(doomed_spans)
                )
            )
            self.info(
                f"DivideBoreholes: Phase 8.6 — {replaced} spanning tie(s) replaced by "
                f"{pieces_created} chain piece(s) at columns with data; sub-TD spans kept"
            )

        deleted_crossings = await self._delete_ties_crossing_banded_boreholes(
            geotech_model_id=geotech_model_id,
            borehole_ids=borehole_ids,
            band_rows=band_rows,
            band_home=band_home,
            placement_by_section=placement_by_section,
            span_columns=_span_columns,
            names=names,
        )
        self.info(
            f"DivideBoreholes: Phase 8.6 done — replaced={replaced} pieces={pieces_created} "
            f"crossing_ties_deleted={deleted_crossings}"
        )
        return SpanPassCounts(replaced=replaced, deleted_crossings=deleted_crossings)

    async def _delete_ties_crossing_banded_boreholes(
        self,
        *,
        geotech_model_id: UUID,
        borehole_ids: set[UUID] | None,
        band_rows: Sequence[Any],
        band_home: dict[str, tuple[str, float, float]],
        placement_by_section: dict[UUID, SectionPlacement],
        span_columns: Callable[[SectionPlacement, tuple[str, str]], list[SpanColumn]],
        names: dict[str, str],
    ) -> int:
        """Delete every surviving CPT↔CPT tie that crosses a banded borehole.

        Owner ruling 2026-08-24: *"i also had to manually deleted a correlation
        spanning a borehole from cpt to cpt over borehole, write a check that
        checks if all those are gone after divide boreholes"* and *"if no hops
        can be made, you just auto delete the crossing correlation, user will
        notice something weird in the fill if he/she needs to subdivide"*.

        The split above is the first answer; this is the second.  The edges are
        re-read from the database, so the verdict is passed on the POST-split
        model: the spans the split consumed are already gone, and a chain piece
        it wrote that itself jumps a borehole the line could not land on is
        judged like any other tie.

        Sub-TD ties are untouched — deliberately.  Where the borehole's bands
        stop above the line it says nothing at that depth, so the span is the
        only way the correlation can be stated at all, and deleting it would
        destroy a statement rather than replace one.

        Parameters
        ----------
        geotech_model_id : UUID
            The geotech model just divided.
        borehole_ids : set[UUID] | None
            The run's borehole scope; ``None`` = every borehole.
        band_rows : Sequence[Any]
            The model's geotech band rows, used to tell CPT columns from
            borehole columns.
        band_home : dict[str, tuple[str, float, float]]
            Band id → (column id, top depth, base depth).
        placement_by_section : dict[UUID, SectionPlacement]
            Along-positions per section — a tie is judged on its OWN section.
        span_columns : Callable
            Builds the section's columns for the span geometry.
        names : dict[str, str]
            Column id → display name, for the deletion warnings.

        Returns
        -------
        int
            How many ties were deleted.  0 when nothing crosses.
        """
        cpt_invs = {str(row.cpt_id) for row in band_rows if row.cpt_id is not None}
        crossable = {str(row.borehole_id) for row in band_rows if row.borehole_id is not None}
        if borehole_ids is not None:
            # A borehole this press did not divide is not this press's business:
            # its bands are whatever an earlier run left, and the engineer's tie
            # over them was not invalidated by anything that happened here.
            crossable &= {str(b) for b in borehole_ids}
        if not crossable or not cpt_invs:
            self.info(
                "DivideBoreholes: Phase 8.6 crossing sweep skipped — "
                f"crossable_boreholes={len(crossable)} banded_cpts={len(cpt_invs)}"
            )
            return 0

        await self._session.flush()
        surviving = (
            (
                await self._session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == geotech_model_id,
                        LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )

        self.info(
            f"DivideBoreholes: Phase 8.6 crossing sweep over {len(surviving)} accepted tie(s), "
            f"crossable_boreholes={len(crossable)} "
            f"(scope={'ALL' if borehole_ids is None else len(borehole_ids)})"
        )
        doomed: list[UUID] = []
        unplaced = 0
        total = len(surviving)
        for index, edge in enumerate(surviving, 1):
            home_a = band_home.get(str(edge.layer_a_id))
            home_b = band_home.get(str(edge.layer_b_id))
            if home_a is None or home_b is None:
                continue
            if home_a[0] not in cpt_invs or home_b[0] not in cpt_invs:
                continue  # only a CPT↔CPT tie can pass OVER a borehole
            placement = placement_by_section.get(edge.section_id)
            if placement is None:
                # No column geometry for the tie's own section: the crossing is
                # not judgeable, so the tie stands.
                unplaced += 1
                continue
            crossings = crossings_through_banded_range(
                SpanTie(
                    edge_id=edge.id,
                    inv_a=home_a[0],
                    depth_a_m=home_a[1] if edge.layer_a_side == "top" else home_a[2],
                    inv_b=home_b[0],
                    depth_b_m=home_b[1] if edge.layer_b_side == "top" else home_b[2],
                ),
                span_columns(placement, (home_a[0], home_b[0])),
                crossable_ids=crossable,
            )
            if not crossings:
                continue
            for crossing in crossings:
                bh_name = names.get(crossing.investigation_id, crossing.investigation_id)
                self.warning(
                    f"[{index}/{total}] DivideBoreholes: deleting tie {edge.id} — "
                    f"{names.get(home_a[0], home_a[0])} <-> {names.get(home_b[0], home_b[0])} "
                    f"crosses borehole {bh_name} at elevation "
                    f"{crossing.crossing_elev_m:.2f} m, inside its banded range; "
                    f"no hop could be made there (source={edge.source}, section={edge.section_id})"
                )
            doomed.append(edge.id)

        if doomed:
            await self._session.execute(
                delete(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id.in_(doomed)
                )
            )
        self.info(
            f"DivideBoreholes: Phase 8.6 crossing sweep — {len(doomed)} CPT-to-CPT tie(s) "
            f"deleted for crossing a banded borehole out of {total} accepted tie(s) "
            f"(unplaced_sections={unplaced}); sub-TD spans kept"
        )
        return len(doomed)

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
            Rows of ``(section_id, layer_a_id, layer_b_id, layer_a_side,
            layer_b_side)``.  Unapproved
            proposals are excluded by the query: only what the engineer accepted
            may steer where a borehole's packing comes from.
        """
        rows = (
            await self._session.execute(
                select(
                    LithoContactCorrelationEdgeOrm.section_id,
                    LithoContactCorrelationEdgeOrm.layer_a_id,
                    LithoContactCorrelationEdgeOrm.layer_b_id,
                    # The sides travel too (audit P1-2): a base↔base tie names
                    # a DIFFERENT seam than a top↔top one between the same
                    # bands, and dropping the side re-declared the engineer's
                    # correlation one contact up.
                    LithoContactCorrelationEdgeOrm.layer_a_side,
                    LithoContactCorrelationEdgeOrm.layer_b_side,
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
            ``(section_id, layer_a_id, layer_b_id, layer_a_side,
            layer_b_side)`` rows from :meth:`_load_accepted_tie_rows`.
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
        for section_id, layer_a_id, layer_b_id, layer_a_side, layer_b_side in rows:
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
                    side_a=layer_a_side,
                    side_b=layer_b_side,
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
        skip_existing: bool = False,
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
            skip_existing=skip_existing,
        )
        # First subdivision wins (owner 2026-08-18): the boreholes the planner
        # imported as-is must be excluded from the delete AND from the tie
        # capture below — their rows never die, so re-created ties would double.
        skipped_bh = {UUID(x) for x in plan.skipped_existing_borehole_ids}
        geotech_model_id = plan.geotech_model_id
        if plan.pick_count == 0:
            await self._session.commit()
            return DivideBoreholeResult(
                geotech_model_id=geotech_model_id,
                skipped_existing_borehole_count=len(plan.skipped_existing_borehole_ids),
                divided_borehole_count=0,
                single_band_borehole_count=0,
                layer_count=0,
                created_formation_ids=[],
            )

        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it.
        # ``ResolveLithoInstances`` below takes this same lock, but by then this
        # transaction has already DELETEd every borehole band and re-inserted
        # them — so those writes raced the debounced background
        # ``bodies/recompute``, which UPDATEs ``litho_layer.body_id`` stamps over
        # the same rows in a different order (owner dogfeed 2026-08-23:
        # DeadlockDetectedError on ``DELETE FROM litho_layer``). Placed after
        # ``plan`` so its 404 guard has already run and the model id is known —
        # a request about to be rejected must not queue behind a live writer —
        # and after the no-op early return, which writes nothing. The lock is
        # re-entrant per session, so the resolver's later acquisition is free.
        await lock_body_partition(
            self._session, model_id=geotech_model_id, operation="divide-boreholes"
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

        # Only the borehole bands are wiped here, so only rows with a borehole
        # anchor on a rebuilt column are at risk of the cascade: keep the subset's
        # columns (borehole_ids) and drop the spared ones (skipped_bh). Re-creating
        # a row whose only touched anchor's row survived would double it. The same
        # scope filter serves ties and separations (``_filter_by_borehole_scope``).
        tie_reanchor = GeotechTieReanchor(self._session)
        captured_ties = await tie_reanchor.capture(
            geotech_model_id, restrict_to_anchor_kind=ANCHOR_BOREHOLE
        )
        # Carry the engineer's "Separate" rulings across the same rebuild (#278 R5).
        sep_reanchor = BodySeparationReanchor(self._session)
        captured_separations = await sep_reanchor.capture(
            geotech_model_id, restrict_to_anchor_kind=ANCHOR_BOREHOLE
        )
        # And the engineer's "Join with…" rulings, the same way (debt #278).
        union_reanchor = BodyUnionReanchor(self._session)
        captured_unions = await union_reanchor.capture(
            geotech_model_id, restrict_to_anchor_kind=ANCHOR_BOREHOLE
        )
        if borehole_ids is not None:
            subset_keys = {str(b) for b in borehole_ids}
            captured_ties = _filter_by_borehole_scope(captured_ties, subset_keys, require_in=True)
            captured_separations = _filter_by_borehole_scope(
                captured_separations, subset_keys, require_in=True
            )
            captured_unions = _filter_by_borehole_scope(
                captured_unions, subset_keys, require_in=True
            )
        if skipped_bh:
            skipped_keys = {str(b) for b in skipped_bh}
            captured_ties = _filter_by_borehole_scope(captured_ties, skipped_keys, require_in=False)
            captured_separations = _filter_by_borehole_scope(
                captured_separations, skipped_keys, require_in=False
            )
            captured_unions = _filter_by_borehole_scope(
                captured_unions, skipped_keys, require_in=False
            )

        # Phase 7 — delete existing borehole geotech layers (subset-scoped when
        # the caller named the boreholes to divide).
        delete_conditions = [
            LithoLayerOrm.model_id == geotech_model_id,
            LithoLayerOrm.borehole_id.is_not(None),
        ]
        if borehole_ids is not None:
            delete_conditions.append(LithoLayerOrm.borehole_id.in_(borehole_ids))
        if skipped_bh:
            delete_conditions.append(LithoLayerOrm.borehole_id.not_in(skipped_bh))
        deleted = (
            await self._session.execute(delete(LithoLayerOrm).where(*delete_conditions))
        ).rowcount
        self.info(f"DivideBoreholes: deleted {deleted} prior borehole geotech layer(s)")

        # Phase 8 (write half) — transcribe the plan into rows, in plan order.
        classified_by_key: dict[tuple[int, UUID], GeologicalFormationOrm] = {}
        skeleton_by_key: dict[tuple[UUID], GeologicalFormationOrm] = {}
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
        divide_rebuilt_bands = rebuilt_bands_from_layer_index(geotech_layer_by_inv_depth)
        reanchor_plan = await tie_reanchor.reanchor(
            geotech_model_id=geotech_model_id,
            captured=captured_ties,
            rebuilt_bands=divide_rebuilt_bands,
            borehole_bands_are_final=True,
        )
        # Re-anchor the "Separate" rulings against the SAME bands, BEFORE the
        # Phase 8.5 re-resolve below, so that resolve honours the restored
        # separations (debt #278 R5). ``divide_rebuilt_bands`` carries both the
        # untouched CPT bands (a CPT anchor matches its own unchanged band) and
        # the freshly-written borehole bands (what a borehole anchor needs).
        await sep_reanchor.reanchor(
            model_id=geotech_model_id,
            captured=captured_separations,
            rebuilt_bands=divide_rebuilt_bands,
        )
        # And the "Join with…" rulings against the same bands (debt #278).
        await union_reanchor.reanchor(
            model_id=geotech_model_id,
            captured=captured_unions,
            rebuilt_bands=divide_rebuilt_bands,
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
        # Per-section membership (owner ruling 2026-08-25: "yeah make it section
        # scoped ofcourse"). A hop is only derivable between two columns THIS
        # section draws; the litho edge table still carries pre-2026-08-03 rows
        # that name a column past the end of the line.
        members_by_section = await load_members_by_section(
            self._session,
            project_id=project_id,
            section_ids=[section.id for section in sections],
        )
        for section in sections:
            edge_sets = await load_approved_litho_edge_sets(
                self._session,
                litho_model_id,
                section.id,
                section_member_investigation_ids=members_by_section.get(section.id, set()),
                litho_layer_depths=litho_layer_depths,
            )
            off_section = edge_sets.off_section_investigations
            if off_section:
                # NAMES, at INFO: these hops are born ACCEPTED, so a mis-scoped
                # one would enter the model as if the engineer had drawn it.
                # The line says which column stopped it and why.
                self.info(
                    f"DivideBoreholes: section={section.id} ({section.name!r}) excluded "
                    f"{len(off_section)} litho-tie endpoint column(s) it does not draw: "
                    f"{await load_investigation_labels(self._session, off_section)}"
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

        # ------------------------------------------------------------------ #
        # Phase 8.6 — split spanning ties at the columns that now have data.  #
        #                                                                      #
        # Owner rulings, 2026-08-17 night: "The ties i manually made spanning  #
        # both boreholes aren't replaced by hops but never deleted. You can    #
        # delete user correlations spanning 2 boreholes. If the borehole has   #
        # data, otherwise it is a subTD tie."  A tie is a straight line in     #
        # (along, elevation) space; at every intermediate column whose bands   #
        # reach the line, it lands on the nearest packing contact and          #
        # continues — the chain this verb was always expected to leave behind. #
        # Sub-TD stretches keep their span: there the span is the only way     #
        # the statement can be made.  The pieces are born ACCEPTED (they       #
        # re-express a correlation that was already accepted) and machine-     #
        # owned (source='auto'); the original span is deleted, no tombstone —  #
        # this is the model's housekeeping, not his judgement.                 #
        #                                                                      #
        # Then, 2026-08-24: "if no hops can be made, you just auto delete the  #
        # crossing correlation, user will notice something weird in the fill   #
        # if he/she needs to subdivide."  What the split leaves standing and   #
        # still runs through a borehole's own banded range is deleted — the    #
        # invariant this verb now guarantees is that NO accepted CPT-to-CPT    #
        # tie passes through data that disagrees with it.  Sub-TD stays.       #
        # ------------------------------------------------------------------ #
        span_counts = await self._resolve_spanning_ties(
            geotech_model_id=geotech_model_id,
            project_id=project_id,
            borehole_ids=borehole_ids,
        )
        replaced_span_count = span_counts.replaced

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
        # A deleted crossing tie also has to re-resolve: it REMOVED connectivity
        # (the split's chains preserve it by construction, the delete does not),
        # so a body welded across the borehole by that tie must fall apart here
        # rather than at whatever later verb happens to resolve next.
        if edge_totals.edges_emitted or hops_written or span_counts.deleted_crossings:
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
        # Retire the vocabulary this run stopped using. Phase 7 deleted every
        # borehole band in scope and the re-plan re-created only the classes
        # the fresh donors produced, so a class that dropped out leaves its
        # formation with nothing in it. After the flush so the re-created bands
        # are visible to the survivor check — otherwise a unit this very run
        # rebuilt would read as unreferenced and be deleted out from under it.
        await OrphanFormationSweep(self._session).sweep_geotech_units(project_id)

        # Debt #266 — record which litho stack each rebuilt borehole column's
        # bands came from. Only the boreholes this run actually planned: a
        # borehole ``skip_existing`` protected (it carries hand evidence) keeps
        # its old provenance, because its bands really were made from the older
        # stack, and every CPT column keeps the provenance SubdivideAllBodies
        # gave it. After the sweep so the map is folded against the bands that
        # survive the transaction, and before the single commit.
        geotech_model = await self._session.get(GeologicalModelOrm, geotech_model_id)
        if geotech_model is not None:
            await self._stamp_litho_provenance(
                geotech_model=geotech_model,
                litho_model_id=litho_model_id,
                rebuilt_column_ids={segment.investigation_id for segment in plan.segments},
            )

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
            skipped_existing_borehole_count=len(plan.skipped_existing_borehole_ids),
            crossing_tie_count=crossing_dropped,
            replaced_span_count=replaced_span_count,
            deleted_crossing_span_count=span_counts.deleted_crossings,
        )
        self.success(
            f"DivideBoreholes: geotech_model={geotech_model_id} "
            f"divided_bh={divided_borehole_count} "
            f"single_bh={single_band_borehole_count} "
            f"layers={total_layers} "
            f"borehole_ties_reanchored={len(reanchor_plan.matched)}/{len(captured_ties)} "
            f"borehole_ties_lost={len(reanchor_plan.lost)} "
            f"spans_replaced={replaced_span_count} "
            f"crossing_spans_deleted={span_counts.deleted_crossings} "
            f"unclassified_foreign_family={self._family_clamp_count} "
            f"elapsed={elapsed:.1f}s"
        )
        if self._family_clamp_count:
            # Never let a press that dropped classes read like a clean one. The
            # per-band WARNINGs above name each unit and its soil; this is the
            # count to notice in a log that scrolls.
            self.warning(
                f"DivideBoreholes: {self._family_clamp_count} band(s) left unclassified "
                "because the only class offered belonged to another soil family — see the "
                "per-band warnings above for which units and set them by hand"
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
        preferred_section_id: str | None = None,
        unit_soil_code: str | None = None,
        soil_by_formation: Mapping[str, str | None] | None = None,
        receiver_variant: Variant | None = None,
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

        # A lent donor class carries the DONOR'S NAD family (clean vs
        # silt-/kleihoudend), and a borehole's own litho unit may be a different
        # family (owner 2026-09-13, B2: a clean sand rendered ZAND(f) because its
        # silty flanks lent it a with-admixture class). The lend carries only the
        # packing LEVEL and lands it in the RECEIVER'S own column; a borehole
        # whose unit truly is silty (``receiver_variant == "secondary"``) keeps
        # the secondary classes, and ``None`` (the family-clamp pins' call shape)
        # is a no-op. Applied at every class SOURCE below — before coarsen, the
        # body_min statistic and the merge — so the whole pipeline reasons in the
        # receiver's family and same-level bands coalesce correctly.
        def _lend_class(nad_class: int) -> int:
            if receiver_variant is None:
                return nad_class
            return remap_class_to_variant(nad_class, receiver_variant)

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
        ) or select_flank_donors(
            borehole_id=inv_id,
            donors=donors,
            sections=section_placements,
            # Owner ruling 2026-08-18: a SCOPED divide reads the flanks of the
            # section the engineer is editing — he judges the classes on the
            # section he is looking at. Unscoped runs keep tightest-pair.
            preferred_section_id=preferred_section_id,
        )
        donor_surfaces = flank_packing_surfaces_with_donors(
            selection, extent_top_m=derive_top_m, extent_base_m=derive_base_m
        )
        cpt_packing_surfaces = [(s.top, s.base, _lend_class(s.nad_class)) for s in donor_surfaces]
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
            _lend_class(nc)
            for layers in filtered_cpt_layers.values()
            for (_t, _b, _lid, _fid, nc, _bid) in layers
            if nc is not None
        ]
        # min() over classes ALREADY re-mapped into the receiver's column, so the
        # weakest is the weakest LEVEL, not the smallest number across two
        # columns (clean 8 vs secondary 9 would otherwise read 8 = "loosest").
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
            unit_soil_code=unit_soil_code,
            soil_by_formation=soil_by_formation,
        )
        if tied is not None and receiver_variant is not None:
            # A tied hop continues a donor CPT band, so its class is the donor's
            # too — re-map it into the receiver's own column before anything else
            # reads it (owner 2026-09-13).
            tied = replace(
                tied,
                bands=[replace(b, nad_class=_lend_class(b.nad_class)) for b in tied.bands],
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
                unit_soil_code=unit_soil_code,
            )
        if sampled is not None and receiver_variant is not None:
            # The region carries the donor CPT's class + family; re-map it into
            # the receiver's own column before the conservative fill and the
            # correspondence pass read it (owner 2026-09-13).
            sampled = replace(
                sampled,
                bands=[replace(b, nad_class=_lend_class(b.nad_class)) for b in sampled.bands],
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
        unit_soil_code: str | None = None,
        soil_by_formation: Mapping[str, str | None] | None = None,
    ) -> UnitTiePlacement | None:
        """Lay this litho unit's packing boundaries on the borehole, from the TIES.

        Owner's rule, 2026-08-16, revised 2026-08-18 ("go for the mtaw").  A
        boundary that is a litho contact is already on the borehole and is
        never interpolated; a tied interior boundary lands where the drawn
        tie LINE crosses the column, in elevation; a lens or onlap only when
        the borehole stands within half the gap of the column that declared
        it, flat at its own elevation.

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
        unit_soil_code : str | None
            The litho unit's soil.  A tie endpoint band of another soil never
            places a boundary here (Data Integrity Rule 3), and the
            neighbouring band each boundary names is the nearest SAME-SOIL
            one.  ``None`` = unknown, no filtering.
        soil_by_formation : Mapping[str, str | None] | None
            Soil code per formation id, for the filter above.

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
            fraction = (bh_along - left_along) / width

            def _same_soil(formation_id: object) -> bool:
                if unit_soil_code is None or not soil_by_formation:
                    return True
                soil = soil_by_formation.get(str(formation_id))
                return soil is None or soil == unit_soil_code

            def _tie_boundary(inv: str, layer_id: str, side: str) -> ColumnBoundary | None:
                """The tie endpoint as a boundary on its OWN column, in mTAW.

                Resolved from the band the tie names — not from the one pick
                the flank machinery keeps per column, because the endpoint may
                live in ANOTHER litho unit of the same body (B2, 2026-08-18:
                the left column's silt interbed splits its sand, and both VD
                ties start from the lower unit while the pick was the upper).
                The neighbouring band on each face is the nearest SAME-SOIL
                one — a cross-soil interbed is a lens inside the mass, not
                what continues past this line.
                """
                collar_pick = picks.get(inv)
                if collar_pick is None:
                    return None
                rows = sorted(geotech_layer_by_inv_depth.get(inv, []), key=lambda r: r[0])
                index = next((i for i, r in enumerate(rows) if str(r[2]) == layer_id), None)
                if index is None or not _same_soil(rows[index][3]):
                    return None
                depth = rows[index][0] if side == "top" else rows[index][1]

                def _walk(candidates: Sequence[tuple[Any, ...]]) -> str | None:
                    return next(
                        (str(r[2]) for r in candidates if _same_soil(r[3]) and r[4] is not None),
                        None,
                    )

                if side == "top":
                    above = _walk(list(reversed(rows[:index])))
                    below: str | None = str(rows[index][2])
                else:
                    above = str(rows[index][2])
                    below = _walk(rows[index + 1 :])
                return ColumnBoundary(
                    elev_m=collar_pick.surface_elev_m - depth,
                    band_above_id=above,
                    band_below_id=below,
                )

            tie_left_bounds: list[ColumnBoundary] = []
            tie_right_bounds: list[ColumnBoundary] = []
            # The (left band, right band) layer-id pair per tie, so the
            # replaced-tie report names the ORIGINAL rows (audit P1-2).
            tie_layer_pairs: list[tuple[str, str]] = []
            for tie in accepted_ties:
                if tie.section_id != placement.section_id:
                    continue
                pair = {
                    tie.investigation_a: (tie.layer_a_id, tie.side_a),
                    tie.investigation_b: (tie.layer_b_id, tie.side_b),
                }
                if left_id not in pair or right_id not in pair:
                    continue
                left_layer, left_side = pair[left_id]
                right_layer, right_side = pair[right_id]
                left_boundary = _tie_boundary(left_id, left_layer, left_side)
                right_boundary = _tie_boundary(right_id, right_layer, right_side)
                if left_boundary is None or right_boundary is None:
                    continue
                tie_left_bounds.append(left_boundary)
                tie_right_bounds.append(right_boundary)
                tie_layer_pairs.append((left_layer, right_layer))

            # One-sided constructs still come from the flank picks — but a
            # pick seam that IS a tie endpoint (same column, same elevation)
            # is the tie's, not an onlap.
            tie_elevs_left = {b.elev_m for b in tie_left_bounds}
            tie_elevs_right = {b.elev_m for b in tie_right_bounds}
            left_bounds = [
                b
                for b in _interior_boundaries(left_stack, picks[left_id])
                if not any(abs(b.elev_m - e) < _DEPTH_TOL_M for e in tie_elevs_left)
            ]
            right_bounds = [
                b
                for b in _interior_boundaries(right_stack, picks[right_id])
                if not any(abs(b.elev_m - e) < _DEPTH_TOL_M for e in tie_elevs_right)
            ]

            placed = sorted(
                [
                    *place_unit_boundaries(
                        tie_left_bounds,
                        tie_right_bounds,
                        [(i, i) for i in range(len(tie_left_bounds))],
                        fraction=fraction,
                        unit_top_m=geo_top_m,
                        unit_base_m=geo_base_m,
                        bh_collar_elev_m=bh_surface_elev,
                    ),
                    *place_unit_boundaries(
                        left_bounds,
                        right_bounds,
                        [],
                        fraction=fraction,
                        unit_top_m=geo_top_m,
                        unit_base_m=geo_base_m,
                        bh_collar_elev_m=bh_surface_elev,
                    ),
                ],
                key=lambda b: b.depth_m,
            )

            # The class map must know every band a boundary names — tie
            # endpoints (and their walked neighbours) can sit outside the
            # flank picks' windows.
            referenced = {
                x
                for b in placed
                for x in (
                    b.left_band_above_id,
                    b.left_band_below_id,
                    b.right_band_above_id,
                    b.right_band_below_id,
                )
                if x is not None
            }
            known = {str(b[0]) for b in [*left_stack, *right_stack]}
            extra_rows = [
                (row[2], row[0], row[1], row[4])
                for inv in (left_id, right_id)
                for row in geotech_layer_by_inv_depth.get(inv, [])
                if str(row[2]) in referenced and str(row[2]) not in known
            ]
            class_left = sorted([*left_stack, *extra_rows], key=lambda b: b[1])
            class_right = right_stack

            bands, correspondences = _bands_between(
                placed,
                class_left,
                class_right,
                geo_top_m,
                geo_base_m,
                fraction,
            )
            if not bands:
                continue
            best_width = width
            best = UnitTiePlacement(
                bands=bands,
                correspondences=correspondences,
                replaced_tie_layer_pairs=[tie_layer_pairs[i] for i in replaced_tie_indices(placed)],
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
        unit_soil_code: str | None = None,
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
        unit_soil_code : str | None
            Main soil of the litho unit this borehole segment belongs to. A
            region whose packing class belongs to a DIFFERENT soil family is
            not read (owner ruling 2026-08-26: *"no a zand body can never
            carry a silt packing class"*). ``None`` — the caller has no soil
            to offer — reads every region, because with no family there is
            nothing to judge one against.

        Returns
        -------
        GeometrySampling | None
            The bands and their per-band correspondence, or ``None`` when the
            geometry cannot answer here (no partition for the section, the
            borehole outside every gap, a bracketing column absent from this
            body group, a degenerate frame, or every cut belonging to another
            soil).  ``None`` means the caller falls back to the donor rule
            rather than inventing anything.
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
                region_class = int(info[0])
                if clamp_class_to_soil(region_class, unit_soil_code) is None:
                    # Owner ruling 2026-08-26: *"no a zand body can never carry
                    # a silt packing class"*. The 2-D fill legitimately floods
                    # a neighbouring soil across a gap when a conflict suspends
                    # the ties in it (the owner's B8, 2026-08-24) — but that
                    # flood is a statement about the OTHER soil, so it is not
                    # evidence about the unit this borehole stands in. Drop the
                    # cut; the conservative filler below closes the stretch the
                    # same way it closes any ground no column spoke for.
                    self.info(
                        f"DivideBoreholes: borehole={inv_id} "
                        f"section={placement.section_name} "
                        f"[{band.depth_top_m:.2f},{band.depth_base_m:.2f}]m — region class "
                        f"{region_class} is {soil_family_of(region_class)}, this unit is "
                        f"{unit_soil_code}; not read (left to the column floor)"
                    )
                    continue
                bands.append(
                    FillBand(
                        top=band.depth_top_m,
                        base=band.depth_base_m,
                        nad_class=region_class,
                        source="cpt_interpolated",
                    )
                )
                correspondences.append(band.layer_ids)
            if not usable or not bands:
                # Every cut here belonged to another soil, so the geometry has
                # nothing to say about this column. The donor rule still does.
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
        classified_by_key: dict[tuple[int, UUID], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID], GeologicalFormationOrm],
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
            # Every planned nad_class is concrete — the fill helper emits the
            # weakest observed class or the absolute minimum, never a None
            # sentinel — so the classified branch is the normal outcome. The
            # find-or-create can still answer with a skeleton when the planned
            # class belongs to another soil family, which is the one case a
            # planned band is written unclassified.
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
                # The covering litho band this borehole band fills within — the
                # plan carries it verbatim (decides nothing here), so the tree
                # can place the band under its litho body.
                parent_litho_layer_id=band.source_litho_layer_id,
            )
            self._session.add(layer)
            # The formation is the authority on the class that was actually
            # stamped — the materialiser's soil-family clamp can answer with a
            # skeleton where the plan named a class of another soil, and every
            # consumer of this index must see the band as it was written.
            geotech_layer_by_inv_depth[segment.investigation_id].append(
                (
                    band.depth_top_m,
                    band.depth_base_m,
                    layer.id,
                    formation.id,
                    formation.nad_class,
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
                    nad_class=formation.nad_class,
                    source=band.source,
                )
            )
