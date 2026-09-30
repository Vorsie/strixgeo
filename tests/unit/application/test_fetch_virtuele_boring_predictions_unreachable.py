"""DOV being slow or unreachable is a degraded path, not a server error.

Owner's dev log 2026-09-27/29: ``GET /projects/{id}/virtuele-boring/predictions``
answered 500 with a full traceback twice. DOV's virtueleboringserver timed out
(``httpx.ReadError``, ``httpx.ConnectTimeout``) for ONE investigation of 63,
the transport error escaped ``asyncio.gather`` and killed the whole response.

The rules these tests pin, in the ruling's own words:

* one investigation that DOV does not answer is skipped, with a reason; the
  other investigations still return their predictions (200);
* when EVERY investigation failed for a network reason, the route answers
  503 with ``code = "dov_unreachable"``;
* a non-network exception is a bug and still propagates -- it must not be
  swallowed as "DOV was down".

No database and no network: the repositories, the DOV HTTP client factory and
the Virtuele Boring client are replaced by fakes on the use-case module.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from groundmodel.api.routers.virtuele_boring import project_router
from groundmodel.application import fetch_virtuele_boring_predictions as use_case_module
from groundmodel.application.fetch_virtuele_boring_predictions import (
    FetchVirtueleBoringPredictions,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.dov.virtuele_boring_client import (
    VirtueleBoringFetchError,
)
from groundmodel.infrastructure.parsers.dov.virtuele_boring_result import (
    VirtueleBoringLayer,
    VirtueleBoringResult,
)
from groundmodel.shared.exceptions import DovUnreachableError

LAMBERT72 = 31370
MODEL = "g3dv3_F"
INVESTIGATION_COUNT = 63
UNREACHABLE_MESSAGE = "DOV is not reachable right now; the predictions will load when it is."


def _cpts(count: int) -> list[SimpleNamespace]:
    """Return ``count`` fake Lambert-72 CPT rows at x = 0, 1, 2, ..."""
    return [
        SimpleNamespace(
            id=uuid4(),
            test_id=f"CPT-{i:02d}",
            epsg=LAMBERT72,
            location_x=float(i),
            location_y=200000.0,
            elevation_m=5.0,
        )
        for i in range(count)
    ]


def _layer() -> VirtueleBoringLayer:
    """Return one plausible DOV layer."""
    return VirtueleBoringLayer(
        code="g3dv3_F_1",
        name="Quartair",
        beschrijving="Quartaire afzettingen",
        top_m_taw=5.0,
        base_m_taw=-10.0,
        thickness_m=15.0,
        color_hex="#ffff00",
        ncs_link=None,
    )


def _install_fakes(
    monkeypatch: pytest.MonkeyPatch,
    cpts: list[SimpleNamespace],
    behaviour: Callable[[float], BaseException | None],
) -> None:
    """Replace the repos, the DOV HTTP factory and the client on the use case.

    ``behaviour(x)`` returns ``None`` to answer with one layer, or an
    exception instance for ``fetch_doorprik`` to raise at that x.
    """

    class _CptRepo:
        def __init__(self, _session: Any) -> None:
            pass

        async def list_all(self, app_project_id: UUID) -> list[SimpleNamespace]:
            return cpts

    class _BoreholeRepo:
        def __init__(self, _session: Any) -> None:
            pass

        async def list_all(self, app_project_id: UUID) -> list[SimpleNamespace]:
            return []

    @asynccontextmanager
    async def _http() -> AsyncIterator[object]:
        yield object()

    class _Client:
        def __init__(self, _http: object) -> None:
            pass

        async def fetch_doorprik(self, x: float, y: float, model: str) -> VirtueleBoringResult:
            err = behaviour(x)
            if err is not None:
                raise err
            return VirtueleBoringResult(
                model_code=model, x_lambert72=x, y_lambert72=y, layers=[_layer()]
            )

    monkeypatch.setattr(use_case_module, "CptRepository", _CptRepo)
    monkeypatch.setattr(use_case_module, "BoreholeRepository", _BoreholeRepo)
    monkeypatch.setattr(use_case_module, "make_dov_async_client", _http)
    monkeypatch.setattr(use_case_module, "VirtueleBoringClient", _Client)


async def _run() -> Any:
    """Execute the use case for one model (the session is never touched)."""
    use_case = FetchVirtueleBoringPredictions(session=object())  # type: ignore[arg-type]
    return await use_case.execute(uuid4(), [MODEL])


async def test_one_investigation_timing_out_does_not_blank_the_other_62(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DOV times out on ONE investigation: the other 62 return, one skipped with a reason."""
    cpts = _cpts(INVESTIGATION_COUNT)
    slow = cpts[17]
    _install_fakes(
        monkeypatch,
        cpts,
        lambda x: httpx.ReadTimeout("timed out") if x == slow.location_x else None,
    )

    result = await _run()

    answered = [p for p in result.predictions if p.predictions_by_model]
    assert len(answered) == INVESTIGATION_COUNT - 1
    assert len(result.skipped) == 1
    skipped = result.skipped[0]
    assert skipped.investigation_id == slow.id
    assert skipped.name == slow.test_id
    assert skipped.model == MODEL
    assert skipped.reason == "dov_unreachable"
    assert skipped.detail == "ReadTimeout"


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectTimeout("connect timed out"),
        httpx.ReadTimeout("read timed out"),
        httpx.ReadError("connection reset"),
        httpx.ConnectError("name resolution failed"),
        httpx.RemoteProtocolError("server disconnected"),
    ],
    ids=lambda e: type(e).__name__,
)
async def test_every_investigation_failing_for_a_network_reason_is_dov_unreachable(
    monkeypatch: pytest.MonkeyPatch, error: httpx.TransportError
) -> None:
    """Every investigation fails for a network reason: the use case says DOV is unreachable."""
    _install_fakes(monkeypatch, _cpts(5), lambda _x: error)

    with pytest.raises(DovUnreachableError):
        await _run()


async def test_a_mix_of_network_and_http_failures_is_not_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DOV answered at least once (an HTTP error): it is reachable, every skip explained."""
    http_failure = VirtueleBoringFetchError(500, "boom", "https://dov/doorprik")
    _install_fakes(
        monkeypatch,
        _cpts(3),
        lambda x: http_failure if x == 0.0 else httpx.ReadTimeout("timed out"),
    )

    result = await _run()

    assert [s.reason for s in result.skipped] == [
        "dov_http_error",
        "dov_unreachable",
        "dov_unreachable",
    ]
    assert result.skipped[0].detail == "HTTP 500"


async def test_a_non_network_exception_still_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bug (not a network failure) must not be swallowed as 'DOV was down'."""
    _install_fakes(monkeypatch, _cpts(4), lambda x: ValueError("bug") if x == 2.0 else None)

    with pytest.raises(ValueError, match="bug"):
        await _run()


def _route_client() -> TestClient:
    """Mount the project router with a dummy session (the repos are faked)."""
    app = FastAPI()
    app.include_router(project_router)
    app.dependency_overrides[get_session] = lambda: object()
    return TestClient(app)


def test_route_answers_503_dov_unreachable_when_every_investigation_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """All time out: 503 with code ``dov_unreachable``, not a 500 traceback."""
    _install_fakes(monkeypatch, _cpts(INVESTIGATION_COUNT), lambda _x: httpx.ConnectTimeout("t"))

    response = _route_client().get(
        f"/projects/{uuid4()}/virtuele-boring/predictions", params={"models": MODEL}
    )

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "dov_unreachable",
        "message": UNREACHABLE_MESSAGE,
    }


def test_route_partial_failure_is_200_with_the_skip_explained(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One times out: 200 with the 62 that came back and ``skipped`` explaining the rest."""
    cpts = _cpts(INVESTIGATION_COUNT)
    _install_fakes(monkeypatch, cpts, lambda x: httpx.ReadError("reset") if x == 0.0 else None)

    response = _route_client().get(
        f"/projects/{uuid4()}/virtuele-boring/predictions", params={"models": MODEL}
    )

    assert response.status_code == 200
    body = response.json()
    assert sum(1 for p in body["predictions"] if p["predictions_by_model"]) == 62
    assert body["skipped_count"] == 0
    assert body["skipped"] == [
        {
            "investigation_kind": "cpt",
            "investigation_id": str(cpts[0].id),
            "name": cpts[0].test_id,
            "model": MODEL,
            "reason": "dov_unreachable",
            "detail": "ReadError",
        }
    ]
