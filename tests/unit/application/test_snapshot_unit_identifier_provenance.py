"""The export snapshots' unit identifiers are real formation columns (debt #104).

``BuildSectionSnapshot`` and ``BuildGroundModelSnapshot`` copy
``nad_class`` / ``litho_main_soil_code`` (and the formation id) straight
off ``GeologicalFormationOrm``. Every unit test of those builders feeds
them a fake row, so a rename on EITHER side — the ORM column or the
snapshot field — would leave all of them green while the real export
silently fell back to display-name-only naming, which is the exact
failure debt #104 closed.

This pin is deliberately non-circular: it reads the ORM's mapped column
names from SQLAlchemy metadata (no DB connection needed) and requires
the snapshot's identifier fields to name real columns.
"""

from __future__ import annotations

from dataclasses import fields

from groundmodel.application.ground_model_snapshot import FormationDisplay
from groundmodel.application.section_snapshot import SectionFormation
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)

# The identifier fields whose provenance is a pass-through from the
# formation row — NOT derived, so they must name a column verbatim
# (Data Integrity Rule 2: pass-through is a measurement, not a
# derivation, and gets no ``*_source`` stamp).
_PASS_THROUGH_FIELDS = ("nad_class", "litho_main_soil_code")


def _formation_columns() -> set[str]:
    return {column.key for column in GeologicalFormationOrm.__table__.columns}


def test_section_formation_identifiers_name_real_formation_columns() -> None:
    """A rename on either side must break here, not silently in the export."""
    columns = _formation_columns()
    declared = {f.name for f in fields(SectionFormation)}
    for name in _PASS_THROUGH_FIELDS:
        assert name in declared, f"SectionFormation lost the {name!r} identifier"
        assert name in columns, f"geological_formation has no {name!r} column"


def test_formation_display_identifiers_name_real_formation_columns() -> None:
    """Same guard for the project-wide snapshot the Plaxis 3D export reads."""
    columns = _formation_columns()
    declared = {f.name for f in fields(FormationDisplay)}
    for name in _PASS_THROUGH_FIELDS:
        assert name in declared, f"FormationDisplay lost the {name!r} identifier"
        assert name in columns, f"geological_formation has no {name!r} column"


def test_snapshot_identifiers_default_to_null() -> None:
    """A geological formation carries neither identifier, and the exporters
    read that null as "keep the display-name-only naming". A non-null
    default would rename every geological layer on the next export."""
    section_defaults = {f.name: f.default for f in fields(SectionFormation)}
    display_defaults = {f.name: f.default for f in fields(FormationDisplay)}
    for name in _PASS_THROUGH_FIELDS:
        assert section_defaults[name] is None
        assert display_defaults[name] is None
    assert display_defaults["formation_id"] is None
