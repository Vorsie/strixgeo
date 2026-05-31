"""ORM model for BodyBoundaryShape — replaces LithoLensShapeOrm (#body-with-extent 2026-05-31).

One boundary-shape row per body (one upper polyline + one lower).
Joined to the body via ``body_id`` FK directly, replacing the old
``(model_id, content_key)`` lookup. For a body with claims on both
sides, the boundary polylines span the full body width — user-drawn
nodes can sit anywhere between the left and right extent endpoints.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyBoundaryShapeOrm(Base):
    """Persisted boundary-shape container for a body.

    Replaces LithoLensShapeOrm. The old shape row was keyed by
    ``(model_id, content_key)``; the new shape row is keyed by ``body_id``
    directly, so a re-detection that only shifts ordinals recovers the
    same shape via the stable body FK (body id is stable across resolver
    re-runs).

    Lifecycle
    ---------
    * ``model_id`` → CASCADE: clearing/deleting the model evaporates shapes.
    * ``body_id`` → CASCADE: deleting the body (DetectLithoLenses orphan
      sweep, or user-initiated deletion) removes its shape + nodes.
    * Orphan sweep: ``DetectLithoLenses`` deletes shapes whose ``body_id``
      no longer matches any live body (the defining contacts were deleted
      or un-correlated), so a shape never outlives its body.

    No ``relationship()`` objects — explicit ``select()`` in the use-case
    layer, consistent with the rest of the geology ORM.
    """

    __tablename__ = "body_boundary_shape"
    __table_args__ = (
        # One shape per body.
        UniqueConstraint("body_id", name="uq_body_boundary_shape_body_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    # FK to body. CASCADE — deleting the body removes its shape + nodes.
    body_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Denormalised for efficient model-level orphan sweeps.
    # CASCADE — deleting the model removes all its shapes.
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 'straight' (linear, default) | 'blocky' (midpoint staircase) |
    # 'rounded' (frontend Catmull-Rom over the same points).
    render_style: Mapped[str] = mapped_column(String(16), nullable=False, default="straight")
