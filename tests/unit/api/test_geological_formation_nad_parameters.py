"""Unit tests for the ``nad_parameters`` derived field on the formation response.

Owner ruling 2026-09-05: the Parameters pane shows, per geotech body, the NAD
table's characteristic values (γ_dry, γ_wet, φ′, c′, c_u) for the body's packing
class — *"it is literally just reading the line and taking those parameters."*
The value is exposed on the formation read model as an additive, optional field
derived from the already-present ``nad_class`` (a table read, never inference,
never stored — Data Integrity Rule §1 compute-on-read).

Claims:
  P1  A geotech unit carrying a NAD class → ``nad_parameters`` is the table row
      for that class (γ / φ′ / c′; cu present for cohesive, ``None`` for granular).
  P2  A row with no NAD class (geological / litho unit) → ``nad_parameters`` is
      None — additive and backwards-compat safe.
  P3  The field serialises into the response JSON (the pane reads it there).
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationResponse,
)

_NOW = datetime.now(UTC)


def _make_orm(*, nad_class):
    """A SimpleNamespace mimicking a GeologicalFormationOrm row (from_attributes)."""
    return SimpleNamespace(
        id=uuid4(),
        app_project_id=uuid4(),
        name="Unit",
        color="#aabbcc",
        code=None,
        display_order=0,
        pinned_order=False,
        regional_ref=None,
        description=None,
        lithology=None,
        nad_class=nad_class,
        parent_formation_id=None,
        litho_main_soil_code=None,
        litho_admixtures=None,
        instance_ordinal=None,
        instance_ordinal_locked=False,
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_p1_geotech_class_exposes_the_table_row() -> None:
    """Class 6 (ZAND, matig gepakt) → the transcribed γ / φ′ / c′, no cu."""
    resp = GeologicalFormationResponse.model_validate(_make_orm(nad_class=6))
    assert resp.nad_parameters is not None
    assert resp.nad_parameters.gamma_unsat_kn_m3 == 17
    assert resp.nad_parameters.gamma_sat_kn_m3 == 19
    assert resp.nad_parameters.phi_deg == 30
    assert resp.nad_parameters.c_kpa == 0
    assert resp.nad_parameters.cu_kpa is None


def test_p1_cohesive_class_carries_cu() -> None:
    """Class 21 (KLEI, weinig vast) → cu present."""
    resp = GeologicalFormationResponse.model_validate(_make_orm(nad_class=21))
    assert resp.nad_parameters is not None
    assert resp.nad_parameters.cu_kpa == 20


def test_p2_no_class_means_no_parameters() -> None:
    """A geological / litho unit (nad_class None) → nad_parameters None."""
    resp = GeologicalFormationResponse.model_validate(_make_orm(nad_class=None))
    assert resp.nad_parameters is None


def test_p3_field_serialises_into_the_response_json() -> None:
    """The pane reads the field off the JSON body — it must serialise."""
    dumped = GeologicalFormationResponse.model_validate(_make_orm(nad_class=6)).model_dump()
    assert "nad_parameters" in dumped
    assert dumped["nad_parameters"]["phi_deg"] == 30
    assert dumped["nad_parameters"]["cu_kpa"] is None
    # And the absent case is a plain null, not a missing key.
    dumped_none = GeologicalFormationResponse.model_validate(_make_orm(nad_class=None)).model_dump()
    assert dumped_none["nad_parameters"] is None
