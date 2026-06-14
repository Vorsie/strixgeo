"""Assemble the implicit-stratigraphic builder's domain inputs from the DB.

This is the application-layer bridge between the persisted lithostratigraphic
model and the pure strat-field domain services (``stratigraphic_order`` →
``control_data`` → ``strat_builder``).  It owns the DB reads — the accepted
body-assigned litho picks (via ``LithoLayerRepository.load_body_picks``) — and
turns them into the value objects the strat builder expects, WITHOUT leaking any
ORM object across the layer boundary.

Mapping (spec ``2026-06-13-implicit-stratigraphic-3d-builder-design.md``, Task 8)
--------------------------------------------------------------------------------
Each :class:`~groundmodel.domain.services.litho_body_pick.BodyLayerPick` is one
member-layer of a resolver body at one investigation.  Grouped by investigation
and sorted top→bottom, the picks become:

* a **Stage-1 column** — a ``tuple[OrderInputUnit, ...]`` per investigation.  The
  topo-sort over the union of columns yields the global stratigraphic order.
* a **Stage-2 column** — an :class:`InvestigationColumn` carrying the same units
  plus the investigation's ``(x, y, surface_elev_m)`` so each contact projects to
  an elevation control point.

The two stages share a **synthetic contact_id** per pick
(``f"{investigation_id}|{body_id}|{top_depth_m:.4f}"``) so the order's
``contact_ids`` line up exactly with the Stage-2 control observations.  The
``instance_key`` is the resolver ``body_id`` — correlated layers across
investigations share it, so they collapse to ONE stratigraphic instance (the
design: a correlated unit is one body lofted across the section).

Section-drawn contacts are NOT threaded in v1 — the borehole/CPT contacts
constrain the field directly; ``section_contacts=[]`` is passed.  Adding drawn
section contacts is a later refinement (it needs the per-section partition's
contact polylines mapped onto strat horizon ids).

The ``domain`` Block reuses the loft pipeline's ``build_model_domain`` (alpha
hull + DEM top + deep base — pure geometry, NOT geological band coupling) to get
the footprint hull, then frames it vertically with a small margin so the caps sit
just outside the data.

``RecomputeLithoSolids`` consumes the result.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.strat_field.control_data import (
    ContactObservation,
    InvestigationColumn,
    build_control_data,
)
from groundmodel.domain.services.strat_field.strat_types import Block, StratControlData
from groundmodel.domain.services.strat_field.stratigraphic_order import (
    OrderInputUnit,
    build_stratigraphic_order,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Vertical margin (metres) added above the highest surface and below the deepest
# pick base so the strat builder's flat top / base caps sit just OUTSIDE the data
# rather than slicing through the shallowest / deepest control point.  1 m is well
# below contact resolution and comfortably clears float-accumulation noise.
_DOMAIN_VERTICAL_MARGIN_M: float = 1.0

# Horizontal margin (metres) the alpha-hull ring is inflated OUTWARD (away from
# its centroid).  The strat builder samples the field on a regular grid and keeps
# only grid CELLS whose four corners all fall inside the domain polygon; the bare
# alpha hull passes exactly through the outermost tests, so with a sparse test set
# (e.g. a 3-point hull = a tight triangle) almost no full cell fits inside and the
# bodies come back empty.  Inflating the ring a few metres past the data gives the
# grid interior cells to fill — the lateral analogue of the vertical cap margin —
# without distorting the hull shape.  10 m sits just past typical investigation
# spacing while staying tight to the data footprint.
_DOMAIN_HORIZONTAL_MARGIN_M: float = 10.0


def _inflate_ring(
    ring: list[tuple[float, float]], margin_m: float
) -> tuple[tuple[float, float], ...]:
    """Push each polygon vertex outward from the ring centroid by ``margin_m``.

    Keeps the ring's SHAPE (each vertex moves radially out from the centroid) so
    the inflated polygon still honours the hull's concavities, just a few metres
    larger.  A degenerate (zero-length) radial for a vertex coincident with the
    centroid is left in place.

    Parameters
    ----------
    ring : list[tuple[float, float]]
        The alpha-hull ring (no repeated last vertex).
    margin_m : float
        Outward offset in metres.

    Returns
    -------
    tuple[tuple[float, float], ...]
        The inflated ring.
    """
    if not ring:
        return ()
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    out: list[tuple[float, float]] = []
    for x, y in ring:
        dx, dy = x - cx, y - cy
        dist = math.hypot(dx, dy)
        if dist < 1e-9:
            out.append((x, y))
            continue
        out.append((x + dx / dist * margin_m, y + dy / dist * margin_m))
    return tuple(out)


def _synthetic_contact_id(pick: BodyLayerPick) -> str:
    """Build the per-pick synthetic contact id shared by both build stages.

    The id must be identical in the Stage-1 ``OrderInputUnit`` and the Stage-2
    ``ContactObservation`` for the same pick so the order's ``contact_ids`` index
    resolves the control point's horizon rank.  Keyed by investigation + body +
    rounded top depth, it is unique per observed contact at an investigation.

    Parameters
    ----------
    pick : BodyLayerPick
        The body member-layer pick.

    Returns
    -------
    str
        ``"{investigation_id}|{body_id}|{top_depth_m:.4f}"``.
    """
    return f"{pick.investigation_id}|{pick.body_id}|{pick.top_depth_m:.4f}"


@dataclass(frozen=True)
class StratAssembly:
    """The assembled implicit-stratigraphic builder inputs.

    Attributes
    ----------
    control : StratControlData
        The Stage-2 control data (its ``.column`` carries the Stage-1 order),
        ready for ``build_strat_model``.
    domain : Block
        The model block framing the solid build (alpha-hull footprint + vertical
        span).  Passed as both the solid ``domain`` and the single field-fit
        block in v1.
    """

    control: StratControlData
    domain: Block


class AssembleStratInputs(GroundModelLogger):
    """Assemble the strat-field builder inputs for one lithostratigraphic model.

    Takes the already-loaded body-assigned picks and returns pure value objects.
    The caller (``RecomputeLithoSolids``) owns the session + transaction boundary
    and has already run ``ResolveLithoInstances`` so ``body_id`` stamps are
    current before the picks are loaded.

    Note: ``assemble`` performs NO DB reads on the current path (it maps the
    picks the caller passes in); the ``session`` is held only for future hooks
    such as sampling a DEM surface for the cap elevations.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session (held for future DB-backed hooks; unused
        by ``assemble`` today).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    def assemble(self, picks: list[BodyLayerPick]) -> StratAssembly | None:
        """Map the model's body picks to the strat builder's control + domain.

        Pure, synchronous mapping over an already-loaded pick set (no DB read —
        the caller loads picks once and shares them with the checksum + the
        no-picks short-circuit).  Returns ``None`` when the picks cannot frame a
        3-D domain (fewer than 3 non-collinear investigations, or no
        deep-reaching test) — the caller flags every body in that case.

        Parameters
        ----------
        picks : list[BodyLayerPick]
            The model's accepted body-assigned picks (one per member-layer).

        Returns
        -------
        StratAssembly | None
            The control data + domain block, or ``None`` when the domain is
            unbuildable.

        Raises
        ------
        NonConformableError
            Propagated from ``build_stratigraphic_order`` when the per-column
            unit orders form a cycle (a fault / unconformity the v1 builder
            cannot model).  The caller catches this and flags the model.
        ValueError
            Propagated from ``build_stratigraphic_order`` on an inconsistent
            ``instance_key`` → ``formation_id`` mapping (a data-model bug).
        """
        self.info(f"AssembleStratInputs: {len(picks)} pick(s)")

        # --- Group picks per investigation, top → bottom ----------------------
        by_inv: dict[str, list[BodyLayerPick]] = defaultdict(list)
        for p in picks:
            by_inv[p.investigation_id].append(p)
        for inv_id in by_inv:
            by_inv[inv_id].sort(key=lambda x: x.top_depth_m)

        # --- Domain block FIRST: can we even frame this model geometrically? ---
        # Cheap to check and the dominant fail mode (< 3 non-collinear tests /
        # no deep test); short-circuit before the semantically loaded topo-sort
        # so an unbuildable domain never discards order/control work.
        domain = self._build_domain(picks)
        if domain is None:
            self.warning(
                "AssembleStratInputs: domain unbuildable "
                f"({len(by_inv)} investigation(s)) — caller will flag every body"
            )
            return None

        # --- Stage-1 columns (order) + Stage-2 columns (control points) -------
        # The synthetic contact_id is computed ONCE per pick and used in both
        # stages so the order's contact_ids resolve the Stage-2 observations.
        stage1_columns: list[tuple[OrderInputUnit, ...]] = []
        stage2_columns: list[InvestigationColumn] = []
        for inv_id, inv_picks in by_inv.items():
            anchor = inv_picks[0]  # all picks at an investigation share (x, y, surface)
            order_units: list[OrderInputUnit] = []
            obs_units: list[ContactObservation] = []
            for p in inv_picks:
                cid = _synthetic_contact_id(p)
                order_units.append(
                    OrderInputUnit(
                        instance_key=p.body_id,
                        formation_id=p.formation_id,
                        contact_id=cid,
                    )
                )
                obs_units.append(
                    ContactObservation(
                        instance_key=p.body_id,
                        formation_id=p.formation_id,
                        contact_id=cid,
                        top_depth_m=p.top_depth_m,
                    )
                )
            stage1_columns.append(tuple(order_units))
            stage2_columns.append(
                InvestigationColumn(
                    investigation_id=inv_id,
                    x=anchor.x_m,
                    y=anchor.y_m,
                    surface_elev_m=anchor.surface_elev_m,
                    units=tuple(obs_units),
                )
            )

        # --- Stage 1 + Stage 2 (may raise NonConformableError) ----------------
        order = build_stratigraphic_order(stage1_columns)
        # Section-drawn contacts are not threaded in v1 — the investigation
        # contacts constrain the field directly (see the module docstring).
        control = build_control_data(stage2_columns, section_contacts=[], order=order)

        self.success(
            f"AssembleStratInputs: {len(stage2_columns)} column(s), "
            f"{len(order.horizons)} horizon(s), {len(control.points)} control point(s)"
        )
        return StratAssembly(control=control, domain=domain)

    # -----------------------------------------------------------------
    # Domain block
    # -----------------------------------------------------------------

    def _build_domain(self, picks: list[BodyLayerPick]) -> Block | None:
        """Frame the strat builder's :class:`Block` from the picks' geometry.

        Builds the loft pipeline's :class:`ModelDomain` (alpha-hull footprint +
        DEM top + deep base — pure geometry, NOT geological band coupling), then
        converts its hull polygon + the picks' elevation extents into a
        :class:`Block` with a small vertical margin so the caps sit just outside
        the data.

        One :class:`DomainTest` is emitted per investigation; its
        ``surface_elev_m`` is the anchor surface and its ``base_elev_m`` is the
        deepest member-layer base elevation at that investigation (the depth
        constraint the domain's deep-base surface interpolates through).

        Parameters
        ----------
        picks : list[BodyLayerPick]
            The model's body picks.

        Returns
        -------
        Block | None
            The domain block, or ``None`` when ``build_model_domain`` cannot
            frame a 3-D domain (fewer than 3 tests, collinear, or no
            deep-reaching test — its ``ValueError`` paths).
        """
        # One DomainTest per investigation, tracking the deepest base elevation.
        surf_by_inv: dict[str, tuple[float, float]] = {}  # inv → (x, y)
        elev_by_inv: dict[str, float] = {}  # inv → surface elevation
        deepest_base_by_inv: dict[str, float] = {}  # inv → deepest base elevation
        for p in picks:
            base_e = p.surface_elev_m - p.base_depth_m
            surf_by_inv[p.investigation_id] = (p.x_m, p.y_m)
            elev_by_inv[p.investigation_id] = p.surface_elev_m
            cur = deepest_base_by_inv.get(p.investigation_id)
            if cur is None or base_e < cur:
                deepest_base_by_inv[p.investigation_id] = base_e

        tests = [
            DomainTest(
                test_id=inv_id,
                x_m=surf_by_inv[inv_id][0],
                y_m=surf_by_inv[inv_id][1],
                surface_elev_m=elev_by_inv[inv_id],
                base_elev_m=deepest_base_by_inv[inv_id],
            )
            for inv_id in surf_by_inv
        ]

        try:
            # No geological band reference → the no-geo deep-reaching fallback
            # (deepest-overall threshold) is used; geology coupling stays OUT of
            # the litho model (spec owner directive 2026-06-13).
            model_domain = build_model_domain(tests, lowest_band_elev_at=None)
        except ValueError as err:
            # Fewer than 3 tests, collinear, or no deep-reaching test — the
            # builder cannot frame a domain.  The caller flags every body.
            self.warning(f"AssembleStratInputs: build_model_domain failed — {err}")
            return None

        # Vertical span: deepest pick base (minus margin) → highest surface
        # (plus margin), so the flat caps clear the extreme control points.
        z_min = min(deepest_base_by_inv.values()) - _DOMAIN_VERTICAL_MARGIN_M
        z_max = max(elev_by_inv.values()) + _DOMAIN_VERTICAL_MARGIN_M

        # Inflate the hull a few metres so the strat builder's grid has interior
        # cells to fill (the bare hull passes through the outermost tests — a
        # sparse hull leaves no full cell inside; see the constant's comment).
        polygon = _inflate_ring(list(model_domain.polygon), _DOMAIN_HORIZONTAL_MARGIN_M)

        return Block(
            polygon=polygon,
            z_min=z_min,
            z_max=z_max,
        )
