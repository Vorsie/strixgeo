"""Detect-bodies use case — pure EXTENT manager over resolver-owned bodies.

The per-instance ``body`` row is owned by ``ResolveLithoInstances`` (the
single authority that CREATES one body per connected component, stamps
``litho_layer.body_id``, and DELETES orphan unnamed bodies). This use case
no longer creates or deletes body rows. It runs the bilateral-closure
detector and writes the detector's ``to_target`` extents onto the
resolver-owned bodies, respecting the provenance rule (never overwriting a
user-claimed extent), and retracts stale ``to_target`` extents when the
latest detection no longer includes a (body, side) closure.

Flush boundary
--------------
This use case calls ``session.flush()`` at the end and does NOT commit.
The caller (``DetectBodies`` endpoint, startup sweep, restore reconcile)
owns the commit boundary so all mutations in a single request land in
one atomic transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.detect_body_extents import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_body_extents,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
)
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_TO_TARGET,
    is_user_claimed_extent_kind,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Default cap (metres) on a detected body's thickness when the project
# has not set its own ``litho_segmenter.max_lens_thickness_m`` (the
# project-level setting is reused — same threshold).  5 m is well above
# a typical thin body but below the near-whole-column spans that loose
# correlations spuriously produce.  Setting the project value to 0
# disables the guard.
BODY_MAX_THICKNESS_DEFAULT_M: float = 5.0


def _resolve_max_thickness(view_state: dict[str, object] | None) -> float | None:
    """Read the body degeneracy-guard threshold from the project's view_state.

    Parameters
    ----------
    view_state : dict[str, object] | None
        The project's ``view_state`` JSONB bag (or ``None``).

    Returns
    -------
    float | None
        ``litho_segmenter.max_lens_thickness_m`` when set to a positive
        value; ``None`` (guard disabled) when the setting is ``0`` /
        non-positive; :data:`BODY_MAX_THICKNESS_DEFAULT_M` when absent.
    """
    seg = (view_state or {}).get("litho_segmenter") if isinstance(view_state, dict) else None
    raw = seg.get("max_lens_thickness_m") if isinstance(seg, dict) else None
    if raw is None:
        return BODY_MAX_THICKNESS_DEFAULT_M
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return BODY_MAX_THICKNESS_DEFAULT_M
    return None if val <= 0 else val


@dataclass
class DetectBodiesResult:
    """Outcome counts for the extent-detection pass.

    The field NAMES are kept stable for frontend compatibility, but their
    meaning is repurposed: this use case no longer creates or deletes body
    rows (the resolver owns body lifecycle) — it manages ``to_target``
    extents on resolver-owned bodies.

    Attributes
    ----------
    bodies_created : int
        Number of bodies that GAINED a ``to_target`` extent on a previously
        empty side this pass (newly-set detector extents).
    bodies_removed : int
        Number of bodies whose stale ``to_target`` extent(s) were CLEARED
        this pass (the latest detection no longer includes that closure).
    bodies_skipped_unresolved_ordinal : int
        Detected closures skipped because the framed layer has no
        resolver-stamped body (the resolver has not run, or the framed
        layer is not an accepted layer).
    """

    bodies_created: int
    bodies_removed: int
    bodies_skipped_unresolved_ordinal: int


class DetectBodies(GroundModelLogger):
    """Manage detector-owned ``to_target`` extents on resolver-owned bodies.

    Reads ``user_approved=True`` contact edges only.  Runs the bilateral-
    closure detector and, for every detected closure, writes the
    ``to_target`` extent onto the body the resolver already stamped on the
    framed layer (``litho_layer.body_id``).  Does NOT create or delete body
    rows — that is the resolver's job (``ResolveLithoInstances``).

    Provenance rule
    ---------------
    The detector NEVER overwrites a user-claimed extent kind
    (``pinch_out_halfway``, ``extrapolated``, ``open``).  It may only
    write or overwrite an extent whose current kind is ``NULL`` or
    ``'to_target'``.

    Stale-extent reconcile
    ----------------------
    For any body that currently carries an ``extent_<side>_kind ==
    'to_target'`` but the latest detection no longer includes that
    (body, side) closure, the side is cleared back to ``NULL``.  This
    retracts stale detector closures.  User-claimed extents are never
    cleared.

    Call ``execute`` AFTER the resolver (``ResolveLithoInstances``) so the
    bodies and their ``litho_layer.body_id`` stamps are current before the
    framed-layer → body look-up.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        prefer_section_id: UUID | None = None,
    ) -> DetectBodiesResult:
        """Run the extent-detection + reconciliation pass.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — used to load cross-section rows for
            ``primary_section_id`` resolution and to read ``view_state``.
        model_id : UUID
            The lithostratigraphic model to run detection on.
        prefer_section_id : UUID | None
            When set, used as the primary section for any body whose two
            anchor investigations are both contained in it.  Falls back to
            the lowest-id section that contains both when not supplied or
            when the preferred section does not span both columns.

        Returns
        -------
        DetectBodiesResult
            Counts of bodies that gained / lost ``to_target`` extents and
            closures skipped for lack of a resolved body.

        Notes
        -----
        This use case flushes but does NOT commit.  The caller owns the
        transaction boundary so all mutations in a single request are
        atomic.
        """
        self.info(f"DetectBodies.execute: model={model_id} prefer_section_id={prefer_section_id}")

        # ------------------------------------------------------------------ #
        # 1. Load all user-approved contact edges for this model.             #
        # ------------------------------------------------------------------ #
        edges_stmt = select(
            LithoContactCorrelationEdgeOrm.contact_a_id,
            LithoContactCorrelationEdgeOrm.contact_b_id,
        ).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.user_approved.is_(True),
        )
        edge_rows = (await self._session.execute(edges_stmt)).all()
        edges = [
            ContactEdge(contact_a_id=r.contact_a_id, contact_b_id=r.contact_b_id) for r in edge_rows
        ]
        self.debug(f"DetectBodies: loaded {len(edges)} approved edge(s)")

        # ------------------------------------------------------------------ #
        # 2. Load contact stacks (model-scoped).                              #
        # ------------------------------------------------------------------ #
        contacts_stmt = select(
            FormationContactOrm.id,
            FormationContactOrm.formation_id,
            FormationContactOrm.cpt_id,
            FormationContactOrm.borehole_id,
            FormationContactOrm.depth_top_m,
        ).where(FormationContactOrm.model_id == model_id)
        contact_rows = (await self._session.execute(contacts_stmt)).all()

        stacks_dict: dict[UUID, list[ContactStackEntry]] = {}
        for r in contact_rows:
            inv_id = r.borehole_id if r.borehole_id is not None else r.cpt_id
            if inv_id is None:
                continue
            stacks_dict.setdefault(inv_id, []).append(
                ContactStackEntry(
                    contact_id=r.id,
                    formation_id=r.formation_id,
                    depth_top_m=r.depth_top_m,
                )
            )
        stacks = [
            ContactStack(investigation_id=inv, entries=tuple(entries))
            for inv, entries in stacks_dict.items()
        ]
        self.debug(
            f"DetectBodies: {len(stacks)} investigation stack(s), "
            f"{len(contact_rows)} contact row(s)"
        )

        # ------------------------------------------------------------------ #
        # 3. Read project view_state for the thickness guard.                 #
        # ------------------------------------------------------------------ #
        view_state = (
            await self._session.execute(
                select(ProjectOrm.view_state).where(ProjectOrm.id == project_id)
            )
        ).scalar_one_or_none()
        max_thickness_m = _resolve_max_thickness(view_state)
        self.debug(f"DetectBodies: max_thickness_m={max_thickness_m} (None = off)")

        # ------------------------------------------------------------------ #
        # 4. Build section→investigation index for primary_section resolution.#
        # ------------------------------------------------------------------ #
        # contact_id → investigation_id mapping from already-loaded contacts.
        contact_inv_map: dict[UUID, UUID | None] = {
            r.id: (r.borehole_id if r.borehole_id is not None else r.cpt_id) for r in contact_rows
        }

        sections_stmt = select(
            CrossSectionOrm.id,
            CrossSectionOrm.seeded_formation_contact_ids,
        ).where(CrossSectionOrm.app_project_id == project_id)
        section_rows = (await self._session.execute(sections_stmt)).all()

        section_inv_index: dict[UUID, set[UUID]] = {}
        for sr in section_rows:
            inv_set: set[UUID] = set()
            for cid in sr.seeded_formation_contact_ids or []:
                inv_id = contact_inv_map.get(cid)
                if inv_id is not None:
                    inv_set.add(inv_id)
            section_inv_index[sr.id] = inv_set

        def _resolve_primary(source_inv: UUID, target_inv: UUID) -> UUID | None:
            """Pick the best section that contains both anchor investigations.

            Parameters
            ----------
            source_inv : UUID
                The source investigation id (body host).
            target_inv : UUID
                One target investigation id (closure side).

            Returns
            -------
            UUID | None
                Section id, or ``None`` when no section spans both.
            """
            if prefer_section_id is not None:
                invs = section_inv_index.get(prefer_section_id, set())
                if source_inv in invs and target_inv in invs:
                    return prefer_section_id
            matches = [
                sid
                for sid, invs in section_inv_index.items()
                if source_inv in invs and target_inv in invs
            ]
            # Deterministic: pick the section with the smallest UUID.
            return min(matches) if matches else None

        # ------------------------------------------------------------------ #
        # 5. Build the active section's along-order + run the detector.       #
        #                                                                      #
        # Body extents are section-scoped (2D): the detector closes each body  #
        # to the NEAREST target on each side along ``prefer_section_id``.  The #
        # ``investigation_along`` map's keys also define which bodies this     #
        # pass owns — only bodies whose SOURCE is on the active section get    #
        # their extents set/reconciled, so detecting on one section never      #
        # overwrites or clears another section's body extents.  When no        #
        # section is supplied (section-less callers / tests) the map is empty: #
        # the detector falls back to UUID ordering and the reconcile stays     #
        # model-wide (legacy behaviour).                                       #
        # ------------------------------------------------------------------ #
        investigation_along = await self._build_section_along(
            project_id=project_id,
            section_id=prefer_section_id,
            investigation_ids=list(stacks_dict.keys()),
        )
        detected = detect_body_extents(
            edges,
            stacks,
            max_body_thickness_m=max_thickness_m,
            investigation_along_positions=investigation_along or None,
        )
        self.debug(
            f"DetectBodies: {len(detected)} candidate(s) from domain algorithm; "
            f"{len(investigation_along)} investigation(s) on section {prefer_section_id}"
        )

        # ------------------------------------------------------------------ #
        # 6. Map framed layer → resolver-stamped body_id (single query).      #
        #                                                                      #
        # Post-A4 the FC↔LL UUID identity holds: a detected closure's framed  #
        # layer is ``d.contact_above_id`` and that id IS a litho_layer.id.    #
        # The resolver (ResolveLithoInstances) has already stamped            #
        # ``litho_layer.body_id`` on every accepted layer; we look the body   #
        # up by that stamp.  A framed layer with no stamped body (resolver    #
        # not run, or layer not accepted) has its closure SKIPPED.            #
        # ------------------------------------------------------------------ #
        body_id_by_layer_rows = (
            await self._session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
        body_id_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in body_id_by_layer_rows}

        # ------------------------------------------------------------------ #
        # 7. Pre-fetch all body rows for this model in ONE query and key by   #
        #    id.  This is the only SELECT against the body table (E1 audit).  #
        # ------------------------------------------------------------------ #
        existing_bodies = (
            (await self._session.execute(select(BodyOrm).where(BodyOrm.model_id == model_id)))
            .scalars()
            .all()
        )
        body_by_id: dict[UUID, BodyOrm] = {b.id: b for b in existing_bodies}
        self.debug(
            f"DetectBodies: pre-fetched {len(body_by_id)} resolver-owned body row(s) "
            "(eliminates N+1 SELECT)"
        )

        # Track which (body, side) pairs the latest detection set as to_target
        # so the reconcile step (step 8) can clear the stale ones that remain.
        detected_to_target_sides: set[tuple[UUID, str]] = set()

        bodies_created = 0
        bodies_skipped_unresolved_ordinal = 0

        for d in detected:
            # The framed layer of the closure is contact_above_id (FC↔LL id).
            body_id = body_id_by_layer.get(d.contact_above_id)
            if body_id is None:
                bodies_skipped_unresolved_ordinal += 1
                self.warning(
                    f"DetectBodies: skipping closure — framed layer "
                    f"{d.contact_above_id} has no resolved body "
                    "(resolver hasn't run, or layer not accepted?)"
                )
                continue

            body = body_by_id.get(body_id)
            if body is None:
                # The stamped body_id points at a row that is gone — treat as
                # unresolved (defensive; the resolver should keep these in sync).
                bodies_skipped_unresolved_ordinal += 1
                self.warning(
                    f"DetectBodies: skipping closure — framed layer "
                    f"{d.contact_above_id} stamped body {body_id} not found in model"
                )
                continue

            # Resolve the primary section using either neighbour as the
            # representative target (bilateral — either side works).
            left_inv = d.extent_left.neighbour_investigation_id if d.extent_left else None
            right_inv = d.extent_right.neighbour_investigation_id if d.extent_right else None
            primary_sid = None
            if left_inv is not None:
                primary_sid = _resolve_primary(d.source_investigation_id, left_inv)
            if primary_sid is None and right_inv is not None:
                primary_sid = _resolve_primary(d.source_investigation_id, right_inv)
            if primary_sid is None and prefer_section_id is not None:
                primary_sid = prefer_section_id

            # Write each side's to_target extent per the provenance rule:
            # - Detector may write a side whose current kind is NULL or
            #   'to_target'.
            # - Detector NEVER touches a user-claimed kind.
            if d.extent_left is not None:
                detected_to_target_sides.add((body.id, "left"))
                if not is_user_claimed_extent_kind(body.extent_left_kind):
                    if body.extent_left_kind is None:
                        bodies_created += 1
                    body.extent_left_kind = EXTENT_KIND_TO_TARGET
                    body.extent_left_target_contact_id = d.extent_left.target_contact_id
                    body.extent_left_neighbour_inv_id = d.extent_left.neighbour_investigation_id
            if d.extent_right is not None:
                detected_to_target_sides.add((body.id, "right"))
                if not is_user_claimed_extent_kind(body.extent_right_kind):
                    if body.extent_right_kind is None:
                        bodies_created += 1
                    body.extent_right_kind = EXTENT_KIND_TO_TARGET
                    body.extent_right_target_contact_id = d.extent_right.target_contact_id
                    body.extent_right_neighbour_inv_id = d.extent_right.neighbour_investigation_id

            # Upgrade primary_section_id when currently NULL.
            if body.primary_section_id is None and primary_sid is not None:
                body.primary_section_id = primary_sid

        # ------------------------------------------------------------------ #
        # 8. Reconcile detector-owned extents (NOT body rows).                #
        #                                                                      #
        # For any body side whose current kind is 'to_target' but the latest  #
        # detection no longer includes that (body, side) closure, CLEAR the   #
        # side back to NULL.  This retracts stale detector closures.  Never   #
        # touch a user-claimed extent.  Never delete a body row — the         #
        # resolver owns the body lifecycle.                                   #
        # ------------------------------------------------------------------ #
        # Section-scoped reconcile: when an active section is supplied, this
        # pass only owns bodies whose SOURCE is on that section.  Without this
        # guard, detecting on Cross-section 1 would clear Cross-section 2's
        # body extents (they are absent from this pass's detection set).  A
        # section-less call (empty map) keeps the legacy model-wide reconcile.
        section_scoped = bool(investigation_along)
        bodies_removed = 0
        for body in body_by_id.values():
            if section_scoped and body.source_investigation_id not in investigation_along:
                continue
            if (
                body.extent_left_kind == EXTENT_KIND_TO_TARGET
                and (body.id, "left") not in detected_to_target_sides
            ):
                body.extent_left_kind = None
                body.extent_left_target_contact_id = None
                body.extent_left_neighbour_inv_id = None
                bodies_removed += 1
                self.debug(f"DetectBodies: cleared stale to_target left extent on body {body.id}")
            if (
                body.extent_right_kind == EXTENT_KIND_TO_TARGET
                and (body.id, "right") not in detected_to_target_sides
            ):
                body.extent_right_kind = None
                body.extent_right_target_contact_id = None
                body.extent_right_neighbour_inv_id = None
                bodies_removed += 1
                self.debug(f"DetectBodies: cleared stale to_target right extent on body {body.id}")

        # Flush — the caller commits the outer transaction.
        await self._session.flush()
        self.success(
            f"DetectBodies: extents_set={bodies_created} "
            f"extents_cleared={bodies_removed} "
            f"skipped_no_resolved_body={bodies_skipped_unresolved_ordinal}"
        )
        return DetectBodiesResult(
            bodies_created=bodies_created,
            bodies_removed=bodies_removed,
            bodies_skipped_unresolved_ordinal=bodies_skipped_unresolved_ordinal,
        )

    async def _build_section_along(
        self,
        *,
        project_id: UUID,
        section_id: UUID | None,
        investigation_ids: list[UUID],
    ) -> dict[UUID, float]:
        """Project the model's investigations onto a section line → along map.

        Mirrors ``AutoCorrelateContactEdges._section_along_adjacency`` — the
        same projection that defines the section-editor's left-to-right column
        order — so body detection and auto-correlation share one notion of
        "along the section".

        Parameters
        ----------
        project_id : UUID
            Scope guard for the section lookup.
        section_id : UUID | None
            The active cross-section.  ``None`` (a section-less call) returns an
            empty map, which makes the detector fall back to UUID ordering and
            the reconcile stay model-wide (legacy behaviour).
        investigation_ids : list[UUID]
            The investigations carrying contacts in this model (the stack keys).

        Returns
        -------
        dict[UUID, float]
            investigation_id → along-section distance (metres) for every
            in-corridor, non-excluded investigation.  Empty when ``section_id``
            is ``None``, the section is not in the project, or no investigation
            projects within the corridor.
        """
        if section_id is None or not investigation_ids:
            return {}
        section = (
            await self._session.execute(
                select(CrossSectionOrm).where(
                    CrossSectionOrm.id == section_id,
                    CrossSectionOrm.app_project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if section is None:
            return {}

        endpoints = SectionEndpoints(
            start_x=section.start_x,
            start_y=section.start_y,
            end_x=section.end_x,
            end_y=section.end_y,
        )
        excluded = set(section.excluded_cpt_ids) | set(section.excluded_borehole_ids)

        # Both investigation families carry planar (x, y); union them.
        loc_rows = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.location_x, CptOrm.location_y).where(
                    CptOrm.id.in_(investigation_ids)
                )
            )
        ).all()
        loc_rows += (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                    BoreholeOrm.id.in_(investigation_ids)
                )
            )
        ).all()

        along: dict[UUID, float] = {}
        for r in loc_rows:
            if r.id in excluded:
                continue
            res = project_point_onto_line(endpoints, r.location_x, r.location_y)
            if res is not None and abs(res.offset) <= section.projection_buffer_m:
                along[r.id] = res.along
        return along
