"""Use case: ClearLithoModel — wipe all content from a lithostratigraphic model.

Deletes, in a single transaction, all of:
  1. ``FormationContact`` rows for the model.
  2. ``LithoContactCorrelationEdge`` rows for the model (contact-level
     boundary-to-boundary edges, #133 Phase 1+).
  3. ``FormationSurface`` rows for the model.
  4. Litho ``GeologicalFormation`` rows (``litho_main_soil_code IS NOT
     NULL``) anywhere in the project that have no remaining contacts in
     any model after the contact delete (orphan-safe — a formation
     shared by a second litho model survives).  Project-scoped, NOT
     contact-scoped: a model whose contacts were already wiped still
     has orphan litho units, and there is no contact link left to reach
     them through.

The lithostratigraphic model row itself and all geological-model formations
remain untouched.  After a successful clear the model is ready for a fresh
"Suggest litho" pass from the Sections editor.

FK-cascade notes
----------------
* ``litho_contact_correlation_edge.model_id`` → ``geological_model``
  ON DELETE CASCADE. Deleting a model also drops all its edges; but here we
  are KEEPING the model and deleting content only, so we run a targeted bulk
  DELETE first.
* ``litho_contact_correlation_edge.contact_a_id`` / ``contact_b_id`` →
  ``formation_contact`` ON DELETE CASCADE.  The step-2 contact bulk-DELETE
  would cascade to these edges anyway; we still issue the explicit edge
  delete first to keep the row-count returned in
  :class:`ClearLithoModelResult` accurate (a CASCADE delete does not
  contribute to the outer statement's ``rowcount``).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class ClearLithoModelResult:
    """Counts of rows removed by :class:`ClearLithoModel`.

    Attributes
    ----------
    contacts : int
        Number of ``FormationContact`` rows deleted.
    edges : int
        Number of ``LithoContactCorrelationEdge`` rows deleted.
    surfaces : int
        Number of ``FormationSurface`` rows deleted.
    formations : int
        Number of litho ``GeologicalFormation`` rows deleted.
    """

    contacts: int
    edges: int
    surfaces: int
    formations: int


class ClearLithoModel(GroundModelLogger):
    """Delete all content from a lithostratigraphic model in one transaction.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.  The caller commits.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, project_id: UUID, model_id: UUID) -> ClearLithoModelResult:
        """Delete all contacts, edges, surfaces, and orphan litho formations.

        The delete order is:

        1. Collect every litho ``GeologicalFormation`` in the PROJECT
           (``litho_main_soil_code IS NOT NULL``).  These are the candidates
           for the orphan delete in step 5.  Project-scoped, NOT contact-
           scoped: a model whose contacts were already wiped still has
           orphan litho units to remove, and there is no contact link left
           to reach them through.
        2. Bulk-DELETE all ``LithoContactCorrelationEdge`` rows for
           ``model_id``.  Done BEFORE the contact delete so the explicit
           statement's ``rowcount`` reflects the actual edge count — a
           subsequent contact-delete would otherwise CASCADE these rows
           out invisibly (CASCADE deletes do not roll into the parent
           statement's ``rowcount``).
        3. Bulk-DELETE all ``FormationContact`` rows for ``model_id``.
        4. Bulk-DELETE all ``FormationSurface`` rows for ``model_id``.
        5. For each candidate formation from step 1: delete if and only if
           no contact in ANY model references it (orphan-safe — a litho
           unit shared with a second model survives).

        Geological formations (``litho_main_soil_code IS NULL``) and the
        lithostratigraphic model row itself are never touched.

        Parameters
        ----------
        project_id : UUID
            Project the model belongs to — scopes the litho-formation sweep.
        model_id : UUID
            Primary key of the lithostratigraphic model to clear.

        Returns
        -------
        ClearLithoModelResult
            Row counts for contacts, edges, surfaces, and formations deleted.
        """
        self.debug(f"clear_litho_model entry project_id={project_id} model_id={model_id}")

        # Step 1 — collect every litho formation in the project. Litho units
        # carry litho_main_soil_code. This is project-scoped (not via the
        # model's contacts) so a model whose contacts were already wiped
        # still has its orphan litho units found here. The orphan guard in
        # step 5 keeps it safe — a formation still referenced by any model's
        # contact survives.
        litho_fids_stmt = select(GeologicalFormationOrm.id).where(
            GeologicalFormationOrm.app_project_id == project_id,
            GeologicalFormationOrm.litho_main_soil_code.is_not(None),
        )
        candidate_fids: set[UUID] = set(
            (await self._session.execute(litho_fids_stmt)).scalars().all()
        )
        self.debug(f"clear_litho_model candidate_fids={len(candidate_fids)} model_id={model_id}")

        # Step 2 — bulk-delete contact-correlation edges for this model.
        # Done BEFORE the contact delete: FormationContact rows are the FK
        # parents of LithoContactCorrelationEdge.contact_a_id/contact_b_id
        # (ON DELETE CASCADE), so a contact-first order would silently
        # cascade-delete these edges and the explicit edge DELETE's rowcount
        # would be 0.  Edges-first preserves an accurate count.
        edges_result = await self._session.execute(
            delete(LithoContactCorrelationEdgeOrm).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id
            )
        )
        n_edges: int = edges_result.rowcount or 0

        # Step 3 — bulk-delete contacts
        contacts_result = await self._session.execute(
            delete(FormationContactOrm).where(FormationContactOrm.model_id == model_id)
        )
        n_contacts: int = contacts_result.rowcount or 0

        # Step 3.5 — bulk-delete any remaining litho_layer rows for this model.
        # Step 3's FC delete triggers FC→LL → deletes accepted LL rows; but
        # pending/rejected LL rows have no FC counterpart by design (Shape A —
        # only accepted layers mirror to FC), so they survive the cascade.
        # A "Clear litho model" gesture must wipe pending suggestions and
        # rejected layers too. Idempotent — if the FC cascade already removed
        # everything (or the model never had non-accepted layers), the
        # DELETE rowcount is 0.
        await self._session.execute(delete(LithoLayerOrm).where(LithoLayerOrm.model_id == model_id))

        # Step 4 — bulk-delete formation surfaces for this model
        surfaces_result = await self._session.execute(
            delete(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model_id)
        )
        n_surfaces: int = surfaces_result.rowcount or 0

        # Step 5 — delete orphan litho formations (no contacts AND no layers
        # in ANY model). Re-check each candidate: the step-3 contact-delete
        # removed THIS model's contacts and the step 3.5 layer-delete removed
        # THIS model's layers; a formation shared by another litho model
        # still has rows somewhere. A4 cleanup: the survivors check looks at
        # BOTH formation_contact and litho_layer — Shape A pending/rejected
        # layers don't mirror to FC, so a formation referenced only by
        # pending suggestions on a sibling model would otherwise be
        # wrongly classified as orphan and CASCADE-wipe the sibling's layers.
        n_formations = 0
        if candidate_fids:
            survivors_from_fc = set(
                (
                    await self._session.execute(
                        select(FormationContactOrm.formation_id)
                        .where(FormationContactOrm.formation_id.in_(candidate_fids))
                        .distinct()
                    )
                )
                .scalars()
                .all()
            )
            survivors_from_ll = set(
                (
                    await self._session.execute(
                        select(LithoLayerOrm.formation_id)
                        .where(LithoLayerOrm.formation_id.in_(candidate_fids))
                        .distinct()
                    )
                )
                .scalars()
                .all()
            )
            still_referenced: set[UUID] = survivors_from_fc | survivors_from_ll
            orphan_fids = candidate_fids - still_referenced
            if orphan_fids:
                del_formations_result = await self._session.execute(
                    delete(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(orphan_fids))
                )
                n_formations = del_formations_result.rowcount or 0
                self.debug(
                    f"clear_litho_model orphan_fids={len(orphan_fids)} "
                    f"kept_shared={len(still_referenced & candidate_fids)}"
                )

        # Sweep stale seeded ids off the project's sections. The contacts just
        # deleted (and any debris from earlier suggest→accept→delete cycles)
        # are now orphaned references in seeded_formation_contact_ids; prune
        # them so a cleared model genuinely resets the sections to a clean
        # slate. Flush-only — the caller's commit covers it.
        pruned = await CrossSectionRepository(self._session).prune_orphan_seeded_ids(project_id)

        self.success(
            f"clear_litho_model ok model_id={model_id} "
            f"contacts={n_contacts} edges={n_edges} "
            f"surfaces={n_surfaces} formations={n_formations} "
            f"seeded_ids_pruned={pruned}"
        )
        return ClearLithoModelResult(
            contacts=n_contacts,
            edges=n_edges,
            surfaces=n_surfaces,
            formations=n_formations,
        )
