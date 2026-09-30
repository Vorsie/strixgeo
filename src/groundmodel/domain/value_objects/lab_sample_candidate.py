"""A project sample considered as the home of an imported lab test."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SampleCandidate:
    """One existing sample on the chosen borehole (id + interval + number).

    Parameters
    ----------
    sample_id : str
        The sample's id (opaque to the matcher).
    depth_top_m, depth_base_m : float
        The sample's interval, m below ground (top may equal base: a spot
        sample).
    sample_number : str or None
        The sample's own number as stored (DOV "monster", or the lab's sample
        number when the sample was created by a lab import).
    """

    sample_id: str
    depth_top_m: float
    depth_base_m: float
    sample_number: str | None
