"""Use case: ClearBodyBoundaries — wipe all user-authored boundary shapes for a model.

The litho "free-draw / hand-shape" tool stores each user-drawn body boundary as
a ``body_boundary_shape`` row (render style + container) plus its ordered
``body_boundary_node`` control points. These are OVERRIDES on top of the
engine's computed partition: while a shape exists for a body, the section
overlay bends that body's boundary to the stored nodes instead of the clean
engine default.

Left-over overrides from earlier dogfeeding (e.g. shapes drawn with a
previously-broken tool) can bend boundaries off the engine default and produce
visible gap wedges. This use case is the bulk "Reset manual points" reset: it
deletes ALL ``body_boundary_shape`` rows for one lithostratigraphic model in a
single transaction, so every body returns to its computed shape (no override →
the validated engine partition).

FK-cascade notes
----------------
* ``body_boundary_node.shape_id`` → ``body_boundary_shape`` ON DELETE CASCADE.
  Deleting the shape rows drops their nodes at the DB level, so a single bulk
  DELETE on ``body_boundary_shape`` (filtered by the denormalised ``model_id``
  column) clears both tables. The node CASCADE does not contribute to the
  outer statement's ``rowcount``, so the returned count is the number of SHAPE
  rows deleted (one per hand-shaped body) — which is the count the user cares
  about ("N hand-drawn boundaries cleared").
* ``body_boundary_shape.model_id`` is a denormalised FK to
  ``geological_model`` carried specifically for efficient model-level sweeps
  (see ``BodyBoundaryShapeOrm``), so the bulk DELETE needs no join to ``body``.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.dml_rowcount import dml_rowcount
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class ClearBodyBoundariesResult:
    """Outcome of a bulk boundary-shape clear.

    Attributes
    ----------
    shapes_deleted : int
        Number of ``body_boundary_shape`` rows removed (one per hand-shaped
        body). Their nodes are dropped by the DB-level CASCADE and are not
        counted here.
    """

    shapes_deleted: int


class ClearBodyBoundaries(GroundModelLogger):
    """Delete every user-authored boundary shape for a model. Commits.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, *, model_id: UUID) -> ClearBodyBoundariesResult:
        """Bulk-delete all boundary shapes (+ cascade nodes) for a model.

        The caller is responsible for asserting that ``model_id`` belongs to
        the request's project (the router runs ``get_in_project_or_404``); this
        use case is purely the model-scoped delete.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model whose hand-drawn boundary shapes are
            cleared.

        Returns
        -------
        ClearBodyBoundariesResult
            The number of shape rows deleted.
        """
        self.info(f"ClearBodyBoundaries.execute: model={model_id}")

        result = await self._session.execute(
            delete(BodyBoundaryShapeOrm).where(BodyBoundaryShapeOrm.model_id == model_id)
        )
        # rowcount is the number of shape rows matched by the WHERE clause; the
        # node CASCADE happens in the DB and does not contribute to it.
        deleted = int(dml_rowcount(result) or 0)
        await self._session.commit()

        self.success(
            f"ClearBodyBoundaries done: cleared {deleted} boundary shape(s) for model {model_id}"
        )
        return ClearBodyBoundariesResult(shapes_deleted=deleted)
