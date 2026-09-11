"""The litho find-or-create lookup must see litho units only.

Owner 2026-09-11, packaged #30: an Edit composition to sand repointed the layer
to ``ZAND (geotech)`` — a GEOTECH provenance row the borehole materialiser
creates, which inherits the litho soil code — so the litho axis painted the
interval in that row's colour and the composition verb could not find the
layer's unit any more. Geotech rows carry ``source_litho_formation_id``; litho
rows never do (the renderer's ``isLithoUnit`` rule). The lookup skips them.
"""

from uuid import uuid4

from groundmodel.application.litho_formation_lookup import build_litho_formation_lookup
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm


def _row(name: str, *, source_litho_formation_id=None, nad_class=None) -> GeologicalFormationOrm:
    return GeologicalFormationOrm(
        id=uuid4(),
        app_project_id=uuid4(),
        name=name,
        color="#fbbf24",
        display_order=0,
        nad_class=nad_class,
        litho_main_soil_code="ZAND",
        litho_admixtures=[],
        source_litho_formation_id=source_litho_formation_id,
    )


def test_a_geotech_provenance_row_never_wins_the_litho_lookup() -> None:
    """A litho row keeps its key even when geotech derivatives share the soil code."""
    litho = _row("ZAND")
    geotech_unclassified = _row("ZAND (geotech)", source_litho_formation_id=litho.id)
    geotech_nad = _row("ZAND (NAD 6)", source_litho_formation_id=litho.id, nad_class=6)
    # Geotech rows listed AFTER the litho row: the old dict-last-wins behaviour
    # handed the key to whichever geotech row came last.
    lookup = build_litho_formation_lookup([litho, geotech_unclassified, geotech_nad])
    assert lookup[("ZAND", "")] is litho


def test_only_geotech_rows_present_means_no_litho_unit_to_reuse() -> None:
    """With only geotech rows on the soil code there is nothing to reuse: create."""
    geotech = _row("ZAND (geotech)", source_litho_formation_id=uuid4())
    assert ("ZAND", "") not in build_litho_formation_lookup([geotech])
