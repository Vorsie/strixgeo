"""Shared cross-section builders for integration tests.

Since the membership rule (owner 2026-09-23: only tests a cross-section draws
feed a model) a scene that picks contacts on tests must also have a section
that draws those tests, or the surfaces build from nothing — exactly as the
product guarantees, since a pick can only be made on a section. Tests that
model an ordinary scene reach for :func:`covering_section`; tests ABOUT the
rule build their own narrow sections.
"""

from __future__ import annotations

from uuid import UUID

from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

# Half-width of the covering corridor and half-length of its line, in metres.
# Far beyond any projected coordinate a fixture uses (Lambert-72 runs to a few
# hundred thousand metres), so every test of the project projects onto it.
COVERING_HALF_SPAN_M = 5_000_000.0


def covering_section(
    project_id: UUID,
    *,
    name: str = "Covering section",
    epsg: int = 31370,
) -> CrossSectionOrm:
    """Return an unsaved section whose corridor contains every plausible test.

    The line runs east-west through y = 0 from -5 000 km to +5 000 km with a
    5 000 km buffer, so any test with 0 <= |x| <= 5 000 km and |y| <= 5 000 km
    is a member — the ordinary integration fixture, where the picks were "made
    on a section" the test never needed to draw explicitly.

    Parameters
    ----------
    project_id : UUID
        Owning project.
    name : str, optional
        Section name; only matters in log lines.
    epsg : int, optional
        Section CRS; the fixtures' investigations are all Lambert-72.

    Returns
    -------
    CrossSectionOrm
        Ready for ``session.add`` — not flushed.
    """
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=name,
        start_x=-COVERING_HALF_SPAN_M,
        start_y=0.0,
        end_x=COVERING_HALF_SPAN_M,
        end_y=0.0,
        epsg=epsg,
        projection_buffer_m=COVERING_HALF_SPAN_M,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
        display_order=0,
    )


def section_through(
    project_id: UUID,
    *,
    name: str,
    start: tuple[float, float],
    end: tuple[float, float],
    buffer_m: float,
    epsg: int = 31370,
    excluded_borehole_ids: list[UUID] | None = None,
    excluded_cpt_ids: list[UUID] | None = None,
) -> CrossSectionOrm:
    """Return an unsaved section with an explicit line and corridor.

    For tests ABOUT membership: which tests the section draws is the point.

    Parameters
    ----------
    project_id : UUID
        Owning project.
    name : str
        Section name.
    start, end : tuple[float, float]
        Line endpoints in the section CRS (metres).
    buffer_m : float
        Corridor half-width (``projection_buffer_m``).
    epsg : int, optional
        Section CRS.
    excluded_borehole_ids, excluded_cpt_ids : list[UUID] or None, optional
        Tests removed from THIS section; in the corridor but not members.

    Returns
    -------
    CrossSectionOrm
        Ready for ``session.add`` — not flushed.
    """
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=name,
        start_x=start[0],
        start_y=start[1],
        end_x=end[0],
        end_y=end[1],
        epsg=epsg,
        projection_buffer_m=buffer_m,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=list(excluded_borehole_ids or []),
        excluded_cpt_ids=list(excluded_cpt_ids or []),
        seeded_formation_contact_ids=[],
        display_order=0,
    )
