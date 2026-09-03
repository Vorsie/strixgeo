"""Request schema for the stratigraphy-lumping staging surface.

The lumping map — ``{normalised_candidate_key: target_formation_name}``
built by "Fill from boreholes → Apply" — is persisted in two JSONB slots
on ``project`` (``stratigraphy_lumping_staged`` / ``_saved``). This module
carries the write body for the staged slot.

Why the endpoint is a whole-value PUT rather than a ``view_state``-style
shallow-merge PATCH: the map is ONE atomic snapshot stamped with its own
``applied_at``. Merging two Applies would produce a map that was never
applied at any single moment — the timestamp would lie about half its
entries. ``view_state`` is the opposite case (a bag of independent
toggles), which is why that surface merges and this one replaces.

The payload reuses ``StratigraphyLumping`` from the bundle schema rather
than accepting a raw dict, so the DoS ceilings that protect the ``.gmproj``
restore path (entry count, key/value lengths) protect this write path too.
"""

from __future__ import annotations

from groundmodel.api.schemas.project.project_bundle import StratigraphyLumping
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class StratigraphyLumpingStageRequest(StrictRequestModel):
    """Body of ``PUT /projects/{pid}/stratigraphy-lumping/staged``.

    Attributes
    ----------
    lumping : StratigraphyLumping | None
        The snapshot to stage, replacing whatever was staged before.
        ``null`` (or an omitted field) clears the slot back to "this
        project has no lumping map" — deliberately distinct from a
        snapshot whose ``map`` is empty, which means the user ran Fill
        from boreholes and grouped nothing.
    revision : int | None
        Renderer-owned MONOTONIC counter, incremented on every stage and
        written to both the database column and the crash-recovery file so that
        recovery reconciliation compares revisions rather than wall-clocks
        (see ``docs/design/autosave-recovery.md`` §3). The endpoint rejects
        a revision LOWER than the stored one with 409; equal is allowed so
        an idempotent retry of the same stage still succeeds.

        ``None`` means an older / simpler client that does not track
        revisions at all: the write proceeds and the stored counter is left
        untouched, keeping the field additive-optional.
    """

    lumping: StratigraphyLumping | None = None
    revision: int | None = None
