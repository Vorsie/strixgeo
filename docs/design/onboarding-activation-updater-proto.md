# Onboarding · Activation · Updater — reviewable prototype

**Status: PROTOTYPE for owner reaction, built overnight 2026-09-01 on branch
`onboarding-proto` (worktree `Strix-onboarding`). NOT landed, NOT pushed, NOT a
production feature.** The owner invited it — *"if you're bored, work on the
onboarding screen with a licensing option and an updater."* The wiring and the UX
are real; the DATA and the SERVERS are mocked, behind seams a production build
swaps out. Read this note first, then click the three surfaces in a dev launch.

Everything honours the owner's already-recorded rulings (CLAUDE.local.md →
"Rulings 2026-08-31" items 14–17 + 24, the "Activation host" note, and the
Commercial-planning tiers). Nothing here contradicts them; where a ruling is a
server-side concern it is left as a named TODO, not invented.

## How to see it (dev)

`npm run dev` in `desktop/`, then:

- **Onboarding** auto-opens on first launch (localStorage flag empty). Re-open
  any time from **Help → Getting started…**.
- **Licensing** — **Help → Licence & activation…**. Paste a demo key
  (`STRIX-SOLO-DEMO`, `STRIX-PRO-DEMO`, `STRIX-STUDIO-DEMO`), Start free trial,
  Deactivate, or use the **Preview a state** row (dev builds only) to jump
  straight to each screen.
- **Updater** — **Help → Check for updates…**. In dev this shows the "updates are
  disabled in development" acknowledgement (real behaviour — a dev build has no
  feed); a packaged build would show available / downloading / restart.

---

## A — Onboarding screen (debt #93, owner ruling 24)

Ruling 24: onboarding is **BOTH** a worked sample project **AND** a skippable
tour. The overlay is exactly that flow:

```
welcome  →  choose (Load sample | Start from scratch)  →  skippable tour (6 stages)
```

- Layers over `WelcomeScreen` via the shared `Modal` (Esc + backdrop dismiss,
  focus trap come free). A **Skip** affordance is on every screen.
- The tour names the six spine stages one sentence each — **Import → Geology →
  Lithology → Geotechnics → Sections → Export** — one stage per step with a
  progress-dot rail, Back/Next, and "Get started" on the last step.
- Gated on a persisted **"seen" flag** in `localStorage`
  (`strix.onboarding.seen.v1`). Per-device UI chrome, so it lives in
  localStorage, NOT in the `.strix` bundle (project_decisions_in_bundle.md).
- The auto-open is ALSO gated on `!window.electron.launchFlags.e2e`
  (`shouldAutoOpenOnboarding`): the e2e harness's userData dir persists across a
  run and never seeds the "seen" flag, so without the gate the z-max onboarding
  modal would cover ~130 specs. The harness sets `STRIX_E2E=1`;
  `flow_onboarding_first_launch.spec.ts` clears it to exercise the real
  first-launch path.
- Re-openable from **Help → Getting started…**.
- Full EN + NL strings through the i18n catalogue (`i18n/locales/*/launch.ts`);
  `localeParity` is green.

### REAL vs MOCKED

| Real | Mocked / placeholder |
|---|---|
| The flow, the phases, the persistence gate, the re-open path, the tour copy (EN+NL) | The **sample project DATA** |

The **"Load sample project"** button's WIRING is real — button → `onLoadSample`
in `App.tsx`. Today that handler logs a TODO and toasts `onboarding.sampleUnavailable`
("not bundled yet — starting empty instead"). **Intended production flow:** ship a
tiny real `.strix` in the app resources and import it on click so first launch
shows a finished ground model. The e2e synthetic fixture
(`desktop/tests/e2e/fixtures/…`) is the natural source for that sample dataset.

---

## B — Licensing / activation (debt #3 / #5)

Honours: **30-day offline grace** (ruling 14) · **1 device per Solo seat** →
self-service **deactivate/transfer** required (ruling 15) · **trial = a
server-issued time-limited licence on the SAME code path** as a paid activation
(ruling 16) · activation host is the **strixgeo.com MySQL DB** but the service
sits behind a **thin repository interface** so the engine choice stays deferred
("Activation host" note). Architecture follows **Option C** from
`activation-decision-memo.md` (server issues, signed offline file authorises) —
minus the signature, which is the prototype's biggest TODO.

### The three layers (all Electron-free except the IPC glue)

```
issuer seam        activationRepository.ts   ← the strixgeo.com service (MOCKED)
  mock impl        mockActivationRepository.ts
local authority    activationStore.ts        ← <userData>/activation.json (unsigned)
pure state machine activation.ts             ← trial/active/grace/expired/rollback
orchestration      activationService.ts      ← the only thing IPC talks to
```

- The **monotonic clock anchor** and the clock-rollback guard are **reused from
  the beta-expiry primitive** (`betaExpiry.ts` `advanceAnchor` /
  `CLOCK_SKEW_TOLERANCE_MS`) — the same defence, unchanged, against winding the
  clock back to extend grace.
- The screen (`LicensingDialog.tsx`) shows state, tier, expiry/grace day counts,
  the bound device + masked key; lets you enter a key + Activate, Start free
  trial, and Deactivate / transfer. Inline feedback (self-contained, so it works
  in both the welcome and loaded-project branches).
- **Deactivate / transfer is irreversible** (it frees the seat on the server), so
  the button routes through a `ConfirmDialog` — title "Deactivate this device?",
  a two-sentence body, Cancel default-focused, the action button named
  "Deactivate" (docs/ux.md "Reversible vs irreversible"). The client + service
  handle the answer per the contract: a clean release **or a `404`** (already
  released server-side) clears the local licence and returns to the activation
  screen; a `401` / network failure **keeps** the local licence and surfaces the
  error, so a transfer is never half-completed with the seat stranded. The HTTP
  client throws a typed `DeactivateFailedError` (status-carrying) that lets the
  service branch without importing the concrete HTTP impl.
- A **"Preview a state" row (dev builds only)** forces each state so the owner
  can SEE every screen without waiting out a clock. It is gated on
  `!launchFlags.packaged`, and the main process withholds the backing
  `activation:preview-state` IPC in a packaged build
  (`previewControlAllowed(app.isPackaged)`), so it can never ship.
- A persisted licence read back from disk is validated by TYPE and its tier
  against the known set (`isPlausibleLicence`): a hand-edited `activation.json`
  changing `tier` to `"gold"`, or flipping `isTrial` to a string, reads back as
  "no licence" rather than a trusted seat. (The Ed25519 signature is still the
  production TODO; this is the shape check that stands in front of it.)

### REAL vs MOCKED

| Real | Mocked / placeholder |
|---|---|
| The state machine (trial/active/grace/expired/clock-rollback), 30-day offline grace read, rollback guard, 1-device binding + refuse-second-device, deactivate/transfer, trial-on-same-path, the persistence shape, the repository **seam** | The **issuer** (in-memory, no network, no Stripe), the **Ed25519 signature** (the local file is plain JSON), the **device fingerprint** (a generated uuid), the demo key→tier table (would be a MySQL lookup) |

**The activation START-SCREEN gate (owner ruling A).** The owner ruled — *"a
startscreen with beta key input before the actual app opens"* — which supersedes
the prototype's original display-only choice, but ONLY for a real distributed
build. The decision is one pure function, `activationGateDecision({ blocked,
packaged, e2e })`:

* **Packaged + blocked** (`unactivated` / `expired` / `clock-rollback`) → the app
  renders `LicensingDialog` as a full-window, non-dismissable start screen
  INSTEAD of the workspace. Entering a valid key or starting the trial reports
  the new status through `onStatusChange`; once the verdict is no longer blocked
  the gate opens and the app proceeds. An `active` / `grace` verdict passes
  straight through — the 30-day offline grace (ruling 14) keeps a month on site a
  non-event.
* **Dev (`!packaged`)** → NEVER blocks. The owner's daily dogfeed is untouched;
  the gate seeds to `pass` and the status is never even fetched.
* **e2e (`STRIX_E2E`)** → NEVER blocks, so the licence gate cannot brick the
  suite. (In e2e the app is unpackaged anyway, so this is belt-and-braces.)

Still display-only in dev, so the owner can react to each preview state without
bricking his own build. The gate decision is pinned in `activationGate.test.ts`;
the blocking wiring lives in `App.tsx` above the workspace early-returns.

---

## C — Updater (debt #6)

- `electron-updater` added to `desktop` deps (`^6`). `updaterService.ts` wires
  `autoUpdater`'s events onto the renderer; `updaterPolicy.ts` is the pure,
  testable decision/shaping half.
- **Everything auto is gated on `app.isPackaged`** so the dev workflow is
  untouched: a dev launch never auto-checks, and a manual "Check for updates" in
  dev reports `disabled` and does nothing. `autoDownload = false` — the renderer
  owns the Download choice.
- Renderer `UpdateNotification.tsx` — a bottom-right card that reflects the
  lifecycle: available → Download / Later, downloading → progress, downloaded →
  Restart & install; informational phases (up to date / disabled / error) show a
  dismissable line.
- Launch check runs from `app.whenReady` after the window exists (no-op in dev).
  Its answer usually lands before the document has loaded, so the service
  latches the last event and replays it on `did-finish-load` — only
  `available`, `downloaded` and `error` (`shouldReplayOnLoad`), never a calm
  result a reload would re-toast (owner 2026-09-26: no prompt on startup).
- **The update card is reachable in every renderer state** (owner finding
  2026-10-08: 0.1.4 reinstalled over a 0.1.5 store showed no update prompt).
  App mounts `UpdateNotification` in every branch, including the activation
  gate, the loading splash and the boot error, so a backend that never becomes
  ready still shows the update that cures it. Switching branches remounts the
  card, so on mount it also PULLS the latched event (`updater:last-event` →
  `lastReplayableUpdaterEvent()`, same phase filter as the replay) and keeps a
  "Later" across remounts. It portals to `document.body` at the int32-max
  z-index; dialogs (`Modal`, `BackendFailedModal`) sit one below.
- **A newer-store refusal is named.** The main process reads the engine's
  output per spawn (`backendFailureReason.ts`: `NewerDatabaseError`, its
  message, or alembic's "Can't locate revision") and sends
  `app:backend-failed` with an additive `{ reason: 'newer-database' | null }`
  payload. `BackendFailedModal` then says the project was saved by a newer
  version and offers a default-focused **Check for updates**; an older
  renderer ignores the payload and shows the generic dialog.
- **The updater logs to the main log** (`backend.log`): `attachUpdaterLogger`
  sets `autoUpdater.logger` to an `[updater]`-prefixed adapter
  (`updaterLog.ts`), and the service writes each check request, each emitted
  phase (download progress once per quarter) and a rejected check or download.
- **The feed is now real config** (senior review SHOULD-FIX 3): `package.json`'s
  `build.publish` names GitHub Releases on the PUBLIC releases-only repo
  `Vorsie/strixgeo-releases`, `releaseType: draft`. `electron-builder` generates
  the `app-update.yml` `electron-updater` reads — **no `setFeedURL` and no token
  are ever needed by an end user**; a `GH_TOKEN` is only an env var at publish
  time, never committed or bundled. The dead `PLACEHOLDER_UPDATE_FEED` const is
  removed.
- **A local build can never publish by accident:** `npm run package` (and
  therefore `npm run dist`) ends in `electron-builder --publish=never`. Releasing
  is a separate, deliberate `npm run release` (`electron-builder
  --publish=always`) — requires `GH_TOKEN` in the env, creates a **DRAFT** release
  on `Vorsie/strixgeo-releases`, and a human clicks Publish on GitHub before any
  client sees it (`releaseType: draft` is a manual gate — `electron-updater`
  clients only see PUBLISHED releases).

### REAL vs MOCKED

| Real | Mocked / placeholder |
|---|---|
| The event plumbing, the isPackaged gate, autoDownload=false, progress relay, quit-and-install call, the renderer UX, **the GitHub Releases feed config** | Nothing is left mocked here — until a draft release is **published**, a packaged check simply resolves to `not-available` / `error` |

**Remaining production gap:** code-signing (#6) so a downloaded update is trusted
(the closed beta ships UNSIGNED; see debt #6). A first PUBLISHED release on
`Vorsie/strixgeo-releases` is what turns a packaged check from `not-available`
into a real update.

---

## Open decisions for the owner

Plain-language, for a non-developer: what each choice means, the realistic
options with their trade-offs, and a recommendation. Two of the prototype's
original questions are now DECIDED and moved to "Decided since the prototype"
below.

### 1. Where do we keep the record of who bought a licence?

**What it means.** When someone pays (or starts a trial), a record has to live
somewhere on your website's server: which key belongs to whom, which tier, and
which one device it is tied to. The desktop app never talks to this directly —
it talks to a thin seam (`ActivationRepository`) that a real implementation
fills in — so this choice does not touch the app's code.

- **MySQL on the strixgeo.com hosting (your current lean).** Already paid for,
  already there, ~100 MB is ample for small rows. Trade-off: you manage a tiny
  bit of SQL.
- **SQLite file on the server.** Simplest possible; no separate database. Trade-off:
  awkward if the site ever runs on more than one machine.
- **A hosted service (e.g. Supabase/PlanetScale).** Least ops. Trade-off: another
  subscription and another vendor.

**Recommendation:** MySQL on the hosting you already pay for. Keep the app behind
the `ActivationRepository` seam so this can change later with zero app changes.

### 2. How do we stop one licence file being copied to ten laptops?

**What it means.** Today the licence is a plain text file the app trusts. Anyone
could copy it, or hand-edit the dates. (The app already refuses a file whose
fields are the wrong shape or whose tier is not one of the three real ones, but
that is not real protection.)

- **Sign the licence file (Ed25519 — "Option C" in the activation memo).** The
  server signs each licence with a private key; the app carries the matching
  public key and refuses anything not signed by you. Works fully offline once
  issued. Trade-off: you generate and guard one key pair. **This is the intended
  design.**
- **Phone home every launch.** The app asks the server "is this still valid?"
  each time. Simpler to reason about. Trade-off: breaks the offline-on-site
  promise, which is a selling point against the cloud rivals.
- **Do nothing beyond the shape check.** Fine for a handful of trusted beta
  testers; not fine once money is involved.

**Recommendation:** signed file (Option C). It is the only option that keeps
"works offline for a month on site" AND stops copying. Build it with the Stripe
webhook that mints and signs on payment.

### 3. What ships as the "sample project" the onboarding offers?

**What it means.** The onboarding's "Load the sample project" button is wired but
has nothing to load yet. First launch should open a small, finished ground model
so a new engineer sees the payoff immediately.

- **Bundle the synthetic e2e fixture.** It already exists and is realistic enough.
  Trade-off: it is synthetic, not a real site.
- **Bundle a small real project (anonymised).** More convincing. Trade-off: needs
  a real dataset you are happy to distribute.

**Recommendation:** ship the synthetic fixture first (fast, already built), swap
to an anonymised real project later if a good one exists. Decide where the
`.strix` lives in the packaged resources when this is built.

### 4. Admin tooling — a key generator + issue-to-recipient (NEW, owner ask)

**What it means.** The owner asked for *"a key generator and an easy way to put
keys in the db, with the name and email of who I gave it to."* This is the
back-office side: a small tool that mints a key, records the recipient's name and
email against it, and (once decision 2 is settled) signs it.

- **A tiny command-line script + a couple of DB rows.** Fastest to build; runs on
  your machine. Trade-off: no UI.
- **A minimal admin web page on strixgeo.com.** Nicer, and you learn who is
  trialling. Trade-off: more to build and secure.

**Recommendation:** start with the CLI script, add a page only if you issue keys
often. **The key FORMAT is deliberately NOT invented here** — it depends on the
signing decision (2). This is recorded as an open item in `CLAUDE.local.md` too.

### 5. Key ↔ tier coupling (owner note — moved to the memo)

The owner's note — *"the type of key will have to be coupled to the key at DB
level, or we salt the key so we know which key it is"* — is a real design option
for how the app tells Solo from Pro from Studio. It has been written up cleanly as
a named option in `activation-decision-memo.md` (do NOT implement — there is no
server yet).

### Decided since the prototype

- **Blocking policy (was open decision 5) — DECIDED (ruling A).** A packaged build
  shows the licence start screen for `unactivated` / `expired` / `clock-rollback`;
  `active` / `grace` pass through. Dev and e2e never block. See section B.
- **Update feed host (was open decision 4) — DECIDED.** GitHub Releases, draft, on
  the public `Vorsie/strixgeo-releases` repo. See section C.

## What this prototype deliberately did NOT do

- No real network, no Stripe, no signature, no server of any kind.
- No real sample `.strix` generated (would need the backend + a real project;
  out of scope for an overnight scaffold).
- Did not touch the beta-expiry gate, the diagnostics capture, or any existing
  flow — every mechanism is additive and gated on `app.isPackaged` / `STRIX_E2E`
  / an overlay's own open state.
- Did not decompose `index.ts` / `App.tsx` (debt #201) — new logic went into
  fresh modules; the two god-components only gained a handful of wiring lines.

## Files

**Main (`desktop/src/main/`)** — `activation.ts` (+`.test.ts`),
`activationRepository.ts`, `mockActivationRepository.ts` (+`.test.ts`),
`activationStore.ts` (+`.test.ts`), `activationService.ts`, `prototypeFlags.ts`
(+`.test.ts`), `updaterPolicy.ts` (+`.test.ts`), `updaterService.ts`,
`updaterLog.ts` (+`.test.ts`), `backendFailureReason.ts` (+`.test.ts`,
`updaterWiring.test.ts`),
`prototypeIpc.ts`; edits to `index.ts` (the `launch:flags` sync handler + the
preview-control gate).
**Preload** — `desktop/src/preload/index.ts` (the `launchFlags` sendSync object).
**Renderer (`desktop/src/renderer/src/`)** —
`components/onboarding/OnboardingOverlay.tsx`,
`components/licensing/LicensingDialog.tsx` (+`.test.ts`),
`components/updater/UpdateNotification.tsx` (+`.test.tsx`),
`components/BackendFailedModal.tsx` (+`.test.tsx`), `utils/backendFailureTypes.ts`,
`utils/onboardingSeen.ts` (+`.test.ts`), `utils/activationGate.ts` (+`.test.ts`),
`utils/launchPrototypeTypes.ts`, `i18n/locales/en/launch.ts`,
`i18n/locales/nl/launch.ts`; edits to `App.tsx`, the two i18n index files, and
`App.smoke.test.tsx`.
**e2e** — `tests/e2e/flow_onboarding_first_launch.spec.ts`; the `STRIX_E2E`
default in `tests/e2e/helpers/electron_launch.ts`.

## Gates

`tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` clean ·
`localeParity` green · `react-hook-order-check` clean on the touched React files ·
full vitest **5094 passed / 79 skipped / 0 failed** (2026-09-02, incl. the
senior-review additions). That remediation is folded in: the e2e onboarding
BLOCKER, the packaged start-screen gate (ruling A), the licence shape-hardening,
the dev-only preview gate, and the real updater feed config are all pinned
red-first where they change behaviour. The e2e spec
`flow_onboarding_first_launch.spec.ts` is written but NOT run here (needs the
:8765 stack) — the session main runs it.
