from dataclasses import dataclass


@dataclass(frozen=True)
class Depth:
    value_m: float

    def __post_init__(self) -> None:
        if self.value_m < 0:
            raise ValueError(f"Depth cannot be negative: {self.value_m}")
