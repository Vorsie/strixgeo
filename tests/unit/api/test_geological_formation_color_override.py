"""Unit tests for ``geological_formation.color_override`` — the user-set colour.

Owner ruling, dogfeed 2026-08-26: *"Colours on the right hand pane need to be
choosable if user wants."*  A colour the engineer picks must win over the
automatic one everywhere, so the two have to be distinguishable — and the app
must never mistake a stamped default for a decision.

Why a NULLABLE OVERRIDE COLUMN rather than a flag or a comparison
----------------------------------------------------------------
* **Comparing to the computed default is dishonest.**  The engineer may pick
  exactly the colour the automatic rule would have produced, and a comparison
  would forget that he chose it — his colour would then silently move the next
  time the unit's NAD class changed.  Worse, a geotech unit's automatic colour
  is ``nadClassColor(nad_class)``, computed in the renderer; the backend cannot
  evaluate it, so the comparison could only ever exist on one side.
* **A boolean flag beside ``color`` is redundant state** — two columns free to
  disagree, and nothing to stop them.
* **Nullable override wins**, and it is this codebase's own precedent:
  ``body.display_color`` is nullable, NULL *is* "not overridden", and the UI's
  reset button PATCHes NULL.  Same shape, same reset affordance, no new
  concept.  It also leaves ``color`` alone — that column stays the lithology
  identity ``GeotechBoreholeMaterialiser`` copies from the source litho unit,
  which every non-geotech consumer still reads.

Claims:
  CO1  The update schema accepts ``color_override``, and ``exclude_unset`` keeps
       an untouched override out of the patch entirely.
  CO2  An explicit ``null`` IS in the patch — that is reset-to-automatic.
  CO3  The response schema carries the field, ``None`` on a row nobody has
       recoloured.
  CO4  The column is nullable on the ORM, and is a SEPARATE column from
       ``color`` — the materialiser's copied default is not the decision.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationResponse,
    GeologicalFormationUpdateRequest,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)

_NOW = datetime.now(UTC)


def _response_kwargs(**overrides: object) -> dict[str, object]:
    """Return the minimal field set ``GeologicalFormationResponse`` requires."""
    base: dict[str, object] = {
        "id": uuid4(),
        "app_project_id": uuid4(),
        "name": "SAND (geotech)",
        "color": "#c2b280",
        "code": None,
        "display_order": 0,
        "pinned_order": False,
        "regional_ref": None,
        "description": None,
        "lithology": None,
        "nad_class": 6,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    base.update(overrides)
    return base


def test_co1_untouched_override_is_not_in_the_patch() -> None:
    """A PATCH that does not mention the colour must not write the colour."""
    request = GeologicalFormationUpdateRequest(name="SAND (geotech)")

    patch = request.model_dump(exclude_unset=True)

    assert "color_override" not in patch


def test_co1_a_picked_colour_is_in_the_patch() -> None:
    """The engineer's pick reaches the row as an override, not as ``color``."""
    request = GeologicalFormationUpdateRequest(color_override="#ff00ff")

    patch = request.model_dump(exclude_unset=True)

    assert patch == {"color_override": "#ff00ff"}


def test_co2_explicit_null_is_reset_to_automatic() -> None:
    """Sending ``null`` clears the override — the reset-to-automatic gesture.

    It has to survive ``exclude_unset``, which is exactly what distinguishes it
    from CO1's "never mentioned".
    """
    request = GeologicalFormationUpdateRequest(color_override=None)

    patch = request.model_dump(exclude_unset=True)

    assert patch == {"color_override": None}


def test_co3_response_carries_the_override_and_defaults_to_none() -> None:
    """A row nobody has recoloured answers ``None`` — the automatic colour wins."""
    plain = GeologicalFormationResponse(**_response_kwargs())
    picked = GeologicalFormationResponse(**_response_kwargs(color_override="#123456"))

    assert plain.color_override is None
    assert picked.color_override == "#123456"


def test_co4_the_override_is_its_own_nullable_column() -> None:
    """``color`` keeps the copied lithology default; the override is separate."""
    columns = GeologicalFormationOrm.__table__.columns

    assert "color_override" in columns
    assert columns["color_override"].nullable is True
    # The stamped default stays where it was, and stays required — nothing about
    # this change makes a formation's own colour optional.
    assert columns["color"].nullable is False
