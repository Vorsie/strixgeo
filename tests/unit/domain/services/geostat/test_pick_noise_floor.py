"""Owner ruling 2026-10-19: borehole ±0.25 m, CPT ±0.10 m; anything else is a bug."""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m


def test_floors_per_source() -> None:
    """A borehole log is coarser than a CPT trace."""
    assert pick_noise_floor_m("borehole") == 0.25
    assert pick_noise_floor_m("cpt") == 0.10


def test_unknown_kind_is_refused() -> None:
    """A new investigation kind must get its own floor on purpose."""
    with pytest.raises(ValueError, match="dmt"):
        pick_noise_floor_m("dmt")
