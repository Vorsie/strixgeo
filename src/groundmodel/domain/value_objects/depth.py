"""Depth value object with non-negativity invariant."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Depth:
    """Immutable non-negative depth value in metres."""

    value_m: float

    def __post_init__(self) -> None:
        if self.value_m < 0:
            raise ValueError(f"Depth cannot be negative: {self.value_m}")
