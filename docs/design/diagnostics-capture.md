# Local diagnostics capture (debt #16)

Current state. Load before touching anything under `desktop/src/main/diagnostics*`,
`crashBundle.ts`, `zipArchive.ts` or `desktop/src/renderer/src/utils/diagnostics.ts`.

**The shape: capture is local and always on; transmission is opt-in.** A log
file in the user's own app directory is not telemetry — it is what makes "it
crashed on my machine" answerable. Sending it anywhere is a separate, deliberate
act, gated on a consent flag that defaults to NO. When the user has opted in AND
an activation endpoint is configured, the redacted log is uploaded to the
strixgeo.com origin (owner ruling 2026-08-31: "diagnostics go to the same server"
as activation); otherwise nothing leaves the machine.

---

## What is captured — the exhaustive list

Every capture site, and nothing else:

| # | Site | File | Kind | Trigger |
|---|---|---|---|---|
| 1 | `process.on('uncaughtException')` | `index.ts` → `writeMainCrashLine` | `main-uncaught` | main-process exception that escaped every try/catch |
| 2 | `process.on('unhandledRejection')` | `index.ts` → `writeMainCrashLine` | `main-unhandled-rejection` | main-process promise nobody caught |
| 3 | `webContents.on('render-process-gone')` | `index.ts` | `renderer-gone` | the renderer died (reason + exit code) |
| 4 | `webContents.on('unresponsive')` | `index.ts` | `renderer-unresponsive` | renderer stopped answering |
| 5 | `ipcMain.handle('app:log-renderer-error')` | `index.ts` | `renderer-error` | covers **three** renderer paths that already routed here: `window.onerror`, `unhandledrejection`, and `ErrorBoundary.componentDidCatch` |
| 6 | `request()` on `status >= 500` | `api/clients/shared.ts` | `api-error` | a backend 5xx — the one failure only the client witnesses |
| 7 | packaged build with no expiry stamp | `index.ts` → `enforceBetaExpiry` | `unknown` (warning) | a release cut without the build-time stamp |

**Not captured** (deliberate): 4xx responses (the app refusing something is the
app working), `log.warn`/`log.info` lines, user actions, timings, feature usage,
machine identifiers, anything periodic. There is no session id, no device id and
no counter of any kind.

### The record

One NDJSON line per event, fields fixed by a whitelist
(`diagnosticsEvent.ts` — an unrecognised field is *absent*, not redacted):

```
ts, source (main|renderer|api), kind, severity, scope,
message, stack?, httpStatus?, appVersion, platform, buildId?
```

`appVersion`, `platform`, `buildId` and `ts` are stamped by the **main** process.
A renderer message claiming a different version or timestamp cannot override
them.

---

## Redaction (`diagnosticsRedaction.ts`)

Second layer, applied to `message` and `stack`. Ordered, mechanical, each rule
pinned by a test.

| Pattern | Becomes |
|---|---|
| Database connection string (`postgresql://…`) | `<dsn>` |
| `file://` URL | `<file-url>` |
| Path to a **data** file | `<path:.strix>` (extension kept) |
| Path to a **code** file (`.js .ts .py .asar .exe …`) | user name → `<user>`, module path kept |
| Home-directory user name anywhere | `<user>` |
| Email address | `<email>` |
| Routable IPv4 (not `127.0.0.1`) | `<ip>` |
| URL query string | `?<query>` |
| Coordinate pair (≥ 4 integer digits, twice) | `<coords>` |
| Anything over 2 000 chars | truncated |

**Kept on purpose:** UUIDs (meaningless without the user's own database, and the
only way to ask "which record?"), routes, HTTP statuses, stack frames, line
numbers, `127.0.0.1`. *The UUID decision is the one worth re-ruling if a customer
objects — one rule removes them.*

---

## Files

```
<userData>/diagnostics/diagnostics.log     NDJSON, rotated at 1 MiB × 3 generations
<userData>/diagnostics/diagnostics.log.1   (…2, .3)
<userData>/diagnostics/consent.json        transmission opt-in, default absent = NO
<userData>/diagnostics/outbox/*.json       queued upload bundles (≤ 20, oldest evicted)
<userData>/diagnostics/outbox/highwater.json  newest event already queued (stops re-sends)
```

Capture never throws: every call site is already an error path, and a
diagnostics write that masked the original failure would be the worst trade in
the file.

---

## The crash bundle — the user-driven route

**Help → Save diagnostics bundle…** builds a real `.zip` (written by
`zipArchive.ts`, Node `zlib` only — **no new dependency**) containing:

* `manifest.json` — build facts, event count, the consent answer, a
  plain-language statement of what was removed, and the list of entries;
* `diagnostics.log` (+ rotated generations) — redacted by construction;
* `backend.log` — **redacted here, on the way in**, because the backend's own
  stdout carries the asyncpg DSN and raw paths. Trimmed to the last 256 KiB with
  `[earlier lines trimmed]` marking the cut.

Nothing else from the logs directory travels. Whitelist, not sweep.

A confirmation dialog names the contents and the redaction before the user sends
anything.

---

## Transmission — the disk-queued uploader

`diagnosticsUploader.ts` is the transmit half. It runs once at launch (after the
activation setup, wired in `index.ts`) and then, only while its queue is
non-empty, on a backing-off interval. Two gates, checked before anything else; a
no-op unless BOTH open:

1. **Consent** — `consent.json`, default NO, every damaged-file case reads as NO.
2. **An endpoint** — the activation base URL (`activationConfig.ts`, the SAME
   origin as activation per the owner ruling). The mock/dogfeed default has none,
   so the uploader is inert there — nothing is queued and nothing is sent.

### What it does when both gates open

* **Build + enqueue** (at launch). Reads the events captured since the last
  upload — a `outbox/highwater.json` marker bounds re-sends — builds the
  `POST /v1/diagnostics` payload (build facts + the redacted NDJSON tail + a
  `truncated` flag), trims it to the 512 KiB cap by dropping the OLDEST records,
  and writes it as one JSON file in `outbox/`.
* **Queue on disk, bounded.** One file per bundle, oldest-first, at most 20; a
  21st evicts the oldest. Durable across restarts.
* **Drain oldest-first.** Each bundle is POSTed over the SAME fetch/timeout
  transport the activation client uses (`httpPostJson.ts`, extracted from the
  activation client so there is one copy). A 2xx removes the bundle; a 4xx (or an
  unreadable file) drops it — a bundle the server refuses can never be accepted,
  so keeping it would wedge the queue; a 5xx or a network failure keeps it and
  stops the pass, to retry after an exponential backoff.
* **Logs every attempt** at INFO with the status + byte size, and at WARNING what
  was dropped and why.

The contract the server must implement is
[activation-api-contract.md](activation-api-contract.md) §`POST /v1/diagnostics`.

### Identity — an open owner decision

The payload CAN carry the device's licence key + device id, but **the client
omits them today.** The record whitelist above states, and its tests pin, that a
diagnostics record carries no device id and no session id; attaching identity to
the upload reverses that shipped invariant. It is gated behind one flag —
`ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS`, default off in
`diagnosticsUploaderConstants.ts`. Flip it in the same change that records the
owner's ruling, and identity is attached only when an activation licence exists.

### Still not built (owner)

* **The Settings toggle.** The consent flag, its file format and the gate are
  shipped; the UI to flip it is not. Until it exists a user cannot opt in through
  the app, so the uploader stays inert in practice even where an endpoint is
  configured — the toggle is the remaining client piece before transmission is
  usable.
* **The server.** `POST /v1/diagnostics` is specified; the strixgeo.com endpoint
  that answers it is not built (same MySQL host as activation, owner ruling).
* **Cross-session dedup is best-effort.** The high-water marker stops the same
  events being queued twice; a bundle already queued but not yet uploaded, plus a
  `bundleId` collision, are the server's to dedup — the client does not hash
  contents.
