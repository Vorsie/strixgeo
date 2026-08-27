"""Schema-level tests for :class:`LithoLayerResponse` — the
``parent_litho_layer_id`` field (Parameters body-tree slice A2).

Pure Pydantic ``from_attributes`` validation — no DB, no I/O. Pins that the
geotech band's covering-litho-band FK is exposed on the read path and defaults
to ``None`` (the honest orphan state) when the source row carries none.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from groundmodel.api.schemas.project.litho_layer.litho_layer_response import (
    LithoLayerResponse,
)


def _base_attrs(**extra: object) -> SimpleNamespace:
    """A minimal object with every column ``LithoLayerResponse`` reads."""
    now = datetime.now(UTC)
    attrs: dict[str, object] = {
        "id": uuid4(),
        "model_id": uuid4(),
        "formation_id": uuid4(),
        "borehole_id": None,
        "cpt_id": uuid4(),
        "depth_top_m": 0.0,
        "depth_base_m": 1.0,
        "status": "accepted",
        "source": "segmenter",
        "confidence": "medium",
        "observation_id": None,
        "observation_layer_id": None,
        "parent_geo_contact_id": None,
        "body_id": None,
        "notes": None,
        "created_at": now,
        "updated_at": now,
    }
    attrs.update(extra)
    return SimpleNamespace(**attrs)


def test_parent_litho_layer_id_round_trips_from_attributes() -> None:
    """A geotech band's covering litho band id is exposed verbatim."""
    parent_id = uuid4()
    resp = LithoLayerResponse.model_validate(_base_attrs(parent_litho_layer_id=parent_id))
    assert resp.parent_litho_layer_id == parent_id


def test_parent_litho_layer_id_defaults_to_none() -> None:
    """A layer with no covering litho band (true orphan) reads ``None``."""
    resp = LithoLayerResponse.model_validate(_base_attrs(parent_litho_layer_id=None))
    assert resp.parent_litho_layer_id is None
