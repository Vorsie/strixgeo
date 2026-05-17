"""Value object: :class:`LumpingCollision`."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class LumpingCollision:
    """Per-borehole warning emitted when manual lumping produces duplicate formation tops.

    A collision occurs when ≥2 primary stratigraphy layers within the SAME borehole
    resolve to the SAME formation key after the manual map is applied.  A formation
    surface needs exactly ONE top depth per borehole; two tops would corrupt the TIN
    and produce broken exported geometry.

    Resolution rule (owner-specified, data-integrity critical): keep ONLY the contact
    at the SHALLOWEST top depth (smallest ``top_m`` value) for the colliding
    (borehole, formation) pair; drop all deeper duplicates.

    WHY shallowest wins: the shallowest contact is the formation's top boundary —
    if two layers lump to the same formation, the topmost one is where that formation
    first appears.  Dropping the deeper duplicate is equivalent to saying "this
    formation is represented once at the depth it first starts".

    Attributes
    ----------
    borehole_id : UUID
        The borehole where the collision occurred.
    target_formation_key : str
        The normalised formation key that multiple raw names mapped to.
    target_formation_name : str
        The display name that will be used for the formation.
    colliding_raw_names : tuple[str, ...]
        All raw description strings that mapped to ``target_formation_key``
        in this borehole (both the kept and dropped layers).  Immutable tuple
        so the frozen dataclass is truly shallow-frozen.
    kept_top_m : float
        Top depth of the surviving contact (the shallowest).
    dropped_count : int
        Number of deeper duplicate boundaries that were dropped.
    """

    borehole_id: UUID
    target_formation_key: str
    target_formation_name: str
    colliding_raw_names: tuple[str, ...]
    kept_top_m: float
    dropped_count: int
