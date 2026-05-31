"""Lens-boundary shape use cases — read + full-replace save (#163f Slice 2).

A lens body's user-authored boundary shape lives in ``litho_lens_shape``
(render style + container) + ``litho_lens_boundary_node`` (ordered control
nodes), keyed by the lens's stable ``content_key`` so it survives a resolver
re-detection that only shifts ``body_ordinal``.

Both functions resolve the lens by id under the project+model scope guard.
``save_lens_boundary`` commits (mirrors ``NameLensBody``); ``get_lens_boundary``
is read-only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.litho_lens_boundary_node_orm import (
    LithoLensBoundaryNodeOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.litho_lens_shape_orm import LithoLensShapeOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_VALID_STYLES = ("straight", "blocky", "rounded")


@dataclass(frozen=True)
class BoundaryNode:
    """One control node, section-local."""

    along_m: float
    elevation_m: float


@dataclass
class LensBoundaryState:
    """Resolved boundary shape for a lens body."""

    lens_id: UUID
    content_key: str | None
    render_style: str
    primary_section_id: UUID | None
    upper_nodes: list[BoundaryNode] = field(default_factory=list)
    lower_nodes: list[BoundaryNode] = field(default_factory=list)


class LensNotFoundError(Exception):
    """The lens does not exist in the given project + model scope (→ 404)."""


class LensNotDetectedError(Exception):
    """The lens has no ``content_key`` yet — re-run correlation (→ 422)."""


class LensNoPrimarySectionError(Exception):
    """The lens has no ``primary_section_id`` to anchor section-local nodes (→ 422)."""


async def _load_lens_scoped(
    session: AsyncSession, lens_id: UUID, project_id: UUID, model_id: UUID
) -> LithoLensOrm:
    """Load a lens row, asserting it belongs to the project + model.

    Raises
    ------
    LensNotFoundError
        When the lens is absent or out of scope.
    """
    lens = await session.get(LithoLensOrm, lens_id)
    if lens is None or lens.app_project_id != project_id or lens.model_id != model_id:
        raise LensNotFoundError(f"Lens {lens_id} not found")
    return lens


async def _load_nodes(
    session: AsyncSession, shape_id: UUID
) -> tuple[list[BoundaryNode], list[BoundaryNode]]:
    """Load a shape's nodes split into (upper, lower), ordered by node_index."""
    rows = (
        (
            await session.execute(
                select(LithoLensBoundaryNodeOrm)
                .where(LithoLensBoundaryNodeOrm.shape_id == shape_id)
                .order_by(LithoLensBoundaryNodeOrm.node_index)
            )
        )
        .scalars()
        .all()
    )
    upper = [BoundaryNode(r.along_m, r.elevation_m) for r in rows if r.boundary == "upper"]
    lower = [BoundaryNode(r.along_m, r.elevation_m) for r in rows if r.boundary == "lower"]
    return upper, lower


class GetLensBoundary(GroundModelLogger):
    """Read the stored boundary shape for a lens body (read-only)."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self, *, project_id: UUID, model_id: UUID, lens_id: UUID
    ) -> LensBoundaryState:
        """Return the lens's boundary shape, or an empty default when none stored.

        Parameters
        ----------
        project_id, model_id, lens_id : UUID
            Scope + target.

        Returns
        -------
        LensBoundaryState
            Stored nodes + render style, or empty lists + ``'straight'`` when
            the lens has no ``content_key`` or no shape row yet.

        Raises
        ------
        LensNotFoundError
            When the lens is out of scope.
        """
        lens = await _load_lens_scoped(self._session, lens_id, project_id, model_id)
        if lens.content_key is None:
            return LensBoundaryState(
                lens_id=lens_id,
                content_key=None,
                render_style="straight",
                primary_section_id=lens.primary_section_id,
            )
        shape = (
            await self._session.execute(
                select(LithoLensShapeOrm).where(
                    LithoLensShapeOrm.model_id == model_id,
                    LithoLensShapeOrm.content_key == lens.content_key,
                )
            )
        ).scalar_one_or_none()
        if shape is None:
            return LensBoundaryState(
                lens_id=lens_id,
                content_key=lens.content_key,
                render_style="straight",
                primary_section_id=lens.primary_section_id,
            )
        upper, lower = await _load_nodes(self._session, shape.id)
        self.debug(
            f"GetLensBoundary: lens={lens_id} key={lens.content_key} "
            f"upper={len(upper)} lower={len(lower)} style={shape.render_style}"
        )
        return LensBoundaryState(
            lens_id=lens_id,
            content_key=lens.content_key,
            render_style=shape.render_style,
            primary_section_id=lens.primary_section_id,
            upper_nodes=upper,
            lower_nodes=lower,
        )


class SaveLensBoundary(GroundModelLogger):
    """Full-replace the boundary shape for a lens body. Commits."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        lens_id: UUID,
        upper_nodes: list[BoundaryNode],
        lower_nodes: list[BoundaryNode],
        render_style: str,
    ) -> LensBoundaryState:
        """Upsert the lens's shape row + replace its nodes atomically.

        Parameters
        ----------
        project_id, model_id, lens_id : UUID
            Scope + target.
        upper_nodes, lower_nodes : list[BoundaryNode]
            New control nodes; sorted by ``along_m`` and re-indexed here.
        render_style : str
            One of ``straight`` / ``blocky`` / ``rounded``.

        Returns
        -------
        LensBoundaryState
            The saved state.

        Raises
        ------
        LensNotFoundError
            Lens out of scope (→ 404).
        LensNotDetectedError
            Lens has no ``content_key`` (→ 422).
        LensNoPrimarySectionError
            Lens has no ``primary_section_id`` (→ 422).
        ValueError
            Invalid ``render_style``.
        """
        if render_style not in _VALID_STYLES:
            raise ValueError(f"render_style must be one of {_VALID_STYLES}, got {render_style!r}")

        lens = await _load_lens_scoped(self._session, lens_id, project_id, model_id)
        if lens.content_key is None:
            raise LensNotDetectedError(
                f"Lens {lens_id} has no content_key — re-run correlation before shaping"
            )
        if lens.primary_section_id is None:
            raise LensNoPrimarySectionError(
                f"Lens {lens_id} has no primary section to anchor boundary nodes"
            )

        self.info(
            f"SaveLensBoundary: lens={lens_id} key={lens.content_key} "
            f"upper={len(upper_nodes)} lower={len(lower_nodes)} style={render_style}"
        )

        # Serialise concurrent PUTs for the same (model, content_key) shape.
        # The frontend lens-shape editor fires PUTs ~1 ms apart while the
        # user drags nodes; without a lock both transactions can pass the
        # "shape exists" SELECT, both DELETE the existing nodes, then both
        # INSERT — and the second commit dies on
        # uq_litho_lens_boundary_node_order (dogfeed 2026-05-31).
        #
        # ``pg_advisory_xact_lock`` is the right primitive here: it queues
        # concurrent writers on the same key and releases at COMMIT /
        # ROLLBACK with no manual cleanup.  Key combines model_id +
        # content_key so unrelated shapes never block each other.  Lock
        # held only for the duration of this transaction — read paths
        # (``GetLensBoundary``) are untouched.
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"{model_id}:{lens.content_key}"},
        )

        # Upsert the shape container (keyed by model + content_key).
        shape = (
            await self._session.execute(
                select(LithoLensShapeOrm).where(
                    LithoLensShapeOrm.model_id == model_id,
                    LithoLensShapeOrm.content_key == lens.content_key,
                )
            )
        ).scalar_one_or_none()
        if shape is None:
            shape = LithoLensShapeOrm(
                id=uuid7(),
                model_id=model_id,
                content_key=lens.content_key,
                render_style=render_style,
            )
            self._session.add(shape)
            await self._session.flush()
        else:
            shape.render_style = render_style
            # Replace nodes: clear the existing set first.
            await self._session.execute(
                delete(LithoLensBoundaryNodeOrm).where(
                    LithoLensBoundaryNodeOrm.shape_id == shape.id
                )
            )

        for boundary, nodes in (("upper", upper_nodes), ("lower", lower_nodes)):
            ordered = sorted(nodes, key=lambda n: n.along_m)
            for idx, node in enumerate(ordered):
                self._session.add(
                    LithoLensBoundaryNodeOrm(
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
        self.success(f"SaveLensBoundary: lens={lens_id} shape saved")

        upper, lower = await _load_nodes(self._session, shape.id)
        return LensBoundaryState(
            lens_id=lens_id,
            content_key=lens.content_key,
            render_style=render_style,
            primary_section_id=lens.primary_section_id,
            upper_nodes=upper,
            lower_nodes=lower,
        )
