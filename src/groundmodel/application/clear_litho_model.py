"""Use case: ClearLithoModel — wipe all content from a lithostratigraphic model.

Deletes, in a single transaction, all of:
  1. ``FormationContact`` rows for the model.
  2. ``LithoContactCorrelationEdge`` rows for the model (contact-level
     boundary-to-boundary edges, #133 Phase 1+).
  3. ``FormationSurface`` rows for the model.
  4. ``BodyOrm`` rows for the model — lateral extent primitives that reference
     layers via body_id (SET NULL) and extent_*_anchor_layer_id (SET NULL), so
     they survive the layer delete as stale orphans without this explicit step.
  5. Litho ``GeologicalFormation`` rows (``litho_main_soil_code IS NOT
     NULL``) anywhere in the project that nothing references any more, via
     :class:`~groundmodel.application.orphan_formation_sweep.OrphanFormationSweep`
     (orphan-safe — a formation shared by a second litho model survives).
     Project-scoped, NOT contact-scoped: a model whose contacts were
     already wiped still has orphan litho units, and there is no contact
     link left to reach them through.

The lithostratigraphic model row itself and all geological-model formations
remain untouched.  After a successful clear the model is ready for a fresh
"Suggest litho" pass from the Sections editor.

FK-cascade notes
----------------
* ``litho_contact_correlation_edge.model_id`` → ``geological_model``
  ON DELETE CASCADE. Deleting a model also drops all its edges; but here we
  are KEEPING the model and deleting content only, so we run a targeted bulk
  DELETE first.
* ``litho_contact_correlation_edge.layer_a_id`` / ``layer_b_id`` →
  ``formation_contact`` ON DELETE CASCADE.  The step-2 contact bulk-DELETE
  would cascade to these edges anyway; we still issue the explicit edge
  delete first to keep the row-count returned in
  :class:`ClearLithoModelResult` accurate (a CASCADE delete does not
  contribute to the outer statement's ``rowcount``).
* ``body.model_id`` → ``geological_model`` ON DELETE CASCADE.  Deleting the
  model row would cascade; but here we KEEP the model and delete content only,
  so the explicit DELETE is required to avoid leaving stale body + extent rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.body_partition_lock import (
    lock_body_partition,
    lock_sibling_geotech_partitions,
)
from groundmodel.application.orphan_formation_sweep import OrphanFormationSweep
from groundmodel.infrastructure.db.dml_rowcount import dml_rowcount
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
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
    bodies : int
        Number of ``BodyOrm`` rows deleted.
    formations : int
        Number of litho ``GeologicalFormation`` rows deleted.
    """

    contacts: int
    edges: int
    surfaces: int
    bodies: int
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

        2. Bulk-DELETE all ``LithoContactCorrelationEdge`` rows for
           ``model_id``.  Done BEFORE the contact delete so the explicit
           statement's ``rowcount`` reflects the actual edge count — a
           subsequent contact-delete would otherwise CASCADE these rows
           out invisibly (CASCADE deletes do not roll into the parent
           statement's ``rowcount``).
        3. Bulk-DELETE all ``FormationContact`` rows for ``model_id``.
        4. Bulk-DELETE any remaining ``LithoLayerOrm`` rows for the model
           (pending/rejected layers have no FC counterpart and survive the
           cascade from step 3).
        5. Bulk-DELETE all ``FormationSurface`` rows for ``model_id``.
        5b. Bulk-DELETE all ``BodyOrm`` rows for ``model_id``.  Bodies
           reference layers via ``body_id`` (SET NULL on litho_layer) and
           ``extent_*_anchor_layer_id`` (SET NULL), so the layer delete
           leaves them as stale orphans; explicit deletion is required.
        6. ``OrphanFormationSweep.sweep_litho_vocabulary`` — delete every
           litho formation in the project that no layer, contact or body in
           ANY model references any more (orphan-safe: a litho unit shared
           with a second model survives).  It runs LAST because the survivor
           check has to read the post-delete state.

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
            Row counts for contacts, edges, surfaces, bodies, and formations deleted.
        """
        self.debug(f"clear_litho_model entry project_id={project_id} model_id={model_id}")

        # Step 1 — collect every litho formation in the project. Litho units
        # carry litho_main_soil_code. This is project-scoped (not via the
        # model's contacts) so a model whose contacts were already wiped
        # still has its orphan litho units found here. The orphan guard in
        # step 5 keeps it safe — a formation still referenced by any model's
        # contact survives.
        # THE ABBA CASE THE LOCK WAS BUILT FOR (audit, 2026-08-23). This verb
        # DELETEs litho_layer then body; the resolver under the lock walks the
        # same two tables the other way round (DELETE body, then UPDATE
        # litho_layer.body_id) — and litho_layer.body_id is ON DELETE SET NULL,
        # so its DELETE body takes litho_layer row locks too. Pressing "Clear
        # litho model" inside the debounced bodies/recompute window deadlocks
        # exactly as the band merge did.
        await lock_body_partition(self._session, model_id=model_id, operation="clear-litho-model")

        # Take every sibling GEOTECH child's partition lock too, BEFORE the deletes
        # below — same ordering rule the resolver follows (BP-3). This verb deletes
        # litho ``body`` rows (step 5b), and deleting a litho body fires the
        # ``ON DELETE SET NULL`` of the geotech rows' ``parent_litho_body_id`` FK
        # (the litho_layer deletes similarly SET NULL the geotech bands'
        # ``parent_litho_layer_id``) — hidden writes that row-lock the geotech child
        # rows. Taking the child lock only after those deletes would race a
        # concurrent geotech ``bodies/recompute`` exactly as the resolver did; taking
        # it up front, litho-parent-first, closes the cross-model deadlock class. A
        # no-op when the model has no geotech child.
        await lock_sibling_geotech_partitions(
            self._session, litho_model_id=model_id, operation="clear-litho-model"
        )

        # Step 2 — bulk-delete contact-correlation edges for this model.
        # Done BEFORE the contact delete: FormationContact rows are the FK
        # parents of LithoContactCorrelationEdge.layer_a_id/layer_b_id
        # (ON DELETE CASCADE), so a contact-first order would silently
        # cascade-delete these edges and the explicit edge DELETE's rowcount
        # would be 0.  Edges-first preserves an accurate count.
        edges_result = await self._session.execute(
            delete(LithoContactCorrelationEdgeOrm).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id
            )
        )
        n_edges: int = dml_rowcount(edges_result) or 0

        # Step 3 — bulk-delete contacts
        contacts_result = await self._session.execute(
            delete(FormationContactOrm).where(FormationContactOrm.model_id == model_id)
        )
        n_contacts: int = dml_rowcount(contacts_result) or 0

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
        n_surfaces: int = dml_rowcount(surfaces_result) or 0

        # Step 4b — bulk-delete body rows for this model.
        # Bodies reference layers via body_id (SET NULL on litho_layer) and
        # extent_*_anchor_layer_id (SET NULL), so the step-3.5 layer DELETE
        # nulls those FKs rather than cascading the body rows away. Without
        # this step a Clear leaves stale BodyOrm rows with null anchor ids
        # that persist until the next Detect/Resolve pass.
        bodies_result = await self._session.execute(
            delete(BodyOrm).where(BodyOrm.model_id == model_id)
        )
        n_bodies: int = dml_rowcount(bodies_result) or 0

        # Step 5 — delete orphan litho formations. Runs AFTER every delete
        # above so the survivor check sees the post-delete state: a formation
        # this model was the last user of is orphaned only once its contacts,
        # layers and bodies are gone.
        #
        # The predicate itself lives in ``OrphanFormationSweep`` because the
        # geotech verbs need exactly the same rule (a re-subdivide, a re-divide
        # or a band edit retires a packing class the same way a clear retires a
        # litho unit) and a second copy of a delete predicate is a second place
        # for it to be wrong.
        sweep = await OrphanFormationSweep(self._session).sweep_litho_vocabulary(project_id)
        n_formations = sweep.deleted

        # Sweep stale seeded ids off the project's sections. The contacts just
        # deleted (and any debris from earlier suggest→accept→delete cycles)
        # are now orphaned references in seeded_formation_contact_ids; prune
        # them so a cleared model genuinely resets the sections to a clean
        # slate. Flush-only — the caller's commit covers it.
        pruned = await CrossSectionRepository(self._session).prune_orphan_seeded_ids(project_id)

        self.success(
            f"clear_litho_model ok model_id={model_id} "
            f"contacts={n_contacts} edges={n_edges} "
            f"surfaces={n_surfaces} bodies={n_bodies} "
            f"formations={n_formations} seeded_ids_pruned={pruned}"
        )
        return ClearLithoModelResult(
            contacts=n_contacts,
            edges=n_edges,
            surfaces=n_surfaces,
            bodies=n_bodies,
            formations=n_formations,
        )
