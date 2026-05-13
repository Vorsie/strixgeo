"""Borehole sample domain model — material taken from a borehole at a depth interval."""

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Sample:
    """Physical sample taken from a borehole at a depth interval.

    A ``Sample`` is the link between a ``Borehole`` and any ``LabTest`` performed
    on its material (grain size, Atterberg, triaxial, ...).

    Parameters
    ----------
    borehole_id : UUID
        Foreign key to the parent ``Borehole``.
    depth_top_m : float
        Top of the sampled interval (>= 0).
    depth_base_m : float
        Base of the sampled interval (>= depth_top_m). Equal values are valid for
        spot samples that aren't depth-resolved.
    description : str
        Free-text sample description.
    sample_number : str | None
        Identifier assigned to the sample by the data provider — sample number
        (DOV ``monster`` = sample — often a small integer like "0" or "19", or a
        sample tag).
    sample_type : str | None
        Sample type from the source vocabulary
        (DOV ``monstertype``: "geroerd" = disturbed, "ongeroerd" = undisturbed).
    composition : str | None
        Composition (DOV ``monstersamenstelling`` = sample composition):
        "Enkelvoudig monster" = single sample, "Mengmonster" = composite sample.
    instrument : str | None
        Sampling instrument (DOV ``bemonsteringsinstrument`` = sampling
        instrument). Examples with English meaning: "spoelboor" = wash-boring,
        "pulsboor" = percussion auger, "edelmanboor" = Edelman hand auger.
    sampling_date : date | None
        Date the sample was taken.
    id : UUID
        Stable identifier; auto-generated.

    Raises
    ------
    ValueError
        If ``depth_top_m`` is negative.

    Notes
    -----
    The cross-field invariant ``depth_base_m >= depth_top_m`` is
    deliberately NOT enforced in the dataclass — per CLAUDE.md "Data
    Integrity Rules §5" it belongs in the parser's
    ``ValidationIssue`` list. Any future Sample parser pre-checks the
    invariant and emits an issue rather than raising. Debt #15.
    """

    borehole_id: UUID
    depth_top_m: float
    depth_base_m: float
    description: str = ""
    sample_number: str | None = None
    sample_type: str | None = None
    composition: str | None = None
    instrument: str | None = None
    sampling_date: date | None = None
    id: UUID = field(default_factory=uuid7)

    def __post_init__(self) -> None:
        if self.depth_top_m < 0:
            raise ValueError(f"Sample.depth_top_m cannot be negative: {self.depth_top_m}")
