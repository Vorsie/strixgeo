"""ORM model for LithoLensShape — user-authored lens boundary shape (#163f Slice 2)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class LithoLensShapeOrm(Base):
    """One user-authored shape for a lens body, keyed by stable content key.

    A lens body's identity for shaping is its ``content_key`` (the sorted hash
    of its three defining contact ids — see ``lens_identity.lens_content_key``),
    NOT its volatile ``body_ordinal``.  This row is the container the boundary
    nodes (``LithoLensBoundaryNodeOrm``) hang off, plus the per-lens render
    style.  Both survive a resolver re-detection that only shifts ordinals,
    because they join to the lens by ``(model_id, content_key)``.

    Lifecycle
    ---------
    * ``model_id`` → CASCADE: clearing/deleting the model evaporates shapes.
    * Orphan sweep: ``DetectLithoLenses`` deletes shapes whose ``content_key``
      no longer matches any live lens (the defining contacts were deleted or
      un-correlated), so a shape never outlives its lens body.

    No ``relationship()`` objects — explicit ``select()`` in the use-case layer,
    consistent with the rest of the geology ORM.
    """

    __tablename__ = "litho_lens_shape"
    __table_args__ = (
        CheckConstraint(
            "render_style IN ('straight','blocky','rounded')",
            name="ck_litho_lens_shape_render_style",
        ),
        UniqueConstraint("model_id", "content_key", name="uq_litho_lens_shape_model_key"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Stable join key to the lens body — see LithoLensOrm.content_key.
    content_key: Mapped[str] = mapped_column(Text, nullable=False)

    # 'straight' (linear, default) | 'blocky' (midpoint staircase) |
    # 'rounded' (frontend Catmull-Rom over the same points).
    render_style: Mapped[str] = mapped_column(Text, nullable=False, server_default="straight")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
