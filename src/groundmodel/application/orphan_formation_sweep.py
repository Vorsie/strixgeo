"""Use case: OrphanFormationSweep — delete formations nothing points at any more.

Why
---
A ``geological_formation`` row is vocabulary: it is created on demand by the
find-or-create paths and, until now, never removed.  Every verb that reshapes a
model's content can therefore strand one.  ``SubdivideAllBodies`` and
``DivideBoreholes`` wipe their bands and re-derive them, so a packing class the
fresh qc no longer produces leaves its formation behind with nothing in it; the
band-edit verbs (set-class / split / merge / move / clear-column) re-point bands
one at a time and retire a class the moment its last band moves away.  The
strays accumulate silently, survive a ``.strix`` round trip, and surface as a
roster of rows describing ground that is not in the model — 62 of the 94 rows in
the owner's Geotech-units pane on 2026-08-26.

Why it is safe to delete them
-----------------------------
Nothing about a formation row is authored.  Its identity is the find-or-create
key — ``(app_project_id, nad_class, source_litho_formation_id)`` for a classified
unit (``geotech_borehole_materialiser._find_or_create_classified``) and the same
tuple without ``nad_class`` (``(app_project_id, source_litho_formation_id)``) for
a skeleton (``_find_or_create_skeleton``) — the GEOLOGICAL parent dropped out of
identity under R1 (owner 2026-08-31, debt #278; it is a live-derived label now).
Every column of a re-created row is copied from the source litho formation at
create time (name, colour, soil code, admixtures, display order).  None of that
lives on the geotech row itself, so a later divide that needs the class again
rebuilds an equivalent row.  Hand edits go through the SAME function
(``geotech_band_edit_helpers.formation_for_class``), so there is no parallel
vocabulary of hand-made formations that a sweep could destroy.

The row's ``id`` is NOT stable across a sweep (a fresh ``uuid7()``), which is
why the sweep only ever removes rows that nothing references.

What "unreferenced" means, and the trap in it
---------------------------------------------
Three tables carry ``formation_id`` with ``ON DELETE CASCADE``:

* ``litho_layer`` — the bands.
* ``formation_contact`` — the accepted contacts.
* ``body`` — **and this is the trap.**  ``ResolveLithoInstances._run_resolver``
  deliberately preserves an orphan body when the engineer has NAMED it, so a
  formation can hold zero bands and zero contacts and still own a named body.
  ``body`` cascades on to ``body_boundary_shape`` and ``body_boundary_node``, so
  omitting this term would delete a hand-drawn body boundary without a word.

``litho_body_solid`` also cascades, but a built 3-D solid for a formation with
no ground left is stale by definition; the sweep counts those rows and reports
them rather than letting them disappear unmentioned.

``formation_surface`` and ``formation_absence`` cascade too but are never
written for geotech units, and a litho/geo formation carrying either still has
contacts — so neither can be the sole reference in practice.  They are not part
of the predicate; if that ever changes, this is the comment that has to change
with it.

Locking
-------
The sweep takes NO lock.  It runs inside a verb that already holds the
body-partition advisory lock for its model(s), and the ordering rule in
``body_partition_lock`` (litho parent before geotech child) means a
project-scoped helper must never be the one to take a lock first.  It also never
commits — the calling verb owns the transaction boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# How many swept names to spell out in the log line before truncating. A sweep
# that removes hundreds of rows is worth reading in full only up to the point
# where the line stops being readable; the count is always exact.
MAX_LOGGED_NAMES = 20


@dataclass(frozen=True)
class OrphanFormationSweepResult:
    """What one sweep removed.

    Attributes
    ----------
    deleted : int
        Number of ``geological_formation`` rows deleted.
    names : tuple[str, ...]
        Display names of the deleted rows, in candidate order — so the caller
        can name them in its own log or surface them to the engineer.
    stale_solids_cascaded : int
        Number of ``litho_body_solid`` rows the delete cascaded away.  Reported
        because they vanish through a FK rule rather than a statement the sweep
        issued.
    """

    deleted: int
    names: tuple[str, ...]
    stale_solids_cascaded: int


class OrphanFormationSweep(GroundModelLogger):
    """Delete project formations that no layer, contact or body references.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.  The caller commits; the sweep only
        flushes through its statements.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def sweep_geotech_units(self, project_id: UUID) -> OrphanFormationSweepResult:
        """Sweep unreferenced GEOTECH units in a project.

        Candidates are the rows ``source_litho_formation_id IS NOT NULL``
        selects — the authoritative geotech discriminator, covering both
        classified units (``nad_class`` set) and borehole-only skeletons
        (``nad_class`` still null).  Litho and geological formations are
        outside the scope and can never be reached by this call.

        Parameters
        ----------
        project_id : UUID
            Project whose geotech vocabulary is being swept.

        Returns
        -------
        OrphanFormationSweepResult
            Counts and names of what was removed.
        """
        return await self._delete_unreferenced(
            select(GeologicalFormationOrm.id, GeologicalFormationOrm.name).where(
                GeologicalFormationOrm.app_project_id == project_id,
                GeologicalFormationOrm.source_litho_formation_id.is_not(None),
            ),
            project_id=project_id,
            scope="geotech",
        )

    async def sweep_litho_vocabulary(self, project_id: UUID) -> OrphanFormationSweepResult:
        """Sweep unreferenced LITHO units in a project.

        Candidates are the rows ``litho_main_soil_code IS NOT NULL`` selects.
        Note this scope is deliberately wider than litho alone: a geotech unit
        INHERITS the soil code from its source litho unit, so geotech strays are
        swept here too.  ``ClearLithoModel`` has always behaved that way and the
        behaviour is wanted — clearing the litho model retires the geotech
        vocabulary derived from it.

        Geological formations (soil code null) are never candidates.

        Parameters
        ----------
        project_id : UUID
            Project whose litho vocabulary is being swept.

        Returns
        -------
        OrphanFormationSweepResult
            Counts and names of what was removed.
        """
        return await self._delete_unreferenced(
            select(GeologicalFormationOrm.id, GeologicalFormationOrm.name).where(
                GeologicalFormationOrm.app_project_id == project_id,
                GeologicalFormationOrm.litho_main_soil_code.is_not(None),
            ),
            project_id=project_id,
            scope="litho",
        )

    async def _delete_unreferenced(
        self,
        candidate_stmt: Select[tuple[UUID, str]],
        *,
        project_id: UUID,
        scope: str,
    ) -> OrphanFormationSweepResult:
        """Delete every candidate that no layer, contact or body references."""
        self.debug(f"orphan_formation_sweep entry scope={scope} project_id={project_id}")

        candidate_rows = (await self._session.execute(candidate_stmt)).all()
        if not candidate_rows:
            self.debug(f"orphan_formation_sweep scope={scope} no candidates in project")
            return OrphanFormationSweepResult(deleted=0, names=(), stale_solids_cascaded=0)

        name_by_id: dict[UUID, str] = {row[0]: row[1] for row in candidate_rows}
        candidate_ids = set(name_by_id)

        # Project-wide, NOT model-scoped: a unit shared with a sibling model
        # still describes real ground and must survive a sweep run from the
        # model that stopped using it.
        referenced: set[UUID] = set()
        for label, column in (
            ("litho_layer", LithoLayerOrm.formation_id),
            ("formation_contact", FormationContactOrm.formation_id),
            ("body", BodyOrm.formation_id),
        ):
            hits = set(
                (
                    await self._session.execute(
                        select(column).where(column.in_(candidate_ids)).distinct()
                    )
                )
                .scalars()
                .all()
            )
            self.debug(
                f"orphan_formation_sweep scope={scope} referenced_by={label} count={len(hits)}"
            )
            referenced |= hits

        orphan_ids = candidate_ids - referenced
        if not orphan_ids:
            self.debug(
                f"orphan_formation_sweep scope={scope} nothing orphaned "
                f"candidates={len(candidate_ids)}"
            )
            return OrphanFormationSweepResult(deleted=0, names=(), stale_solids_cascaded=0)

        # Disclose the one cascade the predicate deliberately does not block on.
        stale_solids = (
            await self._session.execute(
                select(func.count())
                .select_from(LithoBodySolidOrm)
                .where(LithoBodySolidOrm.formation_id.in_(orphan_ids))
            )
        ).scalar_one()

        # Candidate order, so the log reads in the same order as the roster.
        names = tuple(name_by_id[fid] for fid, _ in candidate_rows if fid in orphan_ids)

        result = await self._session.execute(
            delete(GeologicalFormationOrm).where(GeologicalFormationOrm.id.in_(orphan_ids))
        )
        deleted: int = result.rowcount or 0

        shown = ", ".join(names[:MAX_LOGGED_NAMES])
        overflow = (
            "" if len(names) <= MAX_LOGGED_NAMES else f" (+{len(names) - MAX_LOGGED_NAMES} more)"
        )
        self.info(
            f"orphan_formation_sweep scope={scope} project_id={project_id} "
            f"deleted={deleted} kept={len(candidate_ids) - len(orphan_ids)} "
            f"stale_solids_cascaded={stale_solids} swept=[{shown}]{overflow}"
        )
        return OrphanFormationSweepResult(
            deleted=deleted,
            names=names,
            stale_solids_cascaded=int(stale_solids),
        )
