"""Value object: :class:`AutoPopulateOutcome`."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from uuid import UUID

from groundmodel.application.lumping_collision import LumpingCollision


@dataclass(frozen=True)
class AutoPopulateOutcome:
    """Summary of a single auto-populate run.

    Attributes
    ----------
    created_contact_ids : list[UUID]
        IDs of newly-created ``FormationContact`` rows.
    created_formation_ids : list[UUID]
        IDs of newly-created ``GeologicalFormation`` rows.
    deleted_formation_ids : list[UUID]
        IDs of ``GeologicalFormation`` rows deleted in the same
        transaction because their stable key was NOT in
        ``selected_keys``.  Empty when ``selected_keys`` is ``None``
        (the unfiltered "Seed from stratigraphy" path does not delete
        anything).  The client uses this list to update its manifest,
        session-import cache, and local state without issuing separate
        DELETE calls.
    skipped_existing : int
        Layers skipped because a contact already existed.
    skipped_unmatched : int
        Layers skipped due to an empty description.
    skipped_no_stratigraphy : int
        Boreholes skipped because they carried no stratigraphy observation.
    collisions : list[LumpingCollision]
        Per-borehole warnings where manual lumping caused ≥2 raw names to
        resolve to the same formation key within one borehole.  Only the
        shallowest contact was kept; deeper duplicates were silently
        dropped to preserve one-formation-one-top-per-borehole invariant.
        Empty when no ``manual_map`` was provided or when no collision
        occurred.  The discover scan produces an identical set so the user
        sees the warnings in the preview before committing.
    found_contact_ids : list[UUID]
        IDs of contacts that already existed in the model for the processed
        borehole scope and were therefore skipped (idempotency).  The Seed
        handler unions these with ``created_contact_ids`` to build the
        section's ``seeded_formation_contact_ids`` — so pre-existing
        contacts (from a prior Fill or manual draw) are also seeded, not
        only the ones created in this run.  Empty when no ``section_id``
        was passed to the use case (the Fill-from-boreholes path).
    """

    created_contact_ids: list[UUID]
    created_formation_ids: list[UUID]
    deleted_formation_ids: list[UUID]
    skipped_existing: int
    skipped_unmatched: int
    skipped_no_stratigraphy: int
    collisions: list[LumpingCollision] = dataclasses.field(default_factory=list)
    # Contact ids that already existed in the model for the processed
    # borehole scope and were skipped (idempotency).  The Seed handler
    # unions these with created_contact_ids to build the section's
    # seeded set — so pre-existing Fill contacts are also seeded, not
    # just the ones created in this run.
    found_contact_ids: list[UUID] = dataclasses.field(default_factory=list)
