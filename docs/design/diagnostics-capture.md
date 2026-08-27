# Local diagnostics capture (debt #16)

Current state. Load before touching anything under `desktop/src/main/diagnostics*`,
`crashBundle.ts`, `zipArchive.ts` or `desktop/src/renderer/src/utils/diagnostics.ts`.

**The shape: capture is local and always on; transmission is opt-in and has no
endpoint.** A log file in the user's own app directory is not telemetry — it is
what makes "it crashed on my machine" answerable. Sending it anywhere is a
separate, deliberate act.

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
```

Capture never throws: every call site is already an error path, and a
diagnostics write that masked the original failure would be the worst trade in
the file.

---

## The crash bundle — the only route that exists today

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

## Transmission — a stub, on purpose

`diagnosticsTransport.ts` defines the seam and ships `NO_ENDPOINT_TRANSPORT`,
which refuses everything. `transmitDiagnostics()` checks **consent first, outside
the transport**, so no future transport implementation can be the thing that
decides whether consent mattered.

Two gates, both currently closed:

1. the user opted in (`consent.json`, default NO, every damaged-file case reads
   as NO);
2. an endpoint exists (none does).

**Open decisions, both for the owner:**

* **Where do reports go?** Own collector, hosted service, or mail-only. Cost,
  privacy policy and DPA attach to the answer — see the activation memo.
* **The Settings toggle.** The flag, its file format and the gate are shipped;
  the UI is deliberately not, because a switch that controls nothing is worse
  than none. It lands with the endpoint.
