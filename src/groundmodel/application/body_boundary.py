"""Body-boundary shape use cases — read + full-replace save (#body-with-extent 2026-05-31).

A body's user-authored boundary shape lives in ``body_boundary_shape``
(render style + container) + ``body_boundary_node`` (ordered control nodes),
keyed by the body's stable ``body_id`` FK. The old ``(model_id, content_key)``
lookup is gone — the ``content_key`` column was dropped from both ``body`` and
``body_boundary_shape`` in the slice-1 schema rename migration.

Both functions resolve the body by id under the project + model scope guard.
``SaveBodyBoundary`` commits (mirrors ``NameBody``); ``GetBodyBoundary``
is read-only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_VALID_STYLES = ("straight", "blocky", "rounded")


@dataclass(frozen=True)
class BoundaryNode:
    """One control node, section-local.

    Attributes
    ----------
    along_m : float
        Distance along the section line, metres.
    elevation_m : float
        Absolute elevation (mTAW), metres.
    """

    along_m: float
    elevation_m: float


@dataclass
class BodyBoundaryState:
    """Resolved boundary shape for a body.

    Attributes
    ----------
    body_id : UUID
        The body whose shape this is.
    render_style : str
        One of ``'straight'`` / ``'blocky'`` / ``'rounded'``.
    primary_section_id : UUID | None
        The section the section-local node coordinates belong to.
    upper_nodes : list[BoundaryNode]
        Control nodes for the upper boundary, ascending by ``along_m``.
    lower_nodes : list[BoundaryNode]
        Control nodes for the lower boundary, ascending by ``along_m``.
    """

    body_id: UUID
    render_style: str
    primary_section_id: UUID | None
    upper_nodes: list[BoundaryNode] = field(default_factory=list)
    lower_nodes: list[BoundaryNode] = field(default_factory=list)


class BodyNotFoundError(Exception):
    """The body does not exist in the given project + model scope (→ 404)."""


class BodyNoPrimarySectionError(Exception):
    """The body has no ``primary_section_id`` to anchor section-local nodes (→ 422)."""


async def _load_body_scoped(
    session: AsyncSession, body_id: UUID, project_id: UUID, model_id: UUID
) -> BodyOrm:
    """Load a body row, asserting it belongs to the project + model.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    body_id : UUID
        Primary key of the body to load.
    project_id : UUID
        Expected project scope.
    model_id : UUID
        Expected model scope.

    Returns
    -------
    BodyOrm
        The loaded body row.

    Raises
    ------
    BodyNotFoundError
        When the body is absent or out of scope.
    """
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise BodyNotFoundError(f"Body {body_id} not found")
    return body


async def _load_nodes(
    session: AsyncSession, shape_id: UUID
) -> tuple[list[BoundaryNode], list[BoundaryNode]]:
    """Load a shape's nodes split into (upper, lower), ordered by node_index.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    shape_id : UUID
        Primary key of the parent shape row.

    Returns
    -------
    tuple[list[BoundaryNode], list[BoundaryNode]]
        ``(upper_nodes, lower_nodes)`` each sorted by ``node_index``.
    """
    rows = (
        (
            await session.execute(
                select(BodyBoundaryNodeOrm)
                .where(BodyBoundaryNodeOrm.shape_id == shape_id)
                .order_by(BodyBoundaryNodeOrm.node_index)
            )
        )
        .scalars()
        .all()
    )
    upper = [BoundaryNode(r.along_m, r.elevation_m) for r in rows if r.boundary == "upper"]
    lower = [BoundaryNode(r.along_m, r.elevation_m) for r in rows if r.boundary == "lower"]
    return upper, lower


class GetBodyBoundary(GroundModelLogger):
    """Read the stored boundary shape for a body (read-only).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self, *, project_id: UUID, model_id: UUID, body_id: UUID
    ) -> BodyBoundaryState:
        """Return the body's boundary shape, or an empty default when none stored.

        Parameters
        ----------
        project_id : UUID
            Project scope.
        model_id : UUID
            Model scope.
        body_id : UUID
            Target body.

        Returns
        -------
        BodyBoundaryState
            Stored nodes + render style, or empty lists + ``'straight'``
            when no shape row exists yet.

        Raises
        ------
        BodyNotFoundError
            When the body is out of scope.
        """
        body = await _load_body_scoped(self._session, body_id, project_id, model_id)
        shape = (
            await self._session.execute(
                select(BodyBoundaryShapeOrm).where(BodyBoundaryShapeOrm.body_id == body.id)
            )
        ).scalar_one_or_none()
        if shape is None:
            return BodyBoundaryState(
                body_id=body_id,
                render_style="straight",
                primary_section_id=body.primary_section_id,
            )
        upper, lower = await _load_nodes(self._session, shape.id)
        self.debug(
            f"GetBodyBoundary: body={body_id} "
            f"upper={len(upper)} lower={len(lower)} style={shape.render_style}"
        )
        return BodyBoundaryState(
            body_id=body_id,
            render_style=shape.render_style,
            primary_section_id=body.primary_section_id,
            upper_nodes=upper,
            lower_nodes=lower,
        )


class SaveBodyBoundary(GroundModelLogger):
    """Full-replace the boundary shape for a body. Commits.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
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
        body_id: UUID,
        upper_nodes: list[BoundaryNode],
        lower_nodes: list[BoundaryNode],
        render_style: str,
        prefer_section_id: UUID | None = None,
    ) -> BodyBoundaryState:
        """Upsert the body's shape row + replace its nodes atomically.

        Parameters
        ----------
        project_id : UUID
            Project scope.
        model_id : UUID
            Model scope.
        body_id : UUID
            Target body.
        upper_nodes : list[BoundaryNode]
            New control nodes for the upper boundary; sorted by ``along_m``
            and re-indexed here.
        lower_nodes : list[BoundaryNode]
            New control nodes for the lower boundary; sorted by ``along_m``
            and re-indexed here.
        render_style : str
            One of ``'straight'`` / ``'blocky'`` / ``'rounded'``.

        Returns
        -------
        BodyBoundaryState
            The saved state.

        Raises
        ------
        BodyNotFoundError
            Body out of scope (→ 404).
        BodyNoPrimarySectionError
            Body has no ``primary_section_id`` (→ 422).
        ValueError
            Invalid ``render_style``.
        """
        if render_style not in _VALID_STYLES:
            raise ValueError(f"render_style must be one of {_VALID_STYLES}, got {render_style!r}")

        body = await _load_body_scoped(self._session, body_id, project_id, model_id)
        if body.primary_section_id is None:
            # A resolver-created lens (e.g. a morph pinch-out the user is shaping)
            # carries no primary section — the boundary nodes are section-local,
            # so adopt the section the user is editing on as the anchor.  Only set
            # it when null: an existing body keeps its established section.
            if prefer_section_id is None:
                raise BodyNoPrimarySectionError(
                    f"Body {body_id} has no primary section to anchor boundary nodes"
                )
            body.primary_section_id = prefer_section_id

        self.info(
            f"SaveBodyBoundary: body={body_id} "
            f"upper={len(upper_nodes)} lower={len(lower_nodes)} style={render_style}"
        )

        # Serialise concurrent PUTs for the same body shape.
        # The frontend body-shape editor fires PUTs ~1 ms apart while the
        # user drags nodes; without a lock both transactions can pass the
        # "shape exists" SELECT, both DELETE the existing nodes, then both
        # INSERT — and the second commit dies on the unique-node-order
        # constraint (dogfeed 2026-05-31).
        #
        # ``pg_advisory_xact_lock`` is the right primitive here: it queues
        # concurrent writers on the same key and releases at COMMIT /
        # ROLLBACK with no manual cleanup.  Key combines model_id + body_id
        # so unrelated shapes never block each other.  Lock held only for
        # the duration of this transaction — read paths (``GetBodyBoundary``)
        # are untouched.
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"{model_id}:{body.id}"},
        )

        # Upsert the shape container (keyed by body_id — 1:1 invariant
        # enforced by the unique constraint on body_boundary_shape.body_id).
        shape = (
            await self._session.execute(
                select(BodyBoundaryShapeOrm).where(BodyBoundaryShapeOrm.body_id == body.id)
            )
        ).scalar_one_or_none()
        if shape is None:
            shape = BodyBoundaryShapeOrm(
                id=uuid7(),
                body_id=body.id,
                model_id=model_id,
                render_style=render_style,
            )
            self._session.add(shape)
            await self._session.flush()
        else:
            shape.render_style = render_style
            # Replace nodes: clear the existing set first.
            await self._session.execute(
                delete(BodyBoundaryNodeOrm).where(BodyBoundaryNodeOrm.shape_id == shape.id)
            )

        for boundary, nodes in (("upper", upper_nodes), ("lower", lower_nodes)):
            ordered = sorted(nodes, key=lambda n: n.along_m)
            for idx, node in enumerate(ordered):
                self._session.add(
                    BodyBoundaryNodeOrm(
                        id=uuid7(),
                        shape_id=shape.id,
                        boundary=boundary,
                        node_index=idx,
                        along_m=node.along_m,
                        elevation_m=node.elevation_m,
                    )
                )

        await self._session.flush()
        await self._session.commit()
        self.success(f"SaveBodyBoundary: body={body_id} shape saved")

        upper, lower = await _load_nodes(self._session, shape.id)
        return BodyBoundaryState(
            body_id=body_id,
            render_style=render_style,
            primary_section_id=body.primary_section_id,
            upper_nodes=upper,
            lower_nodes=lower,
        )
