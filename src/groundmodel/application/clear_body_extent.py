"""Clear-body-extent use case — user gesture to remove a per-side claim.

Clears one side (left or right) of one body back to NULL. The body row
itself stays unless ALL of these are true:

* Both ``extent_left_kind`` and ``extent_right_kind`` are now NULL
* ``name`` is NULL or empty

In that case, the body row is hard-deleted (cascade removes
``body_boundary_shape`` + ``body_boundary_node`` children).

Returns the updated ``BodyOrm`` row, or ``None`` if the body was deleted.

Commits.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_VALID_SIDES = ("left", "right")


class ClearBodyExtent(GroundModelLogger):
    """Clear one side of one body back to NULL; delete the row when empty.

    Symmetric opposite of ``ClaimBodyExtent``. Clears the three per-side
    columns (``extent_<side>_kind``, ``extent_<side>_target_contact_id``,
    ``extent_<side>_neighbour_inv_id``) to NULL.

    If after the clear both sides are NULL **and** ``name`` is NULL or
    empty, the body row is hard-deleted. The ``body_boundary_shape`` +
    ``body_boundary_node`` children are removed by DB-level CASCADE.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        body_id: UUID,
        side: str,
    ) -> BodyOrm | None:
        """Clear one side. Returns the updated body, or None if deleted.

        Parameters
        ----------
        project_id : UUID
            Scope guard — body must belong to this project.
        body_id : UUID
            Primary key of the body to clear.
        side : str
            ``"left"`` or ``"right"``.

        Returns
        -------
        BodyOrm | None
            The updated body row when at least one side or name remains.
            ``None`` when the body was deleted (both extents NULL and no name).

        Raises
        ------
        ValueError
            On invalid ``side`` value, or when the body does not exist in
            the given project (scope guard failure).
        """
        if side not in _VALID_SIDES:
            raise ValueError(f"side must be 'left' or 'right', got {side!r}")

        self.debug(f"ClearBodyExtent: loading body {body_id} for project {project_id}")

        body = await load_scoped_or_raise(self._session, BodyOrm, body_id, project_id, label="Body")

        # Clear the three per-side columns.
        # Setting target + neighbour to NULL is always correct here: the user
        # is removing the claim, so whatever contact or neighbour was referenced
        # is no longer relevant.
        kind_col = f"extent_{side}_kind"
        target_col = f"extent_{side}_target_contact_id"
        neighbour_col = f"extent_{side}_neighbour_inv_id"

        self.info(
            f"ClearBodyExtent: clearing side={side!r} on body {body_id} "
            f"(was kind={getattr(body, kind_col)!r})"
        )
        setattr(body, kind_col, None)
        setattr(body, target_col, None)
        setattr(body, neighbour_col, None)

        # Decide whether to reap the body row entirely.
        both_extents_null = body.extent_left_kind is None and body.extent_right_kind is None
        name_empty = body.name is None or body.name.strip() == ""

        if both_extents_null and name_empty:
            # No detector closure + no name → the body is an empty shell.
            # Hard-delete; cascade removes body_boundary_shape + body_boundary_node.
            self.info(
                f"ClearBodyExtent: body {body_id} now empty "
                "(both extents NULL, no name) — hard-deleting with cascade"
            )
            await self._session.delete(body)
            await self._session.commit()
            self.success(f"ClearBodyExtent: deleted body {body_id}")
            return None

        await self._session.commit()
        await self._session.refresh(body)
        self.success(
            f"ClearBodyExtent: cleared side={side!r} on body {body_id}; "
            f"row preserved (other extent or name still set)"
        )
        return body
