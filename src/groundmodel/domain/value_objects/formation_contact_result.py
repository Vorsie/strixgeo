"""Domain value object: :class:`FormationContactResult`.

A plain-data snapshot of a formation contact row returned from application-layer
use cases.  Replaces the previous pattern of returning ``FormationContactOrm``
directly — an infrastructure type that should not cross the application →
API layer boundary.

The fields mirror the columns the ``FormationContactResponse`` Pydantic schema
reads (``from_attributes=True`` means Pydantic will read the same attribute
names whether the object is an ORM instance or a dataclass).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True, slots=True)
class FormationContactResult:
    """Immutable snapshot of a formation contact row.

    Constructed by use cases immediately before returning so callers
    (routers, tests) receive a plain Python object with no SQLAlchemy
    session binding.

    Attributes
    ----------
    id : UUID
        Primary key of the contact row.
    model_id : UUID
        Geological (or lithostratigraphic) model the contact belongs to.
    formation_id : UUID
        Formation whose top this contact marks.
    borehole_id : UUID | None
        Borehole anchor — exactly one of ``borehole_id`` / ``cpt_id`` is set
        for real contacts.  Both are ``None`` for synthetic pinch-out contacts.
    cpt_id : UUID | None
        CPT anchor — see ``borehole_id``.
    synthetic_x : float | None
        Projected X coordinate for synthetic (anchorless) pinch-out contacts.
        ``None`` for normal contacts.
    synthetic_y : float | None
        Projected Y coordinate for synthetic contacts.  ``None`` for normal
        contacts.
    synthetic_elevation_m : float | None
        Absolute tip elevation for synthetic contacts.  ``None`` for normal
        contacts.
    depth_top_m : float
        Depth (metres, positive-downward) of the formation top at the anchor.
    source : str
        Provenance tag (e.g. ``"manual_pick"``, ``"pinch_out_extrapolation"``).
    confidence : str
        Engineer-certainty label (e.g. ``"medium"``).
    observation_id : UUID | None
        Optional backlink to the DOV observation row this pick was derived from.
    observation_layer_id : UUID | None
        Optional backlink to the specific observation layer row.
    parent_geo_contact_id : UUID | None
        For lithostratigraphic contacts coupled to a geological contact via
        the #162 snap flow: the geological contact's id.  ``None`` otherwise.
    notes : str | None
        Free-text engineer note specific to this pick.
    created_at : datetime
        Row creation timestamp (UTC, set by the DB on INSERT).
    updated_at : datetime
        Row last-updated timestamp (UTC, set by the DB on UPDATE).
    """

    id: UUID
    model_id: UUID
    formation_id: UUID
    borehole_id: UUID | None
    cpt_id: UUID | None
    synthetic_x: float | None
    synthetic_y: float | None
    synthetic_elevation_m: float | None
    depth_top_m: float
    source: str
    confidence: str
    observation_id: UUID | None
    observation_layer_id: UUID | None
    parent_geo_contact_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm(cls, orm: object) -> FormationContactResult:
        """Construct from a ``FormationContactOrm`` instance.

        Uses ``getattr`` throughout so the constructor stays robust to partial
        test stubs (``SimpleNamespace`` fixtures that only set the fields the
        use case under test actually reads). Production callers always pass a
        fully-loaded ORM row, so the lenient defaults never fire there.

        Parameters
        ----------
        orm : object
            A ``FormationContactOrm`` instance with populated scalar columns.

        Returns
        -------
        FormationContactResult
            Immutable copy of the row's scalar fields. Missing attributes on
            the source object surface as ``None`` (declared field type is the
            documented production contract — partial stubs are a test concern).
        """
        return cls(
            id=getattr(orm, "id", None),  # type: ignore[arg-type]
            model_id=getattr(orm, "model_id", None),  # type: ignore[arg-type]
            formation_id=getattr(orm, "formation_id", None),  # type: ignore[arg-type]
            borehole_id=getattr(orm, "borehole_id", None),
            cpt_id=getattr(orm, "cpt_id", None),
            synthetic_x=getattr(orm, "synthetic_x", None),
            synthetic_y=getattr(orm, "synthetic_y", None),
            synthetic_elevation_m=getattr(orm, "synthetic_elevation_m", None),
            depth_top_m=getattr(orm, "depth_top_m", None),  # type: ignore[arg-type]
            source=getattr(orm, "source", None),  # type: ignore[arg-type]
            confidence=getattr(orm, "confidence", None),  # type: ignore[arg-type]
            observation_id=getattr(orm, "observation_id", None),
            observation_layer_id=getattr(orm, "observation_layer_id", None),
            parent_geo_contact_id=getattr(orm, "parent_geo_contact_id", None),
            notes=getattr(orm, "notes", None),
            created_at=getattr(orm, "created_at", None),  # type: ignore[arg-type]
            updated_at=getattr(orm, "updated_at", None),  # type: ignore[arg-type]
        )
