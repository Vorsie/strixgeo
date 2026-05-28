"""Detect-litho-lenses use case — #133 Phase 2+3.

Materialises ``LithoLensOrm`` rows for bodies that match the #135 topology
in the user-approved contact-edge graph.  Removes ``LithoLensOrm`` rows
whose body no longer matches.  Idempotent.

Flush boundary
--------------
This use case calls ``session.flush()`` at the end and does NOT commit.
The caller (``CorrelateLithoContacts``, ``UncorrelateLithoContacts``, or
``AcceptContactCorrelations``) owns the commit boundary so all mutations
in a single request land in one atomic transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.detect_lenses_from_graph import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_lenses_from_graph,
)
from groundmodel.domain.services.lens_identity import lens_content_key
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.litho_lens_shape_orm import LithoLensShapeOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class DetectLensesResult:
    """Outcome counts for the detection pass.

    Attributes
    ----------
    lenses_created : int
        Number of ``LithoLensOrm`` rows inserted this pass.
    lenses_removed : int
        Number of stale ``LithoLensOrm`` rows deleted this pass.
    lenses_skipped_unresolved_ordinal : int
        Candidate bodies skipped because their formation has no
        ``instance_ordinal`` yet (resolver hasn't run or skipped them).
    """

    lenses_created: int
    lenses_removed: int
    lenses_skipped_unresolved_ordinal: int


class DetectLithoLenses(GroundModelLogger):
    """Detect lens bodies and reconcile ``LithoLensOrm`` rows.

    Reads ``user_approved=True`` contact edges only.  Materialises a
    ``LithoLensOrm`` row per detected lens body.  Removes rows whose body
    is no longer lens-shaped.  Does NOT create companion sections — that is
    the separate ``MaterialiseLensCompanions`` use case (Phase 5).

    Call ``execute`` after the resolver (``ResolveLithoInstances``) so
    ``instance_ordinal`` values are current before the ordinal look-up in
    step 4.
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
    ) -> DetectLensesResult:
        """Run the detection + reconciliation pass.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — used to load cross-section rows.
        model_id : UUID
            The lithostratigraphic model.
        prefer_section_id : UUID | None
            When set, used as the primary section for any lens whose two
            anchor investigations are both contained in it.  Falls back
            to the lowest-id section that contains both when not supplied
            or when the preferred section does not span both columns.

        Returns
        -------
        DetectLensesResult
            Counts of created, removed, and ordinal-skipped lens rows.

        Notes
        -----
        This use case flushes but does NOT commit.  The caller owns the
        transaction boundary so all mutations in a single request are atomic.
        """
        self.info(
            f"DetectLithoLenses.execute: model={model_id} prefer_section_id={prefer_section_id}"
        )

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
        self.debug(f"DetectLithoLenses: loaded {len(edges)} approved edge(s)")

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
            f"DetectLithoLenses: {len(stacks)} investigation stack(s), "
            f"{len(contact_rows)} contact row(s)"
        )

        # ------------------------------------------------------------------ #
        # 3. Run the pure-domain detector.                                    #
        # ------------------------------------------------------------------ #
        candidates = detect_lenses_from_graph(edges, stacks)
        self.debug(f"DetectLithoLenses: {len(candidates)} candidate(s) from domain algorithm")

        # ------------------------------------------------------------------ #
        # 4. Resolve body_ordinal per candidate from formation.instance_ordinal. #
        # ------------------------------------------------------------------ #
        formation_ids_needed = {c.formation_id for c in candidates}
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
        # 5. Build section→investigation index for primary_section resolution. #
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
            """Pick the best section that contains both anchor investigations."""
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
        # 6. Upsert lens rows for every valid candidate.                      #
        # ------------------------------------------------------------------ #
        target_set: set[tuple[UUID, int]] = set()
        # Stable content keys of every live lens body — drives the orphan
        # sweep of litho_lens_shape rows in step 8 (#163f carry-forward).
        live_content_keys: set[str] = set()
        lenses_created = 0
        lenses_skipped_unresolved_ordinal = 0

        for c in candidates:
            ordinal = formation_ordinals.get(c.formation_id)
            if ordinal is None:
                lenses_skipped_unresolved_ordinal += 1
                self.warning(
                    f"DetectLithoLenses: skipping lens — formation {c.formation_id} "
                    "has no instance_ordinal yet (resolver hasn't run?)"
                )
                continue

            target_set.add((c.formation_id, ordinal))
            # The stable identity of this body — survives ordinal shifts so a
            # user-authored boundary shape (litho_lens_shape) re-links by it.
            content_key = lens_content_key(
                c.contact_above_id, c.contact_below_id, c.target_contact_id
            )
            live_content_keys.add(content_key)

            primary_sid = _resolve_primary(c.source_investigation_id, c.target_investigation_id)

            existing_stmt = select(LithoLensOrm).where(
                LithoLensOrm.model_id == model_id,
                LithoLensOrm.formation_id == c.formation_id,
                LithoLensOrm.body_ordinal == ordinal,
            )
            existing = (await self._session.execute(existing_stmt)).scalar_one_or_none()

            if existing is None:
                self._session.add(
                    LithoLensOrm(
                        id=uuid7(),
                        app_project_id=project_id,
                        model_id=model_id,
                        formation_id=c.formation_id,
                        body_ordinal=ordinal,
                        primary_section_id=primary_sid,
                        content_key=content_key,
                    )
                )
                lenses_created += 1
                self.debug(
                    f"DetectLithoLenses: created lens row "
                    f"formation={c.formation_id} ordinal={ordinal} key={content_key}"
                )
            else:
                # Upgrade primary_section_id if we now have one and it was null.
                if existing.primary_section_id is None and primary_sid is not None:
                    existing.primary_section_id = primary_sid
                # Keep the content key current (it may have been null on rows
                # created before this feature, or the defining contacts changed).
                if existing.content_key != content_key:
                    existing.content_key = content_key

        # ------------------------------------------------------------------ #
        # 7. Reconcile: delete stale lens rows whose body left the target set. #
        # ------------------------------------------------------------------ #
        existing_lenses = (
            (
                await self._session.execute(
                    select(LithoLensOrm).where(LithoLensOrm.model_id == model_id)
                )
            )
            .scalars()
            .all()
        )

        lenses_removed = 0
        for lens in existing_lenses:
            if (lens.formation_id, lens.body_ordinal) not in target_set:
                await self._session.delete(lens)
                lenses_removed += 1
                self.debug(
                    f"DetectLithoLenses: removed stale lens row "
                    f"formation={lens.formation_id} ordinal={lens.body_ordinal}"
                )

        # ------------------------------------------------------------------ #
        # 8. Orphan-sweep lens shapes (#163f): a litho_lens_shape whose         #
        #    content_key no longer matches any live lens body had its          #
        #    defining contacts deleted or un-correlated — its boundary nodes   #
        #    are meaningless, so drop it (CASCADE wipes the nodes). A shape     #
        #    whose key IS live survives untouched — the carry-forward.         #
        # ------------------------------------------------------------------ #
        shapes_removed = 0
        shape_rows = (
            (
                await self._session.execute(
                    select(LithoLensShapeOrm).where(LithoLensShapeOrm.model_id == model_id)
                )
            )
            .scalars()
            .all()
        )
        orphan_keys = [s.content_key for s in shape_rows if s.content_key not in live_content_keys]
        if orphan_keys:
            await self._session.execute(
                delete(LithoLensShapeOrm).where(
                    LithoLensShapeOrm.model_id == model_id,
                    LithoLensShapeOrm.content_key.in_(orphan_keys),
                )
            )
            shapes_removed = len(orphan_keys)
            self.debug(f"DetectLithoLenses: swept {shapes_removed} orphan lens shape(s)")

        # Flush — the caller commits the outer transaction.
        await self._session.flush()
        self.success(
            f"DetectLithoLenses: created={lenses_created} "
            f"removed={lenses_removed} "
            f"skipped_unresolved_ordinal={lenses_skipped_unresolved_ordinal}"
        )
        return DetectLensesResult(
            lenses_created=lenses_created,
            lenses_removed=lenses_removed,
            lenses_skipped_unresolved_ordinal=lenses_skipped_unresolved_ordinal,
        )
