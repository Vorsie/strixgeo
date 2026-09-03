"""Shared base class for DOV WFS bbox-import clients (debt #15).

Five DOV clients (boring, interpretation, sample, grain-size, scalar)
share the same WFS bbox pipeline:

* WGS84→Lambert72 transform at the bbox boundary.
* ``_wfs_count`` → delegates to :func:`wfs_count`.
* ``_wfs_features`` → calls :func:`wfs_features_json`, dumps property
  keys once for the trace channel, iterates building typed rows, and
  emits a skip-summary warning when row construction fails.
* Recursive bbox-split via :func:`collect_wfs_features_recursive`,
  which the clients invoke from their ``fetch_bbox`` orchestration.

This base class extracts the universal `__init__(http)`, `_wfs_count`,
and `_wfs_features` plumbing. Subclasses declare their layer
constants and their typed `_build_row` callback; the skip-state
hooks (`_init_skip_state` / `_on_skipped_feature` /
`_emit_skip_warning`) let per-client diagnostics stay where the
domain knowledge lives.

Three of the five clients (boring, sample, grain-size) match the
single-layer, single-call shape and inherit `_wfs_count` /
`_wfs_features` unchanged. The other two (interpretation, scalar)
need a per-call extra arg (layer name / CQL filter prefix) and
override `_wfs_count` + `_wfs_features` with their own signatures,
but still inherit `__init__` and the skip-state hooks so the
diagnostic shape is uniform.

The CPT bbox client (`parsers/cpt/dov/dov_client.py`) is deliberately
NOT migrated — it carries a streaming SSE pipeline that differs
structurally from the WFS-only / WFS-plus-download families. Folding
it in would force the base to model SSE plumbing that no other
client needs.
"""

from __future__ import annotations

from abc import abstractmethod
from typing import Any, ClassVar, Generic, TypeVar

import httpx

from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_request import (
    wfs_count,
    wfs_features_json,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

RowT = TypeVar("RowT")


class DovWfsClientBase(GroundModelLogger, Generic[RowT]):
    """Base class for a DOV WFS bbox-import client.

    Subclasses declare the WFS layer name + a short log-line label as
    class constants, and implement :meth:`_build_row` to construct the
    typed row from a feature's ``properties`` dict.

    Skip-state hooks let per-client diagnostics differ — a borehole
    skip ("no fiche URL") is one counter; a sample skip ("no permkey"
    vs "no parent link") is two. Defaults track a single integer
    counter and emit a uniform warning.
    """

    # Subclasses MUST override. Empty strings here would cause an
    # invalid WFS request at runtime if a subclass forgot to set them;
    # the failure mode is loud (DOV returns 4xx).
    WFS_LAYER: ClassVar[str] = ""
    LAYER_LABEL: ClassVar[str] = ""
    # Optional CQL filter — clients querying a unified WFS layer (e.g.
    # ``monster:observaties`` with a parametergroep filter) override
    # this. Default: empty = no extra filter; the shared
    # ``wfs_count`` / ``wfs_features_json`` helpers fold the bbox into
    # the CQL string when present.
    CQL_FILTER: ClassVar[str] = ""

    def __init__(self, http: httpx.AsyncClient, backoff: DovRateLimitState | None = None) -> None:
        """Initialise with the shared httpx client.

        Parameters
        ----------
        http : httpx.AsyncClient
            Shared async HTTP client. Caller owns lifecycle.
        backoff : DovRateLimitState | None
            Optional per-import rate-limit state shared across every DOV
            sub-client of one borehole import. When supplied, the inherited
            WFS request layer threads it into ``wfs_count`` / ``wfs_features_json``
            so a 429 seen during discovery halves the import's download
            parallelism once (mirrors the CPT path). ``None`` keeps the retry
            without the concurrency reduction.
        """
        super().__init__(self.__class__.__module__)
        self._http = http
        self._backoff = backoff

    # ------------------------------------------------------------------
    # WFS request layer — inherited by single-layer / WFS-only clients.
    # Multi-layer (interpretation) and CQL-filtered (scalar) clients
    # override with their own signatures.
    # ------------------------------------------------------------------

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the WFS feature count in the Lambert72 bbox."""
        kwargs: dict[str, Any] = {
            "layer": self.WFS_LAYER,
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "label": self.LAYER_LABEL,
            "backoff": self._backoff,
        }
        if self.CQL_FILTER:
            kwargs["cql_filter"] = self.CQL_FILTER
        return await wfs_count(self._http, self, **kwargs)

    async def _wfs_features(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
    ) -> list[RowT]:
        """Fetch one bbox of WFS features and build typed rows.

        Calls :meth:`_build_row` for each feature; skipped rows
        (returning ``None``) accumulate via the skip-state hooks so
        the subclass can emit a per-batch diagnostic warning when the
        batch finishes.
        """
        kwargs: dict[str, Any] = {
            "layer": self.WFS_LAYER,
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "label": self.LAYER_LABEL,
            "backoff": self._backoff,
        }
        if self.CQL_FILTER:
            kwargs["cql_filter"] = self.CQL_FILTER
        features = await wfs_features_json(self._http, self, **kwargs)
        if features:
            # Property-key dump matches the diagnostic the per-client
            # impls all emitted before extraction. Trace level so it's
            # quiet by default but lights up under TRACE for parser
            # bring-up of a new WFS source.
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV {self.LAYER_LABEL} WFS feature properties: {first_props}")

        rows: list[RowT] = []
        skip_state = self._init_skip_state()
        for feat in features:
            props: dict[str, Any] = feat.get("properties", {})
            row = self._build_row(props)
            if row is None:
                # Reassign — the default int-counter hook returns the
                # incremented value (an int is immutable, so the new count
                # only propagates via the return). Mutate-in-place dict/
                # dataclass overrides return their same state object, so the
                # reassignment is a no-op for them. Discarding the return
                # (the pre-fix bug) left the int counter stuck at 0, so the
                # "N features skipped — available properties: …" diagnostic
                # never fired for boreholes (debt: dead skip-warning).
                skip_state = self._on_skipped_feature(props, skip_state)
                continue
            rows.append(row)

        self._emit_skip_warning(features, skip_state)
        return rows

    # ------------------------------------------------------------------
    # Hook methods — subclasses override for typed-row construction +
    # per-client diagnostics. Defaults are sensible for the simple case.
    # ------------------------------------------------------------------

    @abstractmethod
    def _build_row(self, props: dict[str, Any]) -> RowT | None:
        """Build a typed row from a WFS feature's ``properties`` dict.

        Return ``None`` to skip the row. The skip is counted via
        :meth:`_on_skipped_feature` and surfaced via
        :meth:`_emit_skip_warning` once the batch finishes.
        """

    def _init_skip_state(self) -> Any:
        """Return the initial skip-counter state for one WFS batch.

        Default: a single integer counter ``0``. Subclasses needing
        multiple skip reasons (e.g. the sample client's "no permkey"
        vs "no parent link") return a dict / dataclass instead.
        """
        return 0

    def _on_skipped_feature(self, props: dict[str, Any], state: Any) -> Any:
        """Update the skip counter for one feature that ``_build_row``
        rejected.

        Default: increments the integer state by 1 (matches the simple
        single-reason case). Subclasses with multi-reason counters
        mutate their own state structure here.

        Contract: the caller reassigns ``skip_state`` to the return value,
        so EVERY override MUST return the (possibly-mutated) state. The
        immutable-int default relies on this — discarding the return left
        the counter stuck at 0 and silenced the skip-summary warning.
        Mutate-in-place dict/dataclass overrides return their same object.
        """
        return state + 1

    def _emit_skip_warning(
        self,
        features: list[dict[str, Any]],
        state: Any,
    ) -> None:
        """Emit the per-batch skip-summary warning (or no-op when no skips).

        Default: when the integer counter is > 0, emit a single
        warning with the count and the property-key list from the
        first feature (so a parser-side mismatch — the source renamed
        a property — surfaces with concrete data the user can chase).
        """
        if not isinstance(state, int) or state <= 0:
            return
        available = list(features[0].get("properties", {}).keys()) if features else "(none)"
        self.warning(
            f"DOV {self.LAYER_LABEL} WFS: skipped {state} feature(s) — "
            f"available properties on first row: {available}"
        )
