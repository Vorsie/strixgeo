"""DEV-ONLY in-memory stub of the strixgeo.com activation service.

This is **not** production code and ships nowhere near a customer. It implements
the HTTP contract in ``docs/design/activation-api-contract.md`` with an in-memory
dictionary so the desktop client's :class:`HttpActivationRepository` can be
exercised end-to-end on a developer machine, no MySQL and no Stripe.

What it models, faithfully to the contract:

* ``POST /activate`` — binds a known key to a device, honouring the per-tier
  device cap (Solo = 1, owner ruling 15); a second device is refused; re-activating
  the same device is an idempotent refresh.
* ``POST /trial`` — issues a 30-day trial licence, once per device.
* ``POST /deactivate`` — releases a device's bindings (the self-service transfer).
* ``POST /refresh`` — re-issues a licence for a still-bound device (the launch-time
  online re-check).
* ``POST /v1/diagnostics`` — accepts a redacted diagnostics bundle (the JSON
  envelope: build facts + NDJSON tail) and acknowledges it with a server id.

What it does NOT do (and a real server must): sign the licence (Ed25519), check a
Stripe subscription, or persist bindings across restarts. Keys live in a small
JSON *ledger* file (the stand-in for the MySQL keys table) so a key minted with
``--mint`` survives into a running ``--serve``; bindings and trials are in-memory.

Run it::

    uv run python scripts/dev/activation_stub_server.py                 # serve on 127.0.0.1:8799
    uv run python scripts/dev/activation_stub_server.py --mint solo     # print a fresh Solo key
    # then point the desktop dev build at it:
    #   $env:STRIXGEO_ACTIVATION_URL = "http://127.0.0.1:8799"   (PowerShell)

Never bind this to port 8765 (the dev app + e2e stack own it).
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# --- Contract constants (mirror the client + the contract doc) ---------------

#: Per-tier device cap. Solo = 1 is owner ruling 15; the rest are prototype guesses.
DEVICE_CAP_BY_TIER: dict[str, int] = {"solo": 1, "pro": 2, "studio": 25}

#: Paid subscription term and trial term, in milliseconds.
PAID_TERM_MS: int = 365 * 24 * 60 * 60 * 1000
TRIAL_TERM_MS: int = 30 * 24 * 60 * 60 * 1000

#: Offline grace the licence carries (owner ruling 14), in whole days.
GRACE_DAYS: int = 30

#: Demo keys always available, so the stub works before any key is minted.
DEMO_KEYS: dict[str, str] = {
    "STRIX-SOLO-DEMO": "solo",
    "STRIX-PRO-DEMO": "pro",
    "STRIX-STUDIO-DEMO": "studio",
}

#: Default key-ledger path (the stand-in "MySQL keys table"); a temp file, dev-only.
DEFAULT_DB_PATH: Path = Path(tempfile.gettempdir()) / "strixgeo_activation_stub.json"

#: Default bind address / port. 8799 is chosen to stay clear of 8765 (dev app + e2e).
DEFAULT_HOST: str = "127.0.0.1"
DEFAULT_PORT: int = 8799


# --- Request bodies ----------------------------------------------------------


class ActivateBody(BaseModel):
    """Body of ``POST /activate``: a key plus the device asking."""

    key: str
    deviceId: str
    deviceLabel: str = ""
    appVersion: str | None = None


class TrialBody(BaseModel):
    """Body of ``POST /trial``: the device asking for a trial licence."""

    deviceId: str
    deviceLabel: str = ""
    appVersion: str | None = None


class DeactivateBody(BaseModel):
    """Body of ``POST /deactivate``: the device to release."""

    deviceId: str


class RefreshBody(BaseModel):
    """Body of ``POST /refresh``: the device + key to re-verify."""

    deviceId: str
    key: str


# --- Ledger helpers ----------------------------------------------------------


def load_ledger(path: Path) -> dict[str, str]:
    """Read the key ledger, always including the demo keys.

    Parameters
    ----------
    path : Path
        The ledger file. A missing or unreadable file yields just the demo keys.

    Returns
    -------
    dict[str, str]
        ``key -> tier`` for every valid row, merged over the demo keys.
    """
    if not path.exists():
        return dict(DEMO_KEYS)
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return dict(DEMO_KEYS)
    minted = {k: v for k, v in data.items() if isinstance(v, str) and v in DEVICE_CAP_BY_TIER}
    return {**DEMO_KEYS, **minted}


def mint_key(tier: str, path: Path) -> str:
    """Mint an opaque key for ``tier`` and append it to the ledger.

    Parameters
    ----------
    tier : str
        One of ``solo`` / ``pro`` / ``studio``.
    path : Path
        The ledger file to append to (created if absent).

    Returns
    -------
    str
        The freshly minted opaque key.
    """
    key = f"strix_{tier}_{secrets.token_hex(16)}"
    ledger: dict[str, str] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text("utf-8"))
            if isinstance(loaded, dict):
                ledger = loaded
        except (OSError, ValueError):
            ledger = {}
    ledger[key] = tier
    path.write_text(json.dumps(ledger, indent=2), "utf-8")
    return key


# --- In-memory state ---------------------------------------------------------


class StubState:
    """The stub's mutable, in-memory activation state.

    Bindings (``key -> set(deviceId)``) and the trial ledger live only for the
    process. Keys are either injected static (tests) or re-read from the ledger on
    each lookup (serving), so a key minted while the server runs is picked up.
    """

    def __init__(self, keys: dict[str, str], ledger_path: Path | None = None) -> None:
        """Build the state.

        Parameters
        ----------
        keys : dict[str, str]
            Initial ``key -> tier`` map.
        ledger_path : Path | None
            When set, every :meth:`tier_for` re-reads this ledger so newly minted
            keys become active without a restart. ``None`` keeps ``keys`` static.
        """
        self._keys = dict(keys)
        self._ledger_path = ledger_path
        self.bindings: dict[str, set[str]] = {}
        self.trialled: set[str] = set()

    def tier_for(self, key: str) -> str | None:
        """Return the tier a key grants, or ``None`` if unknown.

        Parameters
        ----------
        key : str
            The licence key.

        Returns
        -------
        str | None
            The tier, re-reading the ledger first when serving.
        """
        if self._ledger_path is not None:
            self._keys = load_ledger(self._ledger_path)
        return self._keys.get(key)


# --- Response helpers --------------------------------------------------------


def error_response(status: int, code: str, message: str) -> JSONResponse:
    """Build the contract's uniform error body.

    Parameters
    ----------
    status : int
        HTTP status code.
    code : str
        Machine-readable error code from the contract's vocabulary.
    message : str
        Human-readable detail (never echoes the key).

    Returns
    -------
    JSONResponse
        ``{"error": {"code": code, "message": message}}`` at ``status``.
    """
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def mint_licence(
    key: str, tier: str, device_id: str, device_label: str, *, is_trial: bool
) -> dict[str, object]:
    """Mint the contract's wire licence.

    Parameters
    ----------
    key : str
        The licence key (or trial token).
    tier : str
        The commercial tier.
    device_id : str
        The device the licence is bound to.
    device_label : str
        The device's human label, echoed back.
    is_trial : bool
        Whether this is a time-limited trial licence.

    Returns
    -------
    dict[str, object]
        The wire licence: timestamps as epoch-millisecond integers, grace as days.
    """
    now_ms = int(time.time() * 1000)
    term = TRIAL_TERM_MS if is_trial else PAID_TERM_MS
    return {
        "key": key,
        "tier": tier,
        "seatId": f"{key}:{device_id}",
        "isTrial": is_trial,
        "issuedAt": now_ms,
        "expiresAt": now_ms + term,
        "graceDays": GRACE_DAYS,
        "deviceId": device_id,
        "deviceLabel": device_label,
    }


# --- App factory -------------------------------------------------------------


def create_app(*, keys: dict[str, str] | None = None, ledger_path: Path | None = None) -> FastAPI:
    """Build the stub FastAPI app.

    Parameters
    ----------
    keys : dict[str, str] | None
        An explicit ``key -> tier`` map for an isolated, static app (tests). When
        ``None``, keys come from the ledger and stay live (serving).
    ledger_path : Path | None
        The ledger to read when ``keys`` is ``None``; defaults to
        :data:`DEFAULT_DB_PATH`.

    Returns
    -------
    FastAPI
        The configured app.
    """
    if keys is None:
        resolved = ledger_path or DEFAULT_DB_PATH
        state = StubState(load_ledger(resolved), ledger_path=resolved)
    else:
        state = StubState(keys)

    app = FastAPI(title="StrixGeo activation stub (DEV ONLY)", docs_url=None, redoc_url=None)

    @app.post("/activate")
    async def activate(body: ActivateBody) -> object:
        """Activate or refresh a paid licence, honouring the per-tier device cap."""
        tier = state.tier_for(body.key)
        if tier is None:
            return error_response(404, "key_unknown", "key not recognised")
        bound = state.bindings.setdefault(body.key, set())
        # Re-activating the same device is an idempotent refresh, not a new seat.
        if body.deviceId not in bound and len(bound) >= DEVICE_CAP_BY_TIER[tier]:
            code = "key_bound_elsewhere" if DEVICE_CAP_BY_TIER[tier] == 1 else "seat_exhausted"
            return error_response(
                409, code, "device limit reached; deactivate a device to transfer"
            )
        bound.add(body.deviceId)
        return {
            "licence": mint_licence(body.key, tier, body.deviceId, body.deviceLabel, is_trial=False)
        }

    @app.post("/trial")
    async def trial(body: TrialBody) -> object:
        """Issue a 30-day trial licence, once per device (owner ruling 16)."""
        if body.deviceId in state.trialled:
            return error_response(
                409, "trial_already_used", "this device already used its free trial"
            )
        state.trialled.add(body.deviceId)
        return {
            "licence": mint_licence(
                "STRIX-TRIAL", "solo", body.deviceId, body.deviceLabel, is_trial=True
            )
        }

    @app.post("/deactivate")
    async def deactivate(body: DeactivateBody) -> object:
        """Release every binding a device holds (idempotent) — the transfer path."""
        for bound in state.bindings.values():
            bound.discard(body.deviceId)
        return {"released": True}

    @app.post("/refresh")
    async def refresh(body: RefreshBody) -> object:
        """Re-issue a licence for a still-bound device (the launch-time re-check)."""
        tier = state.tier_for(body.key)
        if tier is None:
            return error_response(404, "key_unknown", "key not recognised")
        if body.deviceId not in state.bindings.get(body.key, set()):
            return error_response(409, "key_bound_elsewhere", "this device is not bound to the key")
        return {"licence": mint_licence(body.key, tier, body.deviceId, "", is_trial=False)}

    @app.post("/v1/diagnostics")
    async def diagnostics(request: Request) -> JSONResponse:
        """Accept a redacted diagnostics bundle (JSON envelope) and acknowledge it.

        The client posts the ``POST /v1/diagnostics`` envelope from
        ``docs/design/activation-api-contract.md`` — build facts, a redacted
        NDJSON tail and a ``truncated`` flag, plus optional identity. The stub
        only acknowledges receipt with a fresh server id; a real server persists
        the bundle. A body that is not JSON is a ``bad_request`` (a 4xx, which the
        client drops rather than retries).
        """
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            return error_response(400, "bad_request", "diagnostics body was not JSON")
        events = body.get("events") if isinstance(body, dict) else None
        return JSONResponse(
            status_code=202,
            content={
                "received": True,
                "id": f"diag_{secrets.token_hex(8)}",
                "events": events if isinstance(events, int) else 0,
            },
        )

    return app


def main(argv: list[str] | None = None) -> None:
    """CLI entry point: ``--mint`` a key, otherwise serve the stub.

    Parameters
    ----------
    argv : list[str] | None
        Argument vector (defaults to ``sys.argv[1:]``).
    """
    parser = argparse.ArgumentParser(description="DEV-ONLY StrixGeo activation stub server.")
    parser.add_argument(
        "--mint", choices=sorted(DEVICE_CAP_BY_TIER), help="mint a key for TIER, print it, exit"
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="bind address (default 127.0.0.1)")
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help="bind port (default 8799; never 8765)"
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="key ledger path")
    args = parser.parse_args(argv)

    if args.mint:
        print(mint_key(args.mint, args.db))
        return

    # Import uvicorn lazily so importing this module for tests does not need it.
    import uvicorn

    print(
        f"DEV activation stub on http://{args.host}:{args.port} (ledger: {args.db})",
        file=sys.stderr,
    )
    print(
        f"point the desktop dev build at it: STRIXGEO_ACTIVATION_URL=http://{args.host}:{args.port}",
        file=sys.stderr,
    )
    uvicorn.run(create_app(ledger_path=args.db), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
