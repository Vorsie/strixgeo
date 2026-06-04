"""Pin that the DOV WFS base counts skipped features (dead-warning regression).

A WFS feature whose ``_build_row`` returns ``None`` MUST be counted so the
per-batch "skipped N feature(s)" diagnostic fires. The pre-fix bug discarded
the skip-counter hook's return value, leaving the immutable-int counter stuck
at 0 — so a DOV property rename (every row rejected) imported zero rows with no
warning at all, exactly the "log what was NOT found" signal that should surface.
"""

from __future__ import annotations

from typing import Any

import pytest

from groundmodel.infrastructure.parsers.dov import dov_wfs_client_base
from groundmodel.infrastructure.parsers.dov.dov_wfs_client_base import DovWfsClientBase


class _RejectAllClient(DovWfsClientBase[dict]):
    """Minimal subclass whose row builder rejects every feature."""

    WFS_LAYER = "test:layer"
    LAYER_LABEL = "test"

    def _build_row(self, props: dict[str, Any]) -> dict | None:
        return None  # every feature is rejected → every one must be counted


@pytest.mark.asyncio
async def test_rejected_features_are_counted_and_the_skip_warning_fires(monkeypatch):
    """Three rejected features produce one skip-summary warning naming the count."""
    features = [{"properties": {"a": 1}} for _ in range(3)]

    async def _fake_features(http: Any, logger: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return features

    # Patch the WFS fetch so no network is touched — the unit under test is the
    # skip-counting loop in ``_wfs_features``, not the HTTP layer.
    monkeypatch.setattr(dov_wfs_client_base, "wfs_features_json", _fake_features)

    client = _RejectAllClient(http=None)  # http unused once wfs_features_json is patched

    emitted: list[str] = []
    monkeypatch.setattr(client, "warning", lambda msg, *a, **k: emitted.append(msg))

    rows = await client._wfs_features(0.0, 0.0, 1.0, 1.0)

    assert rows == []  # all rejected
    assert len(emitted) == 1, "the skip-summary warning must fire when rows are rejected"
    assert "skipped 3" in emitted[0]
