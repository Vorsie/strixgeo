"""ORM model for BodyBoundaryNode (replaces LithoLensBoundaryNodeOrm, #body-with-extent).

One control node along a body's upper or lower boundary polyline.
Unique constraint ``(shape_id, boundary, node_index)`` ensures stable
ordering. Renderer reads these merged with the body's extent
endpoints, sorted by ``along_m``.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyBoundaryNodeOrm(Base):
    """One ordered control node on a body's upper or lower boundary polyline.

    Replaces LithoLensBoundaryNodeOrm. Section-local coordinates
    ``(along_m, elevation_m)`` on the body's primary section. Nodes
    belong to a ``BodyBoundaryShapeOrm``; ``boundary`` selects the upper
    or lower boundary of the body wedge; ``node_index`` orders them
    left-to-right (ascending along_m).

    ``shape_id`` → CASCADE: deleting the shape (model clear, or orphan
    sweep when the body's defining contacts vanish) deletes its nodes.

    No ``relationship()`` objects — explicit ``select()`` in the use-case
    layer.
    """

    __tablename__ = "body_boundary_node"
    __table_args__ = (
        UniqueConstraint(
            "shape_id",
            "boundary",
            "node_index",
            name="uq_body_boundary_node_order",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # FK to body_boundary_shape. CASCADE — deleting the shape removes its nodes.
    shape_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body_boundary_shape.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 'upper' = the body top boundary; 'lower' = the body base boundary.
    boundary: Mapped[str] = mapped_column(String(8), nullable=False)

    # 0-based order along the section line (ascending along_m).
    node_index: Mapped[int] = mapped_column(Integer, nullable=False)

    along_m: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_m: Mapped[float] = mapped_column(Float, nullable=False)
