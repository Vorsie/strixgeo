"""ORM model for LithoLensBoundaryNode — one control node on a lens boundary (#163f)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import CheckConstraint, Float, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoLensBoundaryNodeOrm(Base):
    """One ordered control node on a lens boundary (#163f Slice 2).

    Section-local coordinates ``(along_m, elevation_m)`` on the lens's primary
    section.  Nodes belong to a ``LithoLensShapeOrm`` (one shape per lens body
    by content key); ``boundary`` selects the upper or lower boundary of the
    lens wedge; ``node_index`` orders them left-to-right (ascending along_m).

    ``shape_id`` → CASCADE: deleting the shape (model clear, or orphan sweep
    when the lens body's defining contacts vanish) deletes its nodes.

    No ``relationship()`` objects — explicit ``select()`` in the use-case layer.
    """

    __tablename__ = "litho_lens_boundary_node"
    __table_args__ = (
        CheckConstraint(
            "boundary IN ('upper','lower')",
            name="ck_litho_lens_boundary_node_boundary",
        ),
        UniqueConstraint(
            "shape_id", "boundary", "node_index", name="uq_litho_lens_boundary_node_order"
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    shape_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("litho_lens_shape.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 'upper' = the lens top boundary; 'lower' = the lens base boundary.
    boundary: Mapped[str] = mapped_column(Text, nullable=False)

    # 0-based order along the section line (ascending along_m).
    node_index: Mapped[int] = mapped_column(Integer, nullable=False)

    along_m: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_m: Mapped[float] = mapped_column(Float, nullable=False)
