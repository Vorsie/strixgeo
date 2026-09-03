"""Async DOV WFS client — fetches scalar lab-test observations (Phase C4).

Same ``monster:observaties`` WFS layer as ``DovGrainSizeClient`` but with two
critical differences:

1. **Server-side filter on ``parameter`` (not just ``parametergroep``).** DOV's
   ``Bodem_chemisch`` parametergroep contains both CaCO3 and organic-carbon
   measurements (and pH, Kalkgehalte_beschrijvend, ...), so filtering on the
   group alone would catch the wrong rows. We accept either a single
   parameter string or a list of strings (CQL ``IN (...)``).
2. **No per-observation XML download.** The WFS row carries ``resultaat``
   directly — that's all the scalar tests need. So this client returns
   ``ScalarObservationWfsRow`` instances; the orchestrator maps them
   straight into ORM rows without a separate parse phase.

Pipeline
--------
1. Lambert72 bbox transform.
2. Recursive WFS bbox query (``count`` then ``GetFeature``) with the parameter
   CQL filter, auto-splitting on > ``DOV_WFS_FEATURE_LIMIT`` features.
3. Optional ``parent_permkeys`` filter — drop rows whose parent sample isn't
   in the set the orchestrator just persisted.

Why no shared base class with the other 4 DOV WFS clients (yet)
---------------------------------------------------------------
The recursive bbox-split + count pattern is now duplicated across five
clients (boring, interpretation, sample, grain-size, scalar). That's clearly
abstraction-worthy. Per CLAUDE.md "feel the pain, then abstract" we'll
extract the shared base in a follow-up refactor — keeping this phase
focused on the new functionality.
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import partial
from typing import Any

import httpx

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import (
    last_path_segment,
    optional_date,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_request import (
    wfs_count,
    wfs_features_json,
)
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_OBSERVATIE_WFS_DETECTIECONDITIE_PROP,
    DOV_OBSERVATIE_WFS_EENHEID_PROP,
    DOV_OBSERVATIE_WFS_FENOMEENTIJD_PROP,
    DOV_OBSERVATIE_WFS_METHODE_PROP,
    DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP,
    DOV_OBSERVATIE_WFS_PARAMETER_PROP,
    DOV_OBSERVATIE_WFS_PARAMETERGROEP_PROP,
    DOV_OBSERVATIE_WFS_PARENT_LINK_PROP,
    DOV_OBSERVATIE_WFS_RESULTAAT_PROP,
    DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS,
    DOV_WFS_OBSERVATIES_LAYER,
)
from groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row import (
    ScalarObservationWfsRow,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Debt #113: CQL injection guard — _build_cql_filter interpolates parameter
# values inside single-quoted CQL literals with no escaping.  Every value in
# DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS has been probed live and contains no
# single-quote character; this assertion fires at module load so a future
# addition that accidentally introduces one is caught immediately, not at
# query time against a live WFS endpoint.
_ALL_PARAM_VALUES = {param for _, param in DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS}
assert all("'" not in p for p in _ALL_PARAM_VALUES), (
    "DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS contains a value with a single-quote "
    "character — _build_cql_filter would produce a broken/injectable CQL string.  "
    "Escape the value or remove it from the tuple before adding it.  (debt #113)"
)


class DovScalarObservationClient(GroundModelLogger):
    """Fetch scalar lab-test observation rows from ``monster:observaties``.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. ``follow_redirects=True`` is enforced by
        the parent orchestrator but doesn't matter here — WFS returns JSON
        directly, no redirects.
    backoff : DovRateLimitState | None
        Optional per-import rate-limit state shared with the other borehole
        sub-clients. Threaded into the WFS request layer so a 429 seen during
        this (WFS-only) discovery halves the import's download parallelism once
        for the phases that still run. ``None`` keeps the retry without it.
    """

    def __init__(self, http: httpx.AsyncClient, backoff: DovRateLimitState | None = None) -> None:
        """Initialise with the shared HTTP client."""
        super().__init__(__name__)
        self._http = http
        self._backoff = backoff

    async def fetch_bbox(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        parameters: str | Sequence[str],
        parent_permkeys: set[str] | None = None,
    ) -> list[ScalarObservationWfsRow]:
        """Return all matching scalar observations in *bbox*.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        parameters : str | Sequence[str]
            One parameter string (single CQL ``=`` filter) OR a sequence of
            strings (CQL ``IN`` filter). The Atterberg phase passes a
            two-element list (LL + PL); CaCO3 / organic / water-content
            phases each pass a single string.
        parent_permkeys : set[str] | None
            When provided, drop observations whose parent sample isn't in
            the set. Mirrors the C3 grain-size client's filter semantics.

        Returns
        -------
        list[ScalarObservationWfsRow]
            One row per matching observation. May be empty.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        params_label = parameters if isinstance(parameters, str) else f"[{len(parameters)} params]"
        self.debug(
            f"DOV scalar-observation bbox WGS84: "
            f"W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"filter={params_label}"
        )

        cql_filter = self._build_cql_filter(parameters)
        # Delegate the count + recursive split + dedup pattern to the shared
        # helper. We retain ownership of the WFS request shape (layer name,
        # CQL filter, error wording, feature-property warnings) by passing
        # ``_wfs_count`` and ``_wfs_features`` as bound callables.
        rows = await collect_wfs_features_recursive(
            fetch_count=partial(self._wfs_count, cql_filter),
            fetch_features=partial(self._wfs_features, cql_filter),
            row_permkey=lambda r: r.permkey,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label=f"DOV scalar-observation WFS [{params_label}]",
            logger=self,
        )
        self.info(
            f"DOV scalar-observation WFS: {len(rows)} observations in bbox (filter={params_label})"
        )

        if parent_permkeys is not None:
            before = len(rows)
            rows = [r for r in rows if r.parent_sample_permkey in parent_permkeys]
            self.debug(
                f"DOV scalar-observation WFS: filtered {before} → {len(rows)} rows "
                f"by parent sample (limit set: {len(parent_permkeys)} samples)"
            )
        return rows

    # ------------------------------------------------------------------
    # CQL construction
    # ------------------------------------------------------------------

    @staticmethod
    def _build_cql_filter(parameters: str | Sequence[str]) -> str:
        """Build a CQL filter for the given parameter constraint.

        Single string → ``parameter='X'``; sequence → ``parameter IN ('X','Y')``.
        Single-quoting is intentional — DOV's parameter strings frequently
        contain spaces and parentheses, which CQL handles inside single quotes.
        We assume parameter values don't contain a single-quote character
        themselves (verified live: every probed parameter is plain text).
        """
        if isinstance(parameters, str):
            return f"{DOV_OBSERVATIE_WFS_PARAMETER_PROP}='{parameters}'"
        quoted = ",".join(f"'{p}'" for p in parameters)
        return f"{DOV_OBSERVATIE_WFS_PARAMETER_PROP} IN ({quoted})"

    # ------------------------------------------------------------------
    # WFS request layer (count + features). The recursive bbox-split lives
    # in ``dov_wfs_bbox.collect_wfs_features_recursive`` and reaches these
    # via ``functools.partial`` from ``fetch_bbox``.
    # ------------------------------------------------------------------

    async def _wfs_count(self, cql_filter: str, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of observations matching the filter in this bbox."""
        return await wfs_count(
            self._http,
            self,
            layer=DOV_WFS_OBSERVATIES_LAYER,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            cql_filter=cql_filter,
            label="scalar-observation",
            backoff=self._backoff,
        )

    async def _wfs_features(
        self, cql_filter: str, x1: float, y1: float, x2: float, y2: float
    ) -> list[ScalarObservationWfsRow]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT scalar observation rows."""
        features = await wfs_features_json(
            self._http,
            self,
            layer=DOV_WFS_OBSERVATIES_LAYER,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            cql_filter=cql_filter,
            label="scalar-observation",
            backoff=self._backoff,
        )
        if features:
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV scalar-observation WFS feature properties: {first_props}")

        rows: list[ScalarObservationWfsRow] = []
        skipped_no_parent = 0
        for feat in features:
            props: dict[str, Any] = feat.get("properties", {})
            row = _build_row(props)
            if row is None:
                skipped_no_parent += 1
                continue
            rows.append(row)

        if skipped_no_parent:
            available = list(features[0].get("properties", {}).keys()) if features else "(none)"
            self.warning(
                f"DOV scalar-observation WFS: skipped {skipped_no_parent} rows with no "
                f"parent sample link. Available properties: {available}"
            )
        return rows


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _build_row(props: dict[str, Any]) -> ScalarObservationWfsRow | None:
    """Build a ``ScalarObservationWfsRow`` from a WFS feature ``properties`` dict.

    Returns ``None`` when the feature lacks a parent-sample link
    (``gekoppeld_aan_link``) or its own observation URL — both required to
    establish a stable identity. Rows where ``resultaat`` is null but a
    ``detectieconditie`` is set (e.g. ``"NM"`` for non-plastic) ARE kept;
    the mapper handles the null-with-condition case downstream.
    """
    obs_url: str = props.get(DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP) or ""
    if not obs_url:
        return None
    parent_link: str = props.get(DOV_OBSERVATIE_WFS_PARENT_LINK_PROP) or ""
    if not parent_link:
        return None
    parent_permkey = last_path_segment(parent_link)
    if not parent_permkey:
        return None

    permkey = last_path_segment(obs_url)
    return ScalarObservationWfsRow(
        permkey=permkey,
        parent_sample_permkey=parent_permkey,
        parametergroep=props.get(DOV_OBSERVATIE_WFS_PARAMETERGROEP_PROP) or "",
        parameter=props.get(DOV_OBSERVATIE_WFS_PARAMETER_PROP) or "",
        resultaat=props.get(DOV_OBSERVATIE_WFS_RESULTAAT_PROP) or None,
        eenheid=props.get(DOV_OBSERVATIE_WFS_EENHEID_PROP) or None,
        methode=props.get(DOV_OBSERVATIE_WFS_METHODE_PROP) or None,
        fenomeentijd=optional_date(props.get(DOV_OBSERVATIE_WFS_FENOMEENTIJD_PROP)),
        detectieconditie=props.get(DOV_OBSERVATIE_WFS_DETECTIECONDITIE_PROP) or None,
    )
