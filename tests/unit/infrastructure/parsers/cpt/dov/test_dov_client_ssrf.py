"""SSRF hardening for the DOV WFS client.

The `fiche` property of a WFS feature is an untrusted URL under the control of
whoever authored the response. Left unchecked it steers the client's next HTTP
GET at any host — a blind SSRF that could reach a link-local metadata endpoint
or an intranet service. Two guards are pinned here:

1. At URL construction (``_wfs_features``): a feature whose `fiche` resolves to
   a non-DOV host is skipped and logged — never turned into a download URL.
2. At the transport (``make_dov_async_client``): a cross-host redirect target
   is refused before the connection is made, so a DOV response that 302s our
   fetch off-host cannot be followed.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from groundmodel.infrastructure.parsers.cpt.dov import dov_client as dov_client_module
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import DovClient
from groundmodel.infrastructure.parsers.dov.dov_common import is_allowed_dov_url


def _feature(fiche: str, name: str) -> dict[str, Any]:
    return {
        "properties": {
            "fiche": fiche,
            "sondeernummer": name,
            "X_mL72": 150000.0,
            "Y_mL72": 200000.0,
        }
    }


class TestFicheHostAllowlist:
    """A WFS feature naming another host is skipped, not turned into a fetch URL."""

    @pytest.mark.asyncio
    async def test_off_host_fiche_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A feature whose fiche names a non-DOV host never becomes a fetch URL."""
        good = _feature("https://www.dov.vlaanderen.be/data/sondering/2021-000001", "S-good")
        # Classic SSRF target: the cloud metadata endpoint.
        evil = _feature("http://169.254.169.254/latest/meta-data/", "S-evil")

        async def fake_wfs_features_json(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
            return [good, evil]

        monkeypatch.setattr(dov_client_module, "wfs_features_json", fake_wfs_features_json)

        client = DovClient(http=httpx.AsyncClient())  # http is unused — the WFS call is stubbed
        try:
            with caplog.at_level("WARNING"):
                tuples = await client._wfs_features(0.0, 0.0, 1.0, 1.0)
        finally:
            await client._http.aclose()

        urls = [t[0] for t in tuples]
        # The metadata host never becomes a download URL.
        assert all("169.254.169.254" not in u for u in urls)
        # The legitimate DOV feature survives.
        assert any("www.dov.vlaanderen.be" in u for u in urls)
        assert len(tuples) == 1
        # And the refusal is logged with what was attempted.
        assert any("169.254.169.254" in rec.message for rec in caplog.records)

    def test_is_allowed_dov_url_predicate(self) -> None:
        """Only http(s) URLs on the DOV host are allow-listed."""
        assert is_allowed_dov_url("https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/x")
        assert not is_allowed_dov_url("http://169.254.169.254/latest/meta-data/")
        assert not is_allowed_dov_url("https://evil.example.com/data/sondering/x.xml")
        assert not is_allowed_dov_url("file:///etc/passwd")


class TestCrossHostRedirectRefused:
    """A DOV response that 302-redirects off-host is not followed."""

    @pytest.mark.asyncio
    async def test_cross_host_redirect_is_not_fetched(self) -> None:
        """A 302 pointing off-host is refused before the socket opens."""
        evil_calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            host = request.url.host
            if host == "www.dov.vlaanderen.be":
                # DOV (or a MITM) tries to steer us at an intranet host.
                return httpx.Response(302, headers={"location": "http://169.254.169.254/x"})
            evil_calls.append(str(request.url))
            return httpx.Response(200, content=b"secret")

        from groundmodel.infrastructure.parsers.dov.dov_http import _HostAllowlistTransport

        inner = httpx.MockTransport(handler)
        guarded = _HostAllowlistTransport(inner)
        async with httpx.AsyncClient(transport=guarded, follow_redirects=True) as client:
            with pytest.raises(httpx.RequestError):
                await client.get("https://www.dov.vlaanderen.be/data/sondering/x.xml")

        # The off-host hop was refused before any connection was attempted.
        assert evil_calls == []

    @pytest.mark.asyncio
    async def test_same_host_redirect_is_followed(self) -> None:
        """The legitimate same-host DOV 302 (fiche.xml -> proxy) still resolves."""

        # The legitimate DOV 302 (fiche.xml -> proxy, same host) must still work.
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith(".xml"):
                return httpx.Response(
                    302,
                    headers={
                        "location": "https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/x"
                    },
                )
            return httpx.Response(200, content=b"<xml/>")

        from groundmodel.infrastructure.parsers.dov.dov_http import _HostAllowlistTransport

        inner = httpx.MockTransport(handler)
        guarded = _HostAllowlistTransport(inner)
        async with httpx.AsyncClient(transport=guarded, follow_redirects=True) as client:
            resp = await client.get("https://www.dov.vlaanderen.be/data/sondering/x.xml")
        assert resp.status_code == 200
        assert resp.content == b"<xml/>"
