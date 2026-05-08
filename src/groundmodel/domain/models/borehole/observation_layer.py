"""Observation layer — one depth interval within a borehole observation stream."""

from dataclasses import dataclass, field
from uuid import UUID

from uuid6 import uuid7

from groundmodel.domain.value_objects.admixture import Admixture


@dataclass
class ObservationLayer:
    """One layer (depth interval) within a borehole ``Observation``.

    A single shape that fits both lithology and stratigraphy streams:

    * Lithology layers populate ``color``, ``main_soil_codes``, and ``admixtures``;
      ``description`` may also be set.
    * Stratigraphy layers populate ``description`` (e.g. "HyEg - Lid van Egem"
      = "Member of Egem", from the Formation of Hyon) and typically leave the
      lithology fields empty.

    Parameters
    ----------
    observation_id : UUID
        Foreign key to the parent ``Observation``.
    top_m : float
        Top of the layer in metres below ground surface (>= 0).
    base_m : float
        Base of the layer in metres below ground surface (> top_m).
    color : str | None
        Source-vocabulary colour for the layer, when recorded.
    main_soil_codes : list[str]
        Source-vocabulary codes for the main soil types in this layer. DOV's
        ``<hoofdnaam>`` element can repeat — a layer can have multiple equally-
        dominant soil types (e.g. ``XZ`` + ``KL``). Empty list for stratigraphy.
    admixtures : list[Admixture]
        Secondary soil components within this layer.
    description : str | None
        Free-text or formation-code description (used by stratigraphy streams).
    layer_index : int
        Zero-based index of this layer within its parent observation. Preserved
        so the layer order survives a round-trip through any storage that does
        not guarantee insertion order.
    id : UUID
        Stable layer identifier; auto-generated.

    Raises
    ------
    ValueError
        If ``top_m`` is negative, ``base_m <= top_m``, or ``layer_index`` is negative.
    """

    observation_id: UUID
    top_m: float
    base_m: float
    color: str | None = None
    main_soil_codes: list[str] = field(default_factory=list)
    admixtures: list[Admixture] = field(default_factory=list)
    description: str | None = None
    layer_index: int = 0
    id: UUID = field(default_factory=uuid7)

    def __post_init__(self) -> None:
        if self.top_m < 0:
            raise ValueError(f"ObservationLayer.top_m cannot be negative: {self.top_m}")
        if self.base_m <= self.top_m:
            raise ValueError(
                f"ObservationLayer.base_m must be greater than top_m: {self.base_m} <= {self.top_m}"
            )
        if self.layer_index < 0:
            raise ValueError(f"ObservationLayer.layer_index cannot be negative: {self.layer_index}")
