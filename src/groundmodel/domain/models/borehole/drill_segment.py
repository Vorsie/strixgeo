"""Drill segment — depth-interval record of one drilling technique used in a borehole."""

from dataclasses import dataclass


@dataclass(frozen=True)
class DrillSegment:
    """Interval of a borehole drilled with one specific drilling technique.

    DOV records drill methods per interval — e.g. "spade" (manual spade)
    0.0–0.5 m, "edelmanboring" (Edelman hand auger) 0.5–2.0 m, "avegaarboring"
    (continuous-flight auger) 2.0–4.5 m. The borehole's overall ``drill_method``
    summarises this ("Meerdere technieken" = multiple techniques); the segment
    list is the ground truth.

    Parameters
    ----------
    top_m : float
        Top of the segment in metres below ground surface (>= 0).
    base_m : float
        Base of the segment in metres below ground surface (> top_m).
    method : str
        Source-vocabulary drill method code. DOV examples (Dutch token = English
        meaning): "spade" = manual spade, "edelmanboring" = Edelman hand auger,
        "avegaarboring" = continuous-flight auger, "pulsboring" = percussion
        (clay) auger, "kerboor" = core drill, "spoelboor" = wash-boring (flush
        drilling).

    Raises
    ------
    ValueError
        If ``top_m`` is negative, ``base_m <= top_m``, or ``method`` is empty.
    """

    top_m: float
    base_m: float
    method: str

    def __post_init__(self) -> None:
        if self.top_m < 0:
            raise ValueError(f"DrillSegment.top_m cannot be negative: {self.top_m}")
        if self.base_m <= self.top_m:
            raise ValueError(
                f"DrillSegment.base_m must be greater than top_m: {self.base_m} <= {self.top_m}"
            )
        if not self.method:
            raise ValueError("DrillSegment.method cannot be empty")
