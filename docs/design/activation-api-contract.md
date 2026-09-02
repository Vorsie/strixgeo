# Activation HTTP API contract (debt #3)

**Audience:** whoever builds the activation service on the strixgeo.com hosting
(MySQL, per the owner's "Activation host" ruling). **You do not need to read the
desktop client** — this document is the whole contract. Implement these
endpoints and the desktop app talks to you unchanged.

**Status:** the desktop *client half* is landed (`httpActivationRepository.ts`,
`deviceIdentity.ts`, `activationConfig.ts`, and the in-memory
`scripts/dev/activation_stub_server.py`). The server is not built. This is what
it must do.

The engine is yours (MySQL is the lean; the client neither knows nor cares). The
contract below is engine-agnostic: JSON over HTTPS, nothing more.

---

## 1. Conventions

* **Transport:** HTTPS only. Never serve this over plain HTTP — the licence key
  is a credential and travels in the request body.
* **Base URL:** one origin + path prefix, e.g. `https://strixgeo.com/api/activation`.
  The client appends `/activate`, `/trial`, etc. It is configured on the client
  as one value (`STRIXGEO_ACTIVATION_URL` in dev; a packaged-build constant) — a
  trailing slash is stripped by the client, so `.../activation` and
  `.../activation/` are equivalent.
* **Requests:** `POST`, `Content-Type: application/json`, `Accept: application/json`,
  a JSON object body.
* **Timeouts:** the client aborts a request after ~10 s and treats the abort as
  *unreachable* (see §6). Keep p99 latency well under that.
* **All timestamps are integer milliseconds since the Unix epoch, UTC.** Not
  seconds, not ISO strings. (`round(microtime(true) * 1000)` in PHP.)
* **The key is opaque.** Its format (random token vs Ed25519-signed vs
  tier-salted) is an OPEN owner decision — see §8. Treat it as an arbitrary
  string on the wire; do not assume structure.

---

## 2. Endpoints

| Method & path | Purpose | Called by the client |
|---|---|---|
| `POST /activate` | Bind a paid key to a device; return its licence. | When the user enters a key. |
| `POST /trial` | Issue a one-per-device time-limited trial licence. | "Start free trial". |
| `POST /deactivate` | Release a device's bindings (self-service transfer). | "Deactivate / transfer". |
| `POST /refresh` | Re-verify a still-bound device and re-issue its licence. | On launch when online (resets the offline-grace clock). |
| `POST /diagnostics` | Accept a consent-gated redacted NDJSON diagnostics bundle. | Only when the user opted in (debt #16). |

> The current client wires `POST /activate`, `/trial` and `/deactivate` (the
> `ActivationRepository` interface). `POST /refresh` and `POST /diagnostics` are
> specified here because they are part of the server's job and the next client
> slice; implement all five.

---

## 3. The licence object (returned by `/activate`, `/trial`, `/refresh`)

Every success response wraps ONE licence under a `licence` key:

```json
{
  "licence": {
    "key":        "strix_solo_9f0c…",        // opaque; echo the key that was activated (trial: a trial token)
    "tier":       "solo",                     // one of: solo | pro | studio
    "seatId":     "seat_01H…",                // your seat identifier for this binding (for your records + a future transfer UI)
    "isTrial":    false,                      // true only for /trial licences
    "issuedAt":   1756814400000,              // epoch ms, when you minted this
    "expiresAt":  1788350400000,              // epoch ms, authoritative end of the paid period / trial
    "graceDays":  30,                         // offline grace after expiresAt (owner ruling 14 = 30)
    "deviceId":   "b1c9…",                    // echo the request's deviceId
    "deviceLabel":"WORKSTATION-7"             // echo the request's deviceLabel
  }
}
```

Client mapping (informative — you do not implement it): the client stores the
licence locally and, offline, opens the app while `now < expiresAt + graceDays`.
`seatId` is carried for your bookkeeping and a future transfer screen; the
current client does not persist it. `tier` MUST be exactly one of the three
values — any other string is rejected by the client as an unreadable licence.

**Production signature (open, §8):** Option C in the activation memo is an
Ed25519-signed licence the client verifies offline. When that lands, the signed
artefact is what the licence travels in; the field set above is unchanged.

---

## 4. Requests, per endpoint

### `POST /activate`
```json
{ "key": "strix_solo_9f0c…", "deviceId": "b1c9…", "deviceLabel": "WORKSTATION-7", "appVersion": "1.0.0" }
```
* `deviceId` — a stable per-machine id the client derives from hardware (survives
  a reinstall; differs on another machine). Treat it as an opaque string.
* `deviceLabel` — a human name (the hostname), for your admin views + the transfer UI.
* `appVersion` — optional; log/segment on it if useful.
* **Success:** `200` + the licence (§3). **Errors:** `key_unknown`,
  `key_bound_elsewhere`, `seat_exhausted` (see §5).

### `POST /trial`
```json
{ "deviceId": "b1c9…", "deviceLabel": "WORKSTATION-7", "appVersion": "1.0.0" }
```
* Issue a trial licence bound to `deviceId`, `isTrial: true`, `tier: "solo"`, a
  server-chosen length (30 days suggested). **One per device.**
* **Success:** `200` + the licence. **Error:** `trial_already_used`.

### `POST /deactivate`
```json
{ "deviceId": "b1c9…" }
```
* Release every binding this device holds, freeing the seat(s) for transfer.
  **This IS the transfer:** once the seat is free, the same key activates on the
  next machine (the self-service deactivate/transfer flow ruling 15 made
  required — a laptop replacement or reinstall must not need a support email).
* `deviceId` alone identifies the bindings to drop; the key is not needed (a
  binding is keyed by device). When the Ed25519 signed licence lands (§8), the
  signed token travels alongside, exactly as §3 already handles the signature.
* **Success:** `200` `{ "released": true }` — you MAY also return
  `"seats_free": <int>` (how many seats the key now has open) for your own admin
  views; the current client ignores the body and treats any `2xx` as released.
  Idempotent (see §6).
* **Client error handling** (informative — how the desktop reacts):
  * `404` — the server holds no binding for this device. The client treats this
    as **already deactivated** and clears the local licence too, so a device
    whose binding was released elsewhere still returns to the activation screen.
    (A `200` no-op is equally fine and reaches the same local outcome; `404` is
    the alternative some servers return for an unknown device.)
  * `401` (or any other non-2xx) — the client **keeps** the local licence and
    surfaces the error; the seat may still be held, and a half-completed
    transfer that strands the seat is the worst outcome.
  * network failure / timeout — the client keeps the local licence and the user
    can retry; an offline deactivate fails loudly (see §6).

### `POST /refresh`
```json
{ "deviceId": "b1c9…", "key": "strix_solo_9f0c…" }
```
* Re-check the subscription (Stripe) for a still-bound device and re-issue its
  licence with a fresh `expiresAt` (this is what resets the client's offline-grace
  clock). If the device is no longer bound, or the key is unknown, error.
* **Success:** `200` + the licence. **Errors:** `key_unknown`, `key_bound_elsewhere`,
  `licence_expired`, `clock_rollback_suspected`.

### `POST /diagnostics`
* Body: the redacted NDJSON bundle — one JSON object per line — exactly as
  `desktop/.../diagnostics/diagnostics.log` (see `docs/design/diagnostics-capture.md`;
  already redacted client-side). `Content-Type: application/x-ndjson`.
* The client sends this ONLY when the user has opted in (consent default-off).
  Do not require any identity; there is no device id or session id in the payload
  by design.
* **Success:** `202` `{ "received": <int line count> }`.

---

## 5. Error vocabulary

Every non-2xx response is a uniform body:
```json
{ "error": { "code": "key_unknown", "message": "optional human detail — MUST NOT echo the key" } }
```
`code` is authoritative; `message` is a fallback log/display string. **Never put
the licence key in `message`** — it lands in client logs.

| `code` | HTTP | When | Client maps to |
|---|---|---|---|
| `key_unknown` | `404` | The key is not in your DB. | `unknown_key` |
| `key_bound_elsewhere` | `409` | The key is already bound to a *different* device and its cap is reached (Solo = 1 device). | `device_limit` |
| `seat_exhausted` | `409` | A multi-seat key (Pro/Studio) has every seat taken. | `device_limit` |
| `trial_already_used` | `409` | This `deviceId` has already consumed its one trial. | `already_trialled` |
| `licence_expired` | `403` | (`/refresh`) The subscription lapsed past its grace server-side. | client keeps its local verdict |
| `clock_rollback_suspected` | `403` | (`/refresh`) Your server-side clock/anti-fraud check tripped. | client's own monotonic guard also defends this |
| `bad_request` | `400` | Malformed/missing fields. | `unreachable` (conservative) |
| *(any)* | `5xx` | Server fault. | `unreachable` |

**The client collapses `key_bound_elsewhere` and `seat_exhausted` into one
"deactivate a device to transfer" message** — it still needs you to send the
distinct codes (for your records and a future UI), but do not expect two
different user-facing strings today. Any code the client does not recognise, plus
every network failure / timeout / 5xx / unreadable body, becomes `unreachable`:
the app then keeps its stored licence rather than trusting or destroying anything.

---

## 6. Idempotency & offline behaviour

**Idempotency (required):**
* `activate` — re-activating the **same** `(key, deviceId)` is a **refresh, not a
  new seat**: return `200` + a licence, do not increment the seat count. Only a
  *new* device beyond the cap is `409`.
* `trial` — the first call for a `deviceId` succeeds; every later call is `409`
  `trial_already_used`.
* `deactivate` — releasing an already-free device is a `200` no-op.
* `refresh` — read-mostly; safe to call repeatedly.

**Offline behaviour (client side, informative):**
* The client contacts you ONLY for these five actions. Between them the
  **locally-stored licence is the authority** — the app never phones home just to
  open. This is the "works for a month on site" promise (owner ruling 14).
* On any network failure or timeout, `activate`/`trial` return `unreachable` and
  the client keeps its stored licence; the app still opens while
  `now < expiresAt + graceDays`.
* `deactivate` **fails loudly** offline (the client surfaces an error and keeps
  the local licence) so a transfer is never half-completed with the seat
  stranded on the server. The one exception is a `404`: an unknown device is
  already released server-side, so the client clears the local licence and
  returns to the activation screen (see §4).
* A successful `refresh` with a later `expiresAt` is what resets the 30-day grace
  clock; a failed one is a silent no-op.

---

## 7. Security notes for the implementer

* HTTPS only; reject plain HTTP.
* Rate-limit `activate` per source IP / per key to blunt key-guessing.
* Do not reflect the key in any response body or log line.
* `deviceId` is a hardware-derived fingerprint, not a secret and not a person —
  it is fine to store, but it is not authentication on its own.
* Treat the request body as untrusted: validate types, bound string lengths.

---

## 8. Open decisions (owner) — do not invent these

* **Key format / signature.** Random opaque token, Ed25519-signed licence
  (Option C, recommended), or tier-salted key. This decides whether the licence
  carries a signature field and how the client verifies it offline. Until ruled,
  the client treats the key as an opaque string and does a shape-check only.
  See `docs/design/activation-decision-memo.md`.
* **Server engine.** MySQL is the lean (100 MB is ample). The client is engine-
  agnostic; build behind whatever you like.

---

## 9. Running the dev stub (local end-to-end without a server)

`scripts/dev/activation_stub_server.py` is a **dev-only** in-memory FastAPI
implementation of this contract — no MySQL, no Stripe, no signature. Use it to
exercise the desktop client end-to-end.

```powershell
# 1. Serve the stub (127.0.0.1:8799 — never 8765, the dev app + e2e own that port)
uv run python scripts/dev/activation_stub_server.py

# 2. (optional) mint a fresh key for a tier; it prints the key and records it in the ledger
uv run python scripts/dev/activation_stub_server.py --mint solo

# 3. Point the desktop DEV build at the stub, then `npm run dev` in desktop/
$env:STRIXGEO_ACTIVATION_URL = "http://127.0.0.1:8799"
```

Built-in demo keys work out of the box without minting: `STRIX-SOLO-DEMO`,
`STRIX-PRO-DEMO`, `STRIX-STUDIO-DEMO`. Bindings and trials are per-process
(restart the stub to reset them); minted keys persist in a small JSON ledger
(`--db PATH` to relocate it). With no `STRIXGEO_ACTIVATION_URL` set, the app uses
the in-memory mock issuer exactly as before — the stub is opt-in.

The stub's contract behaviours are pinned in
`tests/unit/scripts/test_activation_stub_server.py`.
