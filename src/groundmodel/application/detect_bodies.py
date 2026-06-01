"""Detect-bodies use case — replaces DetectLithoLenses.

Materialises ``BodyOrm`` rows for bodies that pass the bilateral-closure
detector (``detect_body_extents``) and writes per-side extent markers
(``kind='to_target'``).  Reconciles stale rows.  Respects the provenance
rule (never overwrites user-claimed extents).

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
from uuid6 import uuid7

from groundmodel.domain.services.detect_body_extents import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_body_extents,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
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
    """Outcome counts for the detection pass.

    Attributes
    ----------
    bodies_created : int
        Number of ``BodyOrm`` rows inserted this pass.
    bodies_removed : int
        Number of stale ``BodyOrm`` rows deleted this pass.
    bodies_skipped_unresolved_ordinal : int
        Candidate bodies skipped because their formation has no
        ``instance_ordinal`` yet (resolver hasn't run or skipped them).
    """

    bodies_created: int
    bodies_removed: int
    bodies_skipped_unresolved_ordinal: int


class DetectBodies(GroundModelLogger):
    """Detect bodies and reconcile ``BodyOrm`` rows.

    Reads ``user_approved=True`` contact edges only.  Materialises a
    ``BodyOrm`` row per detected bilateral-closure body.  Removes rows
    whose body no longer satisfies the bilateral-closure rule.

    Provenance rule
    ---------------
    The detector NEVER overwrites a user-claimed extent kind
    (``pinch_out_halfway``, ``extrapolated``, ``open``).  It may only
    write or overwrite extents whose current kind is ``NULL`` or
    ``'to_target'``.

    Preserve guards (reconcile step)
    ---------------------------------
    A body row is preserved (NOT deleted by the reconcile sweep) when:

    * ``name IS NOT NULL`` — the user explicitly labelled this body, so
      keep it even when the topology no longer matches the auto-detector.
      Named rows can only be removed via the explicit
      ``DELETE /bodies/{body_id}`` endpoint.
    * Either side carries a user-claimed extent kind — the user has
      explicitly asserted something about this body's lateral extent.

    Call ``execute`` after the resolver (``ResolveLithoInstances``) so
    ``instance_ordinal`` values are current before the ordinal look-up
    in step 6.
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
        """Run the detection + reconciliation pass.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — used to load cross-section rows and to
            set ``app_project_id`` on newly created ``BodyOrm`` rows.
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
            Counts of created, removed, and ordinal-skipped body rows.

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
        # 5. Run the pure-domain detector.                                    #
        # ------------------------------------------------------------------ #
        detected = detect_body_extents(edges, stacks, max_body_thickness_m=max_thickness_m)
        self.debug(f"DetectBodies: {len(detected)} candidate(s) from domain algorithm")

        # ------------------------------------------------------------------ #
        # 6. Resolve body_ordinal per candidate from formation.instance_ordinal.#
        # ------------------------------------------------------------------ #
        formation_ids_needed = {d.formation_id for d in detected}
        formation_ordinals: dict[UUID, int | None] = {}
        if formation_ids_needed:
            ordinal_rows = (
                await self._session.execute(
                    select(
                        GeologicalFormationOrm.id,
                        GeologicalFormationOrm.instance_ordinal,
                    ).where(GeologicalFormationOrm.id.in_(formation_ids_needed))
                )
            ).all()
            formation_ordinals = {r.id: r.instance_ordinal for r in ordinal_rows}

        # ------------------------------------------------------------------ #
        # 7. Upsert body rows for every valid candidate + write extents.      #
        # ------------------------------------------------------------------ #
        target_set: set[tuple[UUID, int]] = set()
        bodies_created = 0
        bodies_skipped_unresolved_ordinal = 0

        for d in detected:
            ordinal = formation_ordinals.get(d.formation_id)
            if ordinal is None:
                bodies_skipped_unresolved_ordinal += 1
                self.warning(
                    f"DetectBodies: skipping body — formation {d.formation_id} "
                    "has no instance_ordinal yet (resolver hasn't run?)"
                )
                continue

            target_set.add((d.formation_id, ordinal))

            # Resolve the primary section using the left extent's neighbour
            # as the representative target (bilateral — either side works).
            left_inv = d.extent_left.neighbour_investigation_id if d.extent_left else None
            right_inv = d.extent_right.neighbour_investigation_id if d.extent_right else None
            primary_sid = None
            if left_inv is not None:
                primary_sid = _resolve_primary(d.source_investigation_id, left_inv)
            if primary_sid is None and right_inv is not None:
                primary_sid = _resolve_primary(d.source_investigation_id, right_inv)
            if primary_sid is None and prefer_section_id is not None:
                primary_sid = prefer_section_id

            existing_stmt = select(BodyOrm).where(
                BodyOrm.model_id == model_id,
                BodyOrm.formation_id == d.formation_id,
                BodyOrm.body_ordinal == ordinal,
            )
            existing = (await self._session.execute(existing_stmt)).scalar_one_or_none()

            if existing is None:
                self._session.add(
                    BodyOrm(
                        id=uuid7(),
                        app_project_id=project_id,
                        model_id=model_id,
                        formation_id=d.formation_id,
                        body_ordinal=ordinal,
                        source_investigation_id=d.source_investigation_id,
                        primary_section_id=primary_sid,
                        extent_left_kind=(
                            EXTENT_KIND_TO_TARGET if d.extent_left is not None else None
                        ),
                        extent_left_target_contact_id=(
                            d.extent_left.target_contact_id if d.extent_left is not None else None
                        ),
                        extent_left_neighbour_inv_id=(
                            d.extent_left.neighbour_investigation_id
                            if d.extent_left is not None
                            else None
                        ),
                        extent_right_kind=(
                            EXTENT_KIND_TO_TARGET if d.extent_right is not None else None
                        ),
                        extent_right_target_contact_id=(
                            d.extent_right.target_contact_id if d.extent_right is not None else None
                        ),
                        extent_right_neighbour_inv_id=(
                            d.extent_right.neighbour_investigation_id
                            if d.extent_right is not None
                            else None
                        ),
                    )
                )
                bodies_created += 1
                self.debug(
                    f"DetectBodies: created body row formation={d.formation_id} ordinal={ordinal}"
                )
            else:
                # Update extents PER SIDE per provenance rule:
                # - Detector may overwrite NULL or 'to_target'.
                # - Detector NEVER touches user-claimed kinds.
                if d.extent_left is not None and not is_user_claimed_extent_kind(
                    existing.extent_left_kind
                ):
                    existing.extent_left_kind = EXTENT_KIND_TO_TARGET
                    existing.extent_left_target_contact_id = d.extent_left.target_contact_id
                    existing.extent_left_neighbour_inv_id = d.extent_left.neighbour_investigation_id
                if d.extent_right is not None and not is_user_claimed_extent_kind(
                    existing.extent_right_kind
                ):
                    existing.extent_right_kind = EXTENT_KIND_TO_TARGET
                    existing.extent_right_target_contact_id = d.extent_right.target_contact_id
                    existing.extent_right_neighbour_inv_id = (
                        d.extent_right.neighbour_investigation_id
                    )
                # Upgrade primary_section_id when currently NULL.
                if existing.primary_section_id is None and primary_sid is not None:
                    existing.primary_section_id = primary_sid

        # ------------------------------------------------------------------ #
        # 8. Reconcile: delete purely-detected stale rows.                    #
        #                                                                      #
        # Preserve guards (owner directives):                                  #
        # - name IS NOT NULL → user-named body; skip (preserve-named guard).  #
        # - Either side carries a user-claimed extent kind → skip.            #
        #   (preserve-claimed guard).                                          #
        # ------------------------------------------------------------------ #
        existing_bodies = (
            (await self._session.execute(select(BodyOrm).where(BodyOrm.model_id == model_id)))
            .scalars()
            .all()
        )

        bodies_removed = 0
        for body in existing_bodies:
            if (body.formation_id, body.body_ordinal) in target_set:
                continue
            # Preserve-named guard.
            if body.name is not None and body.name.strip() != "":
                self.debug(
                    f"DetectBodies: preserving named body row "
                    f"formation={body.formation_id} ordinal={body.body_ordinal} "
                    f"name={body.name!r} (topology no longer matches but user-named)"
                )
                continue
            # Preserve-claimed guard.
            if is_user_claimed_extent_kind(body.extent_left_kind):
                self.debug(
                    f"DetectBodies: preserving body row with user-claimed left extent "
                    f"formation={body.formation_id} ordinal={body.body_ordinal} "
                    f"extent_left_kind={body.extent_left_kind!r}"
                )
                continue
            if is_user_claimed_extent_kind(body.extent_right_kind):
                self.debug(
                    f"DetectBodies: preserving body row with user-claimed right extent "
                    f"formation={body.formation_id} ordinal={body.body_ordinal} "
                    f"extent_right_kind={body.extent_right_kind!r}"
                )
                continue
            # Purely-detected with no user claim — safe to delete.
            await self._session.delete(body)
            bodies_removed += 1
            self.debug(
                f"DetectBodies: removed stale body row "
                f"formation={body.formation_id} ordinal={body.body_ordinal}"
            )

        # Flush — the caller commits the outer transaction.
        await self._session.flush()
        self.success(
            f"DetectBodies: created={bodies_created} "
            f"removed={bodies_removed} "
            f"skipped_unresolved_ordinal={bodies_skipped_unresolved_ordinal}"
        )
        return DetectBodiesResult(
            bodies_created=bodies_created,
            bodies_removed=bodies_removed,
            bodies_skipped_unresolved_ordinal=bodies_skipped_unresolved_ordinal,
        )
