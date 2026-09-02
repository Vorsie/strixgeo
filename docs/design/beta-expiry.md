# Beta build expiry (debt #3/#5 slice)

Current state. Load before touching `betaExpiry.ts`, `betaExpiryStore.ts`,
`buildStamp.ts`, or the startup sequence in `desktop/src/main/index.ts`.

**Owner ruling (2026-08-26 ballot, `docs/commercial-direction.md` §v1.0 gate):**
*"waterproof: beta builds must expire; a beta licence must not be usable for
years."* This is the offline enforcement half. It is **not** the activation
system (#3) — see `docs/design/activation-decision-memo.md`.

---

## Mechanism

1. **The stamp** is baked into the main bundle at build time via
   `import.meta.env.MAIN_VITE_STRIX_BETA_*` (`buildStamp.ts`). A packaged build
   **ignores the environment at run time**; an unpackaged one honours
   `STRIX_BETA_*` so the flow can be rehearsed without cutting a build.
2. **The anchor** (`<userData>/beta-anchor.json`) records the first and the
   **highest** instant this installation has ever observed. It only moves
   forward.
3. **The decision** (`betaExpiry.ts`, pure) compares the wall clock against the
   stamp and against the high-water mark, which also folds in *corroborating*
   timestamps — today the `lastOpened` entries of `recent-projects.json`.
4. **The gate** runs in `app.whenReady()` **before `startApi()` and
   `createWindow()`**. A blocked build spawns no backend and renders no window;
   it shows one dialog ("Get the current version" / "Quit") and exits.
   `betaGateWiring.test.ts` pins that ordering, because every unit test here
   stays green if the gate moves below the window.
5. **Re-checked every 6 h** while running, so a workstation that is never
   restarted cannot outlive the date by more than one working session.

The renderer gets `app:beta-status` for display only. There is no setter.

---

## Threat model

| Attack | Result | Why |
|---|---|---|
| Keep using the beta past its date | **Blocked** | The date is compiled into the binary |
| Wind the OS clock back after expiry | **Blocked** (`clock-rollback`) | The anchor remembers the highest instant seen |
| Delete `beta-anchor.json`, then wind back | **Blocked** while any recent-project timestamp postdates the expiry | Corroborating timestamps feed the same high-water mark |
| Set the clock before the build date | **Blocked** | Nothing can run before its own `builtAtMs` |
| `set STRIX_BETA_EXPIRES_AT=2099-…` on a packaged build | **Ignored** | Packaged builds read only the baked stamp |
| Small NTP / DST / VM-resume correction | **Allowed** | 10-minute tolerance |
| Corrupt or hand-edited anchor | **Ignored** (treated as absent) | Never rescues an expired build, never blocks a live one |
| Malformed stamp (our packaging bug) | Treated as **unstamped** | Bricking a legitimate tester over our own build bug is the worse failure; the runtime backstop warns instead |

### What it does NOT defend against — deliberately

* **Unpacking the `asar` and editing the stamp.** Debt #5 sets the posture:
  defeat casual bypass, no obfuscation, no DRM theatre.
* **Delete the anchor AND clear the recent-projects list AND wind the clock
  back**, on a machine that never ran the build past its date. No offline
  mechanism can close this. Only a signed, server-issued licence can — the
  memo's subject.
* **Copying the binary to a fresh machine with a backdated clock.** Same class.

The honest summary: this raises the cost of "keep the beta forever" from *change
your clock* to *unpack and patch the binary*. That is the correct ceiling for an
offline check, and it is enough for a hand-picked beta cohort.

---

## Cutting a beta

```
cd desktop
MAIN_VITE_STRIX_BETA_BUILD_ID=2026.08.27-beta \
MAIN_VITE_STRIX_BETA_BUILT_AT=2026-08-27T00:00:00.000Z \
MAIN_VITE_STRIX_BETA_EXPIRES_AT=2026-10-11T00:00:00.000Z \
npm run dist
```

**The package script enforces the stamp (2026-09-02).** `npm run package` (and
therefore `npm run dist`) runs `scripts/require-beta-stamp.mjs pre` before the
build and `… post` after it: packaging REFUSES when
`MAIN_VITE_STRIX_BETA_EXPIRES_AT` is unset, and fails when the built
`out/main/index.js` does not contain the ISO string. `STRIX_ALLOW_UNSTAMPED=1`
opts out for a local-only package that never leaves the machine. Set the
variable on the `dist` command itself: `package` rebuilds the main bundle, so a
stamp given only to an earlier `npm run build` is lost.


**Then verify the stamp actually landed** — injection failure is silent:

```
grep -A 4 "function compiledBuildStamp" desktop/out/main/index.js
```

It must show the dates as string literals. If it shows `return void 0`, the
build has no expiry.

> ⚠ **Do not switch this to Vite's `define`.** electron-vite builds the main
> process with `build.ssr = true`, and define substitution does not reach an SSR
> bundle: the config accepts the entry, the output is unchanged, and the expiry
> never lands. Verified 2026-08-27 (this is how the first implementation failed).

---

## Open for the owner

* **Renewal URL** — the dialog opens `https://strixgeo.com`. If checkout lives
  at a deeper path, change `BETA_RENEW_URL` in `index.ts`.
* **Beta window length** — 45 days is the example above; the number is a
  packaging argument, not a code constant.
* **Warning window** — the app reports "expires in N days" within 7 days, but
  **no UI shows it yet**. `app:beta-status` is wired and ready for a banner.
