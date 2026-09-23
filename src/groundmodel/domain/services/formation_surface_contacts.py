"""Pure rule for which contacts feed a formation's cached TIN surface.

The "does this contact feed the surface?" filter used to sit inline in
:class:`~groundmodel.application.recompute_formation_surface.RecomputeFormationSurface`
with a single exclusion reason. A second reason (project-local hide) now
shares it, so it lives here as a pure, DB-free function the use case
delegates to (and unit tests can pin without a database).

A contact is dropped when its anchoring investigation was removed from
the project (project-local hide), excluded from the model, or drawn by
no cross-section. The contact row is never deleted — un-hiding /
un-excluding the investigation, or a section that reaches it again,
restores its contribution — but meanwhile it is not a model input
(owner rulings 2026-09-06 and 2026-09-23: "you don't need to drop
subdivision on tests, only don't use tests not on sections for the
model").

The section rule is the geotech model's membership invariant
(:mod:`groundmodel.application.section_membership`) applied to every
model: a test that projects onto no cross-section can never be drawn,
picked or corrected there, so its picks stay on the test but feed no
surface. With no section in the project nothing is on a section, and
the model is correctly empty.

No I/O, no ORM, no logging — the caller owns every side effect.
"""

from __future__ import annotations

from collections.abc import Container
from uuid import UUID


def contact_feeds_surface(
    *,
    borehole_id: UUID | None,
    cpt_id: UUID | None,
    hidden_investigation_ids: Container[UUID],
    excluded_borehole_ids: Container[UUID],
    section_member_ids: Container[UUID],
) -> bool:
    """Return whether a contact contributes to its formation's TIN.

    Parameters
    ----------
    borehole_id : UUID or None
        The contact's borehole anchor, when it has one.
    cpt_id : UUID or None
        The contact's CPT anchor, when it has one. A synthetic contact
        (both ids ``None``, coordinates stored on the row) is anchored
        to no investigation, so it always feeds the surface.
    hidden_investigation_ids : Container[UUID]
        Investigations removed from the project (project-local hide,
        ``investigation_review.is_hidden``). A contact anchored to one
        of these is not a model input while the investigation is
        hidden.
    excluded_borehole_ids : Container[UUID]
        Boreholes excluded from THIS model
        (``geological_model.excluded_borehole_ids``). A model-scoped
        exclusion, applied to borehole anchors only.
    section_member_ids : Container[UUID]
        Investigations that project onto at least one cross-section of
        the project (``section_membership.load_section_member_investigation_ids``).
        A contact anchored to an investigation outside this set is not a
        model input; an empty set (no sections yet) admits no anchored
        contact at all.

    Returns
    -------
    bool
        ``True`` when the contact should feed the TIN, ``False`` when
        its anchor is hidden (project), excluded (model) or on no
        section.
    """
    anchor = borehole_id if borehole_id is not None else cpt_id
    if anchor is not None and anchor in hidden_investigation_ids:
        return False
    if borehole_id is not None and borehole_id in excluded_borehole_ids:
        return False
    if anchor is not None and anchor not in section_member_ids:
        return False
    return True
