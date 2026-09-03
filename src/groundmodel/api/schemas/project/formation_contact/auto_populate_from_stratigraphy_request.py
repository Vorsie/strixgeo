"""Pydantic schema: :class:`AutoPopulateFromStratigraphyRequest`."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.shared.constants.auto_populate_mode import AutoPopulateMode

# manual_map / selected_keys originate from a .gmproj file's lumping
# snapshot, which is attacker-controlled on the restore path. Bound them so
# a crafted payload cannot allocate an arbitrarily large dict/list during
# Pydantic validation. A real project has a few hundred formation names; the
# 500-borehole cap already on borehole_ids sets the scale precedent.
_MAP_MAX_ENTRIES = 2_000
_KEY_STR_MAX = 512


class AutoPopulateFromStratigraphyRequest(StrictRequestModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/contacts/auto-populate``.

    Seeds the model with contacts derived from each borehole's
    stratigraphy observation (formal preferred, falls through to
    informal). Caller scopes the run by passing the borehole id
    list — typically the boreholes projected onto the active
    cross-section, but any subset of the project's boreholes is
    valid. Idempotent: re-running with the same scope is a no-op
    because every contact carries its source ``observation_layer_id``
    and the use case skips layers already used.

    ``selected_keys`` is an additive optional field.  When provided, only
    layers whose stable key (``regional_ref`` when present, else ``name``)
    is in this set are processed; other layers are silently skipped.  This
    is the mechanism used by the "Fill from boreholes" curated-selection
    dialog — the caller passes the keys the user checked, and the
    auto-populate creates ONLY those formations.

    ``mode`` decides what happens to the formations the caller did NOT
    select.  ``"add"`` (the default) leaves them completely alone;
    ``"overwrite"`` deletes them.  Sending ``selected_keys`` no longer
    implies consent to delete — see the field docstring.

    When ``None`` (omitted), all in-scope layers are walked.  Whether an
    unmatched layer creates a formation is then governed by
    ``create_missing_formations`` (Fill creates; the Sections "Seed from
    stratigraphy" path passes ``false`` and only places contacts for
    already-curated formations — see that field).

    ``section_id`` is the "Seed from stratigraphy" path trigger.  When
    provided, the endpoint additionally PATCHes that section's
    ``seeded_formation_contact_ids`` to the union of the existing set and
    the ids of every contact created or found during this run (created ∪
    found).  The updated section row is returned in ``updated_section``
    so the frontend can patch local state in one round-trip without a
    separate GET.  When ``None`` (the Fill-from-boreholes path), no
    section is touched and ``updated_section`` is ``null`` in the response.
    """

    borehole_ids: list[UUID] = Field(min_length=1, max_length=500)
    selected_keys: list[Annotated[str, Field(max_length=_KEY_STR_MAX)]] | None = Field(
        default=None, max_length=_MAP_MAX_ENTRIES
    )
    manual_map: (
        dict[
            Annotated[str, Field(max_length=_KEY_STR_MAX)],
            Annotated[str, Field(max_length=_KEY_STR_MAX)],
        ]
        | None
    ) = Field(default=None, max_length=_MAP_MAX_ENTRIES)
    """Optional ``{ normalize_formation_key(raw) -> target_formation_name }`` map.

    Built by the lumping dialog and sent on confirm so the write path uses
    the identical mapping that was used for the discover preview
    (``discover≡apply`` invariant).  ``None`` (omitted) = no lumping.
    """
    # The section whose seeded set this Seed run should populate.
    # When provided, the endpoint unions created ∪ found contact ids
    # into section.seeded_formation_contact_ids and returns the updated
    # section row so the frontend can patch state in one round-trip.
    # Absent on the Fill-from-boreholes path — Fill does not touch seeds.
    section_id: UUID | None = None
    create_missing_formations: bool = True
    """Whether an unmatched layer may MINT a new formation.

    ``True`` (default, Fill-from-boreholes) — model-definition step, creates
    formations as needed.  ``False`` (Sections "Seed from stratigraphy") —
    enforces the CLAUDE.md explicit-content invariant: Seed places contacts
    only for formations the user already curated and never creates one;
    unmatched layers are reported in ``skipped_not_in_model``.  Additive +
    defaulted so the Fill path and any existing client are unaffected.
    """
    mode: AutoPopulateMode = AutoPopulateMode.ADD
    """What to do with formations the caller did NOT select.

    ``"add"`` (DEFAULT) — create / update the selected keys only.  Existing
    formations outside ``selected_keys`` are never touched; the deletion pass
    is skipped entirely.

    ``"overwrite"`` — the model becomes exactly the selection: every formation
    with a contact in this model whose key is not in ``selected_keys`` is
    deleted in the same transaction.  Only send this after the user has
    confirmed it against a list of the units that will be removed.

    WHY the default is the SAFE one: on 2026-08-03 a Fill run meant to add a
    single unit deleted four saved geological units, because ``selected_keys``
    alone authorised the delete.  With ``add`` as the default, a client that
    omits this field — including every build that pre-dates it — can no longer
    mass-delete a model.
    """
