"""Field log interval — depth-keyed observation made by the driller during drilling."""

from dataclasses import dataclass

from groundmodel.domain.value_objects.field_log_kind import FieldLogKind


@dataclass(frozen=True)
class FieldLogInterval:
    """One depth interval of a single field-recorded property kind.

    Field log intervals capture the driller's direct observations (colour,
    moisture, consistency) per depth interval — distinct from interpretation
    layers, which are the work of a geologist or engineer reading the log.

    Parameters
    ----------
    top_m : float
        Top of the interval in metres below ground surface (>= 0).
    base_m : float
        Base of the interval in metres below ground surface (> top_m).
    kind : FieldLogKind
        Which property this interval describes (color, moisture, or consistency).
    value : str
        Source-vocabulary value (e.g. "groenbruin" for colour, "vochtig" for
        moisture, "plastisch" for consistency).

    Raises
    ------
    ValueError
        If ``top_m`` is negative, ``base_m <= top_m``, or ``value`` is empty.
    """

    top_m: float
    base_m: float
    kind: FieldLogKind
    value: str

    def __post_init__(self) -> None:
        if self.top_m < 0:
            raise ValueError(f"FieldLogInterval.top_m cannot be negative: {self.top_m}")
        if self.base_m <= self.top_m:
            raise ValueError(
                f"FieldLogInterval.base_m must be greater than top_m: {self.base_m} <= {self.top_m}"
            )
        if not self.value:
            raise ValueError("FieldLogInterval.value cannot be empty")
