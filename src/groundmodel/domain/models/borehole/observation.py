"""Observation — one interpretation stream attached to a borehole."""

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from uuid6 import uuid7

from groundmodel.domain.models.borehole.observation_layer import ObservationLayer
from groundmodel.domain.value_objects.observation_type import ObservationType


@dataclass
class Observation:
    """One interpretation stream attached to a borehole.

    A borehole can carry multiple ``Observation``s of different
    ``ObservationType`` — e.g. an original coded lithology recorded by the
    driller, plus a later geotechnical re-coding by an engineer. Each carries
    its own author, date, and reliability/quality metadata.

    Parameters
    ----------
    borehole_id : UUID
        Foreign key to the parent ``Borehole``.
    observation_type : ObservationType
        Which interpretation stream this is.
    author : str | None
        Author of the interpretation (free text — DOV combines person and
        organisation).
    observation_date : date | None
        Date the interpretation was recorded.
    reliability : str | None
        Source-vocabulary reliability rating
        (DOV: "goed", "matig", "onbekend", ...).
    score_category : str | None
        Source-vocabulary overall quality score
        (DOV: "zeer goed", "goed", "matig", ...).
    drill_method_score : str | None
        Source-vocabulary suitability of the drilling method for this
        interpretation (DOV ``<geschiktheid_boormethode>``: "Hoog" / "Laag" / ...).
    layers : list[ObservationLayer]
        Depth-ordered layers comprising this observation. Aggregated here so an
        observation always travels with its content; the parent ``borehole_id``
        on each layer is redundant with the FK on this entity but kept so the
        DB persistence layer can flatten without loss.
    id : UUID
        Stable observation identifier; auto-generated.
    """

    borehole_id: UUID
    observation_type: ObservationType
    author: str | None = None
    observation_date: date | None = None
    reliability: str | None = None
    score_category: str | None = None
    drill_method_score: str | None = None
    layers: list[ObservationLayer] = field(default_factory=list)
    id: UUID = field(default_factory=uuid7)
