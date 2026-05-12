"""Unit tests for the geology domain dataclasses.

These are pure shape tests — no DB, no I/O. They lock the public
attributes against accidental rename and confirm the dataclasses
are frozen (immutable). Behaviour tests (gap validation, contact
ordering) live in ``domain/services/test_geology_validator.py``
when the application-layer use cases land alongside the editor
(debt #26).
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from uuid import uuid4

import pytest

from groundmodel.domain.models.geology.cross_section import CrossSection
from groundmodel.domain.models.geology.formation_contact import FormationContact
from groundmodel.domain.models.geology.geological_formation import GeologicalFormation
from groundmodel.domain.models.geology.geological_model import GeologicalModel


def test_geological_formation_holds_required_fields() -> None:
    """A minimal formation accepts the documented fields without raising."""
    f = GeologicalFormation(
        id=uuid4(),
        app_project_id=uuid4(),
        name="Boom Klei",
        code="BmK",
        color="#806040",
    )
    assert f.name == "Boom Klei"
    assert f.code == "BmK"
    assert f.display_order == 0  # default
    assert f.regional_ref is None
    assert f.description is None


def test_geological_formation_is_frozen() -> None:
    """Frozen — immutability protects domain invariants from drift."""
    f = GeologicalFormation(
        id=uuid4(), app_project_id=uuid4(), name="X", code=None, color="#000000"
    )
    with pytest.raises(FrozenInstanceError):
        f.name = "Y"  # type: ignore[misc]


def test_geological_model_defaults() -> None:
    """A model defaults to inactive with no excluded boreholes."""
    m = GeologicalModel(id=uuid4(), app_project_id=uuid4(), name="working model")
    assert m.is_active is False
    assert m.excluded_borehole_ids == []
    assert m.description is None


def test_formation_contact_required_fields() -> None:
    """A contact carries model + formation + depth + source + anchor."""
    c = FormationContact(
        id=uuid4(),
        model_id=uuid4(),
        formation_id=uuid4(),
        borehole_id=uuid4(),
        depth_top_m=2.5,
        source="manual_pick",
    )
    assert c.depth_top_m == 2.5
    assert c.source == "manual_pick"
    assert c.cpt_id is None
    assert c.confidence == "medium"


def test_formation_contact_cpt_anchor() -> None:
    """A CPT-anchored contact carries cpt_id, not borehole_id."""
    c = FormationContact(
        id=uuid4(),
        model_id=uuid4(),
        formation_id=uuid4(),
        cpt_id=uuid4(),
        depth_top_m=0.5,
        source="observation_layer",
    )
    assert c.borehole_id is None
    assert c.cpt_id is not None


def test_cross_section_required_fields() -> None:
    """A section carries endpoints, EPSG, buffer, VEX, exclusion sets."""
    s = CrossSection(
        id=uuid4(),
        app_project_id=uuid4(),
        name="A-A'",
        start_x=150_000.0,
        start_y=200_000.0,
        end_x=150_500.0,
        end_y=200_300.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    assert s.vertical_exaggeration == 1.0  # default
    assert s.excluded_borehole_ids == []
    assert s.excluded_cpt_ids == []
    assert s.min_depth_m is None
    assert s.view_state is None


def test_cross_section_view_state_is_optional_dict() -> None:
    """``view_state`` accepts an arbitrary JSON-serialisable bag."""
    s = CrossSection(
        id=uuid4(),
        app_project_id=uuid4(),
        name="B-B'",
        start_x=0,
        start_y=0,
        end_x=100,
        end_y=0,
        epsg=31370,
        projection_buffer_m=25.0,
        view_state={"cpt_channels": {"qc": True, "rf": False}},
    )
    assert s.view_state is not None
    assert s.view_state["cpt_channels"]["qc"] is True
