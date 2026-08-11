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
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_band_edit_helpers import _parse_admixtures
from groundmodel.application.geotech_borehole_materialiser import GeotechBoreholeMaterialiser
from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    bridge_edges_over_bandless_columns,
    derive_geotech_edges_from_litho,
    load_approved_litho_edges,
    load_existing_geotech_edge_pairs_by_section,
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
from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
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
    flank_packing_surfaces,
    select_flank_donors,
)
from groundmodel.domain.services.borehole_packing_fill import (
    FillBand,
    fill_borehole_litho_body_extent,
)
from groundmodel.domain.services.geotech_tie_donors import (
    AcceptedTie,
    select_tie_informed_donors,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.litho_geo_bounding import (
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.domain.services.nad_classifier import loosest_class_for
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
    section_name : str | None
        Section the donors were read along; ``None`` outside the flank modes.
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
    section_name: str | None = None


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

    async def plan(
        self,
        *,
        project_id: UUID,
        litho_model_id: UUID,
        borehole_ids: set[UUID] | None = None,
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

        # Phase 3 — load litho body picks and geo-bound them.
        picks = await self._litho_repo.load_body_picks(litho_model_id)
        self.info(f"DivideBoreholes: {len(picks)} pick(s) in litho model")
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
        geo_surfaces = await self._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        boundary_sampler = self._make_boundary_sampler(geo_surfaces)
        lowest_sampler = self._make_lowest_boundary_sampler(geo_surfaces)

        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        divided = divide_picks_by_geology(shallow.picks, boundary_sampler, snap_tol)
        self.debug(f"DivideBoreholes: {len(divided)} geo-bounded segment(s)")

        # Phase 4 — group by (body_id, source_geo_formation_id).
        groups = await self._group_segments(divided, geo_surfaces)
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

                (
                    fill_band_list,
                    fill_band_body_ids,
                    selection,
                ) = self._plan_borehole_bands_litho_confined(
                    inv_id=inv_id,
                    bh_x=bh_x,
                    bh_y=bh_y,
                    bh_surface_elev=bh_elev,
                    geo_top_m=geo_top,
                    geo_base_m=geo_base,
                    cpt_segs=cpt_segs,
                    litho_abs_min_class=litho_abs_min_class,
                    geotech_layer_by_inv_depth=geotech_layer_by_inv_depth,
                    cpt_xy=cpt_xy,
                    cpt_names=cpt_names,
                    section_placements=section_placements,
                    accepted_ties=accepted_ties,
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
                                section_name=(
                                    selection.section_name
                                    if fb.source == "cpt_interpolated"
                                    else None
                                ),
                            )
                            for fb, body_id in zip(fill_band_list, fill_band_body_ids)
                        ),
                    )
                )

        self.info(
            f"DivideBoreholes.plan: geotech_model={geotech_model.id} "
            f"segments={len(planned_segments)} bands={total_layers} "
            f"divided={divided_borehole_count} single={single_band_borehole_count}"
        )
        return DivideBoreholePlan(
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
        self.info(
            f"DivideBoreholes: start project={project_id} litho_model={litho_model_id} "
            f"boreholes={'ALL' if borehole_ids is None else len(borehole_ids)}"
        )

        plan = await self.plan(
            project_id=project_id, litho_model_id=litho_model_id, borehole_ids=borehole_ids
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
        litho_layer_depths = await load_litho_layer_depths(self._session, litho_model_id, None)
        sections = await load_project_sections(self._session, project_id)
        edge_totals = EdgeDerivationCounts()
        for section in sections:
            approved = await load_approved_litho_edges(self._session, litho_model_id, section.id)
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
                )
            )
        self.info(
            f"DivideBoreholes: Phase 8.5 — {edge_totals.edges_emitted} borehole-mediated "
            f"geotech edge(s) added (skipped_empty_stack={edge_totals.skipped_empty_stack}, "
            f"skipped_no_lcs={edge_totals.skipped_no_lcs})"
        )

        # Re-run the resolver over the geotech model so body_id spans the newly
        # connected borehole chains. This is what fixes an orphan borehole band
        # (body_id NULL because no same-class CPT sat in its group) — once it is
        # edge-connected to a CPT band, the resolver puts them in one body.
        if edge_totals.edges_emitted:
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
        cpt_segs: list[BodyLayerPick],
        litho_abs_min_class: int,
        geotech_layer_by_inv_depth: dict[
            str, list[tuple[float, float, UUID, UUID, int | None, UUID | None]]
        ],
        cpt_xy: dict[UUID, tuple[float, float, float]],
        cpt_names: dict[UUID, str],
        section_placements: list[SectionPlacement],
        accepted_ties: Sequence[AcceptedTie] = (),
    ) -> tuple[list[FillBand], list[UUID | None], FlankSelection]:
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

        Returns
        -------
        tuple[list[FillBand], list[UUID | None], FlankSelection]
            ``(fill_bands, fill_band_body_ids, selection)`` — the bands to
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
        cpt_packing_surfaces = flank_packing_surfaces(
            selection, extent_top_m=geo_top_m, extent_base_m=geo_base_m
        )
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
            extent_top=geo_top_m,
            extent_base=geo_base_m,
            cpt_packing_surfaces=cpt_packing_surfaces,
            body_min_class=body_min_class,
            litho_abs_min_class=litho_abs_min_class,
        )

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

        # A single band is no longer proof that no CPT spoke: a donor that reads
        # one packing class across the whole unit legitimately yields one band.
        self.debug(
            f"_plan_borehole_bands_litho_confined: borehole={inv_id} "
            f"planned {len(fill_bands)} band(s) over [{geo_top_m:.2f},{geo_base_m:.2f}] "
            f"mode={selection.mode} donor_boundaries={len(cpt_packing_surfaces)}"
        )

        return fill_bands, fill_band_body_ids, selection

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
