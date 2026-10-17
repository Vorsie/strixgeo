# StrixGeo Open Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship StrixGeo 0.2.0 as a free AGPL-3.0-or-later project in one public repository with the paid-product machinery removed, standard open-source files, CI gates on every PR, and the site updated.

**Architecture:** One branch `feat/open-source` off `develop` (already cut in worktree `C:\Users\robin\Documents\Strix-wt-test`, carrying the spec). Tasks 1 to 9 land as separate PRs into `develop` in the order given (each PR is the branch rebased and renamed per task, or one PR per task cut from the previous one; the owner decides at execution). Tasks 10 to 13 are flip-day steps run by the session main, not by a builder. The spec is `docs/superpowers/specs/2026-10-17-open-source-design.md`.

**Tech Stack:** Python 3.11 + uv, FastAPI, Electron + React (electron-vite, vitest), GitHub Actions, PostgreSQL 16 + PostGIS 3.4 service container, Astro site, `gh` CLI.

**Conventions that bind every task:** Conventional Commits; one file per commit by the session main (`STRIX_BATCH=1` only after the full gates); English only; no em-dashes; a failing test first for every behaviour change; builders never commit, never run the integration wrapper, never touch port 8765. The owner's test-level gates: `uv run pytest tests/unit -q`, `cd desktop && npx vitest run`, `npx tsc --noEmit -p tsconfig.web.json`, `-p tsconfig.node.json`, `-p tsconfig.e2e.json`.

---

## Preconditions

- [ ] 0.1.6 is published by the owner from the draft built on 2026-10-17 (SHA 8f9ef6e80). Nothing in this plan starts on `develop` before that.
- [ ] Worktree `C:\Users\robin\Documents\Strix-wt-test` is on `feat/open-source` at `origin/develop` + the two spec commits.

---

### Task 1: Renderer: remove the activation start-screen gate and the licensing dialog

**Files:**
- Modify: `desktop/src/renderer/src/App.smoke.test.tsx:365-388` (replace the blocked-verdict test), `:255-275` (drop the activation stubs)
- Modify: `desktop/src/renderer/src/App.tsx:57`, `:65`, `:150-156`, `:345-410`, `:1595-1612`, `:1687`, `:1883`
- Delete: `desktop/src/renderer/src/components/licensing/LicensingDialog.tsx`, `LicensingDialog.test.tsx`, `desktop/src/renderer/src/utils/activationGate.ts`, `activationGate.test.ts`
- Modify: `desktop/src/renderer/src/utils/launchPrototypeTypes.ts` (drop `ActivationStatusDto` and the verdict types), `desktop/src/renderer/src/electronApi.d.ts:186-200` (drop `onMenuOpenLicensing`, `getActivationStatus`, `activateLicence`, `startTrial`, `deactivateLicence`, `previewActivationState`, `getBuildInfo`)
- Modify: `desktop/src/renderer/src/i18n/locales/en/launch.ts:52-93` and `nl/launch.ts:49-87` (delete every `licensing.*` key; keep the onboarding keys)
- Modify: `desktop/src/renderer/src/hooks/useAppBoot.ts:59` (`useAppBoot()` takes no argument; the gate parameter goes), `useAppBoot.test.ts` (drop the gate-closed cases)

- [ ] **Step 1: Write the failing test** (replace the test at `App.smoke.test.tsx:365-388`)

```tsx
  // Open source 2026-10-17: there is no licence step. A packaged build goes
  // from the starting splash straight to the welcome screen.
  it('a packaged build reaches the welcome screen with no licence step', async () => {
    const electron = window.electron as unknown as {
      launchFlags: { e2e: boolean; packaged: boolean }
    }
    electron.launchFlags = { e2e: false, packaged: true }
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeInTheDocument())
    expect(screen.queryByTestId('licensing-key-input')).toBeNull()
    expect(document.body.textContent).not.toContain('Licence')
  })
```

- [ ] **Step 2: Run it, see it fail**

Run: `cd desktop && npx vitest run src/renderer/src/App.smoke.test.tsx`
Expected: FAIL, the packaged mount calls `getActivationStatus` (now undefined after the stubs are dropped in step 3) or shows `licensing-key-input`.

- [ ] **Step 3: Remove the gate from App.tsx**

Delete lines 57 and 65 (the two imports). Replace lines 150-156 with:

```tsx
  // API boot sequence, extracted to useAppBoot. No licence gate (open source
  // 2026-10-17): the API wait starts at mount in every build.
  const { ready, apiError, takingLong } = useAppBoot()
```

Delete lines 345-410 (the `licensingOpen` state, the menu listener, the gate effect and `handleActivationStatusChange`). Delete the early return at 1595-1612. Delete the two `<LicensingDialog ... />` mounts at 1687 and 1883. Run `npx tsc --noEmit -p tsconfig.web.json` and fix every remaining reference the compiler names (there are none outside the ranges above on 2026-10-17; the compiler is the proof).

- [ ] **Step 4: Delete the four files, trim the types, the preload typings and the catalogues**

```bash
git rm desktop/src/renderer/src/components/licensing/LicensingDialog.tsx desktop/src/renderer/src/components/licensing/LicensingDialog.test.tsx desktop/src/renderer/src/utils/activationGate.ts desktop/src/renderer/src/utils/activationGate.test.ts
```

In `launchPrototypeTypes.ts` delete `ActivationStatusDto` and every type only it uses. In `electronApi.d.ts` delete the seven members listed above. In both `launch.ts` files delete every `'licensing.…'` line. In `useAppBoot.ts` change the signature to `export function useAppBoot(): UseAppBootResult` and remove the `gateOpen` branch; in `useAppBoot.test.ts` delete the cases that pass `false`.

- [ ] **Step 5: Run the renderer gates**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer/src/App.smoke.test.tsx src/renderer/src/hooks/useAppBoot.test.ts src/renderer/src/i18n`
Expected: tsc clean; smoke 3 passed; useAppBoot green; the i18n parity test green (EN and NL lost the same keys).

- [ ] **Step 6: Commit** (session main, one file per commit)

```bash
git commit -m "feat(desktop): the app starts without a licence step; LicensingDialog and the activation gate removed"
```

---

### Task 2: Main process: remove activation, beta expiry and the build-stamp expiry

**Files:**
- Delete: `desktop/src/main/activation.ts`, `activation.test.ts`, `activationConfig.ts`, `activationConfig.test.ts`, `activationRepository.ts`, `activationService.ts`, `activationService.test.ts`, `activationStore.ts`, `activationStore.test.ts`, `httpActivationRepository.ts` (+test), `mockActivationRepository.ts` (+test), `unreachableActivationRepository.ts` (+test), `betaExpiry.ts` (+test), `betaExpiryStore.ts` (+test), `betaGateWiring.test.ts`
- Modify: `desktop/src/main/buildStamp.ts` (keep `BuildProvenance`, `compiledBuildProvenance`; delete `RawBuildStamp`, `BuildStampSource`, `parseBuildStamp`, `compiledBuildStamp`, `readBuildStamp`, `BuildDisplayInfo`, `buildDisplayInfo`, the three `BETA_*_ENV_VAR` constants), `buildStamp.test.ts` (keep the provenance cases), `buildStampGlobals.d.ts` (drop the expiry env vars)
- Modify: `desktop/src/main/index.ts:22-30`, `:119-127`, `:1823`, `:2012-2060`, `:2088-2125`, `:2227`, `:2258-2282`
- Modify: `desktop/src/main/prototypeIpc.ts` (drop the five `activation:*` handlers and the `previewControl` option; keep the updater handlers), `prototypeFlags.ts` (drop `previewControlAllowed`), `prototypeFlags.test.ts`
- Modify: `desktop/src/preload/index.ts:323-335` (drop the licensing block) and `:298` (drop `getBetaStatus`; its `app:beta-status` handler in index.ts goes too), `desktop/src/main/menuTemplate.ts:225-230` (drop the licence item and its separator), `desktop/src/main/menuLabels.ts:125` (drop `licenceActivation`), `menuTemplate.test.ts` if it lists the item
- Modify: `desktop/src/main/deviceIdentity.ts:57` (define `DeviceIdentity` locally: `{ readonly deviceId: string }` with the same shape the file already produces), `diagnosticsPayload.ts` (identity = device id only; drop the licence-key field), `diagnosticsUploader.ts` (unchanged API, `baseUrl` now comes from the new setting), `diagnosticsUploaderConstants.ts:17-25` (doc: the endpoint is `STRIXGEO_DIAGNOSTICS_URL` + `v1/diagnostics`), `diagnosticsUploader.test.ts`, `diagnosticsRedaction.test.ts` (drop licence-key redaction cases)
- Create: `desktop/src/main/diagnosticsEndpoint.ts`
- Create: `desktop/src/main/bootSequence.test.ts`
- Modify (build-time stamp, found during execution): `desktop/scripts/require-beta-stamp.mjs` renamed to `require-build-sha.mjs` keeping only the post-build SHA grep (the `pre` expiry requirement, `MAIN_VITE_STRIX_BETA_EXPIRES_AT` and `STRIX_ALLOW_UNSTAMPED` go); `desktop/package.json` `package` script loses the `pre` call and names the new script; `desktop/electron.vite.config.ts:27-35` loses the beta-stamp block; `desktop/scripts/buildProvenance.mjs` comment; `docs/distribution-build.md` loses every expiry-stamp instruction (the SHA provenance stays); `embedded/packagedBootCoordinator.ts` loses the `gateAllowsEngine` parameter.

- [ ] **Step 1: Write the failing boot-sequence test** (`bootSequence.test.ts`, the successor of `betaGateWiring.test.ts`)

```ts
// Pins the startup order of index.ts by reading its source (index.ts imports
// electron at module scope, so vitest cannot run it). Open source 2026-10-17:
// there is no licence gate and no expiry check; the engine starts
// unconditionally and the window follows.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

function offsetOf(needle: string): number {
  const at = MAIN_SOURCE.indexOf(needle)
  expect(at, `expected index.ts to contain ${needle}`).toBeGreaterThanOrEqual(0)
  return at
}

describe('boot sequence (open source: no gate)', () => {
  it('BS1: the source carries no licence gate and no beta expiry', () => {
    expect(MAIN_SOURCE).not.toContain('enforceBetaExpiry')
    expect(MAIN_SOURCE).not.toContain('activationBlocksLaunch')
    expect(MAIN_SOURCE).not.toContain('ActivationService')
    expect(MAIN_SOURCE).not.toContain('launchBlocked')
  })
  it('BS2: a dev start spawns the engine before the window', () => {
    expect(offsetOf('startApi()\n    }\n    createWindow()')).toBeGreaterThan(0)
  })
  it('BS3: a packaged start boots the embedded database, then the window', () => {
    const db = offsetOf('if (!(await bootEmbeddedDatabase(')
    const window = offsetOf('createWindow()\n')
    expect(db).toBeLessThan(window)
  })
  it('BS4: the diagnostics store is configured before the window', () => {
    expect(offsetOf('configureDiagnosticsStore({')).toBeLessThan(offsetOf('createWindow()\n'))
  })
})
```

- [ ] **Step 2: Write the failing diagnostics-endpoint test** (append to `diagnosticsUploader.test.ts`)

```ts
import { diagnosticsBaseUrl } from './diagnosticsEndpoint'

describe('diagnostics endpoint (open source: no activation origin)', () => {
  it('is null when STRIXGEO_DIAGNOSTICS_URL is unset, packaged or not', () => {
    expect(diagnosticsBaseUrl({ env: {}, packaged: true })).toBeNull()
    expect(diagnosticsBaseUrl({ env: {}, packaged: false })).toBeNull()
  })
  it('is the trimmed env value when set', () => {
    expect(diagnosticsBaseUrl({ env: { STRIXGEO_DIAGNOSTICS_URL: 'https://example.org/api/' }, packaged: true })).toBe('https://example.org/api')
  })
})
```

- [ ] **Step 3: Run both, see them fail**

Run: `cd desktop && npx vitest run src/main/bootSequence.test.ts src/main/diagnosticsUploader.test.ts`
Expected: BS1 fails (the needles are still present); the endpoint test fails (module not found).

- [ ] **Step 4: Create `diagnosticsEndpoint.ts`**

```ts
/**
 * Where consented diagnostics go. Open source 2026-10-17: there is no
 * activation server any more, so the endpoint is a plain setting with NO
 * default. Unset means "never transmit", in every build.
 *
 * @module main/diagnosticsEndpoint
 */

/** Environment variable naming the diagnostics server base URL. */
export const DIAGNOSTICS_URL_ENV = 'STRIXGEO_DIAGNOSTICS_URL'

/**
 * The diagnostics base URL, or null when none is configured.
 *
 * @param inputs - The process environment and whether the app is packaged
 *   (kept in the signature so a packaged default can be added later without a
 *   call-site change).
 * @returns The base URL without a trailing slash, or null.
 */
export function diagnosticsBaseUrl(inputs: {
  env: Record<string, string | undefined>
  packaged: boolean
}): string | null {
  const raw = inputs.env[DIAGNOSTICS_URL_ENV]?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}
```

- [ ] **Step 5: Edit index.ts**

Delete the imports at 22-23 (`evaluateBetaExpiry`, `configureBetaExpiryStore`, `recordLaunch`), trim the `buildStamp` import at 24-30 to `compiledBuildProvenance` only, delete the imports at 119-122 and the `previewControlAllowed` import at 125 (keep `e2eLaunchFlag` if anything else uses it; the compiler tells). Delete `betaBuildStamp`, `betaVerdict`, `currentBetaVerdict`, `currentBuildInfo`, `betaCorroboratingTimestamps`, `refreshBetaVerdict`, `stopForExpiredBeta` (2012-2060 and what follows them), `enforceBetaExpiry`, `startBetaExpiryWatch` and `BETA_RECHECK_INTERVAL_MS` (2088-2125), the `configureBetaExpiryStore(...)` call at 2227, and the activation construction (`configureActivationStore`, `new ActivationService`, `createActivationRepository`). At 1823 replace `activationBaseUrl({ env: process.env, packaged: app.isPackaged })` with `diagnosticsBaseUrl({ env: process.env, packaged: app.isPackaged })` and import it. Replace the block at 2258-2282 with:

```ts
    // Open source 2026-10-17: no licence gate. Packaged: boot the embedded
    // database and spawn the engine as soon as the cluster is up. Dev: start
    // the backend directly.
    if (app.isPackaged) {
      if (!(await bootEmbeddedDatabase(() => true))) return
    } else {
      startApi()
    }
    createWindow()

    // #16 transmit half: flush consented diagnostics when an endpoint is
    // configured (STRIXGEO_DIAGNOSTICS_URL). Inert otherwise.
    startDiagnosticsUpload()
```

Delete `void activationService.refreshOnLaunch()`. Keep the auto-update check that follows. In `registerPrototypeIpc(...)` drop the `previewControl` and `onActivated` options and the service argument.

- [ ] **Step 6: Trim prototypeIpc.ts, prototypeFlags.ts, preload, menu, deviceIdentity, diagnostics payload, buildStamp**

`prototypeIpc.ts`: delete lines 15-16 (type imports) and the handlers at 62-105; keep `updater:*`. Signature becomes `registerPrototypeIpc(deps: { checkForUpdates; downloadUpdate; quitAndInstall; lastReplayableUpdaterEvent; readCheckAtStart; writeCheckAtStart })` with whatever the updater handlers already take; rename nothing else. `prototypeFlags.ts`: delete `previewControlAllowed` and its tests. `preload/index.ts`: delete 323-335. `menuTemplate.ts`: delete the separator at 225 and the item at 226-230; `menuLabels.ts`: delete line 125 and the `'licenceActivation'` union member. `deviceIdentity.ts:57`: replace the import with `export interface DeviceIdentity { readonly deviceId: string }` (match the fields the file already builds; the compiler tells). `diagnosticsPayload.ts`: the identity block becomes `{ deviceId }` only; delete the licence-key field and its doc. `buildStamp.ts`: keep only `BuildProvenance` + `compiledBuildProvenance` (and the `MAIN_VITE_STRIX_BUILD_SHA` / `BUILT_AT` reads they use); delete the rest; `buildStampGlobals.d.ts` keeps only those two env declarations.

- [ ] **Step 7: Delete the files**

```bash
cd desktop/src/main && git rm activation.ts activation.test.ts activationConfig.ts activationConfig.test.ts activationRepository.ts activationService.ts activationService.test.ts activationStore.ts activationStore.test.ts httpActivationRepository.ts httpActivationRepository.test.ts mockActivationRepository.ts mockActivationRepository.test.ts unreachableActivationRepository.ts unreachableActivationRepository.test.ts betaExpiry.ts betaExpiry.test.ts betaExpiryStore.ts betaExpiryStore.test.ts betaGateWiring.test.ts
```

- [ ] **Step 8: Run the main-process gates**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/main src/preload`
Expected: both tsc clean (fix every reference the compiler names; the list above is complete on 2026-10-17); vitest green, `bootSequence` 4/4, the endpoint tests 2/2.

- [ ] **Step 9: Run the full desktop suite**

Run: `cd desktop && npx vitest run`
Expected: 0 failed (around 7,100 tests; the deleted suites lower the count).

- [ ] **Step 10: Commit** (one file per commit; deletions grouped as one `git rm` commit per directory is acceptable for the session main)

```bash
git commit -m "feat(desktop): main process starts the engine without activation or beta expiry; diagnostics endpoint is a plain setting"
```

---

### Task 3: Delete the activation server and its design docs; rewrite the pointers

**Files:**
- Delete: `server/activation/` (16 tracked files), `docs/design/activation-api-contract.md`, `docs/design/activation-decision-memo.md`, `docs/design/activation-server-deploy.md`, `docs/design/beta-expiry.md`, `docs/design/onboarding-activation-updater-proto.md`
- Modify: `CLAUDE.md:481-483` (the three design-note bullets: delete the beta-expiry and onboarding-activation bullets, reword the diagnostics bullet), `CLAUDE.md:69` (the backwards-compat line: drop "activation store format 1"), `CLAUDE.md:504` (the Tier B index line is generated; regenerate with `uv run python scripts/gen_debt_index.py` after the debt edit)
- Modify: `docs/debt.md:241` (#3), `:395` (#5), `:486` (#6), `:364` (#4 title mentions #3), `:668` (#16 endpoint sentence), `:534` (names `require-beta-stamp.mjs post`: now `require-build-sha.mjs`); `docs/codex-production-check-2026-09-02.md:13` stays as a historical audit row
- Modify: `docs/design/diagnostics-capture.md` (the transmit paragraph: endpoint = `STRIXGEO_DIAGNOSTICS_URL`, no activation origin)
- Modify: `desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx:16` (the pointer to the deleted onboarding-activation-updater-proto.md: replace with "onboarding (#93)")
- Modify: `docs/distribution-build.md:26-78` ("Release integrity and provenance": drop the expiry stamp paragraphs, keep the SHA provenance), `:347-361` ("Per-install generated secrets": unchanged, those are the local DB secrets)

- [ ] **Step 1: Write the failing doc-consistency test** (new `tests/unit/docs/test_no_activation_references.py`)

```python
"""Open source 2026-10-17: no activation, licence-key or beta-expiry machinery remains.

The tree is scanned for the identifiers of the removed subsystem so a stray
pointer (a doc bullet, a script, a menu label) fails the unit gate instead of
confusing a contributor.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCAN_DIRS = ("src", "desktop/src", "docs", "scripts", "CLAUDE.md")
FORBIDDEN = re.compile(
    r"activationService|activationStore|betaExpiry|enforceBetaExpiry|"
    r"STRIX_BETA_EXPIRES_AT|licenceActivation|server/activation|LicensingDialog|"
    r"getBetaStatus|beta-status|beta-expiry\.md|onboarding-activation-updater-proto",
)
ALLOWED = {"docs/superpowers", "docs/debt.md", "docs/lessons-learned.md", "docs/benchmarks-journal.md"}


def _files() -> list[Path]:
    out: list[Path] = []
    for entry in SCAN_DIRS:
        p = ROOT / entry
        if p.is_file():
            out.append(p)
            continue
        out.extend(f for f in p.rglob("*") if f.is_file() and f.suffix in {".py", ".ts", ".tsx", ".md", ".ps1", ".mjs"})
    return out


def test_no_activation_or_expiry_identifier_survives() -> None:
    """Every file under the scanned roots is free of the removed identifiers."""
    hits = [
        str(f.relative_to(ROOT))
        for f in _files()
        if not any(str(f.relative_to(ROOT)).replace("\\", "/").startswith(a) for a in ALLOWED)
        and FORBIDDEN.search(f.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == [], f"removed-subsystem identifiers still referenced in: {hits}"
```

- [ ] **Step 2: Run it, see it fail**

Run: `uv run pytest tests/unit/docs/test_no_activation_references.py -q`
Expected: FAIL listing `server/activation/...`, the design docs, CLAUDE.md.

- [ ] **Step 3: Delete and rewrite**

```bash
git rm -r server/activation docs/design/activation-api-contract.md docs/design/activation-decision-memo.md docs/design/activation-server-deploy.md docs/design/beta-expiry.md docs/design/onboarding-activation-updater-proto.md
```

`docs/debt.md`: change the #3 heading to `## 3. Subscription activation system — STATUS: RESOLVED (2026-10-17, removed: StrixGeo is free and open source; the activation client, server and licence screen were deleted on feat/open-source)` and move the entry to the RESOLVED section; same for #5 (`RESOLVED (2026-10-17, removed with the Nuitka compile; an AGPL project has no tamper posture)`); #6 heading becomes `## 6. Installer code signing (low, nice-to-have: removes the SmartScreen warning) — STATUS: OPEN` and its body loses the auto-update and paid-release sentences; #4 title loses "day-1 of #3, Tier B"; #16 body: endpoint = `STRIXGEO_DIAGNOSTICS_URL`. Then `uv run python scripts/gen_debt_index.py` regenerates the CLAUDE.md index. Edit the CLAUDE.md bullets and line 69 as listed. Edit `diagnostics-capture.md` and `distribution-build.md` as listed.

- [ ] **Step 4: Run the test and the docs build**

Run: `uv run pytest tests/unit/docs/test_no_activation_references.py tests/unit -q`
Expected: PASS; the full unit suite green.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(open-source): activation server and its design docs removed; debt #3 and #5 resolved by removal"
```

---

### Task 4: Remove the Nuitka compile from the installer

**Files:**
- Delete: `scripts/compile-backend-natives.ps1`, `scripts/verify-staged-natives.ps1`, `scripts/native_compile_manifest.py`, `tests/unit/scripts/test_native_compile_manifest.py`
- Modify: `scripts/build-embedded-python.ps1:26-32` (header), `:230-240` (the "drops the compile group" comment), `:300-345` (the compile call at 314 and the natives gate that follows), `pyproject.toml:120` (delete the `compile` group), `uv.lock` (regenerated), `docs/distribution-build.md:159-234` (delete "### The compiled subset"), `CLAUDE.md:214` (Tech Stack row "Native compile": replace with `| Native compile | none | The engine ships as plain Python source (open source 2026-10-17). Numba stays for the voxel hotspot. |`), `CLAUDE.local.md` (the "Protection tier" ruling bullet, owner's file)
- Modify: `tests/unit/docs/test_no_activation_references.py` (add `compile-backend-natives|verify-staged-natives|native_compile_manifest` to `FORBIDDEN`)

- [ ] **Step 1: Extend the failing test**

Add the three identifiers to `FORBIDDEN`. Run: `uv run pytest tests/unit/docs/test_no_activation_references.py -q`. Expected: FAIL naming `scripts/build-embedded-python.ps1`, `docs/distribution-build.md`, `CLAUDE.md`.

- [ ] **Step 2: Delete and edit**

```bash
git rm scripts/compile-backend-natives.ps1 scripts/verify-staged-natives.ps1 scripts/native_compile_manifest.py tests/unit/scripts/test_native_compile_manifest.py
```

In `build-embedded-python.ps1` delete the compile call and the natives-gate block (search `compile-backend-natives` and `verify-staged-natives`; delete from the comment that introduces each to the end of its `& (...)` invocation and the throw that follows); keep the SHA-256 manifest and the smoke gate that imports the engine. In `pyproject.toml` delete the `compile = [...]` line, then:

```bash
uv lock
uv sync --group dev --group docs
```

Delete the section in `docs/distribution-build.md` and every sentence that says the engine ships compiled (search `.pyd`). Replace the CLAUDE.md row.

- [ ] **Step 3: Run the test**

Run: `uv run pytest tests/unit/docs/test_no_activation_references.py tests/unit/scripts -q`
Expected: PASS.

- [x] **Step 4: Stage the embedded Python once, by the owner or the session main (not a builder), and prove the engine ships as source** (done 2026-10-17 02:15 in Strix-wt-test: gate imported 882 modules, PYD_COUNT=0, PYC_COUNT=0)

Run (PowerShell, main tree, app closed):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-embedded-python.ps1 -Force
Get-ChildItem -Recurse -Filter *.pyd desktop\embedded\backend\src | Measure-Object | Select-Object Count
Test-Path desktop\embedded\backend\src\groundmodel\application\divide_boreholes.py
```

Expected: the staging ends with the smoke gate "passed"; Count = 0; `True`.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(build): the installer ships the engine as plain Python; Nuitka compile and the natives gate removed"
```

---

### Task 5: Licence files and package metadata

**Files:**
- Create: `LICENSE`, `NOTICE`
- Modify: `pyproject.toml:5-9` (add `license = { text = "AGPL-3.0-or-later" }` under `requires-python`), `desktop/package.json:1-5` (add `"license": "AGPL-3.0-or-later"` after `"description"`)
- Create: `tests/unit/docs/test_licence_files.py`

- [ ] **Step 1: Write the failing test**

```python
"""The repo carries its licence the way package tools and GitHub read it."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_license_file_is_the_agpl_text() -> None:
    """LICENSE is the full GNU AGPL-3.0 text."""
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("                    GNU AFFERO GENERAL PUBLIC LICENSE")
    assert "Version 3, 19 November 2007" in text


def test_package_metadata_name_the_licence() -> None:
    """pyproject and package.json both declare AGPL-3.0-or-later."""
    py = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert re.search(r'license\s*=\s*\{\s*text\s*=\s*"AGPL-3.0-or-later"\s*\}', py)
    pkg = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
    assert pkg["license"] == "AGPL-3.0-or-later"


def test_notice_lists_the_bundled_third_parties() -> None:
    """NOTICE names every bundled runtime and its licence."""
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    for name in ("PostgreSQL", "PostGIS", "Electron", "CesiumJS", "PyMuPDF", "d-geolib", "rapidocr", "DOV"):
        assert name in notice, name
```

- [ ] **Step 2: Run it, see it fail**

Run: `uv run pytest tests/unit/docs/test_licence_files.py -q`
Expected: FAIL, `LICENSE` missing.

- [ ] **Step 3: Fetch the licence text, write NOTICE, set the fields**

```bash
curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
```

`NOTICE`:

```text
StrixGeo
Copyright (C) 2026 Robin Vorsselmans

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See LICENSE.

The StrixGeo name and logo are trademarks of the copyright holder. A modified
distribution must use another name.

Bundled or linked third-party software (each under its own licence):
- PostgreSQL 16 (PostgreSQL License) and PostGIS 3 (GPL-2.0-or-later), run as a separate process
- Electron (MIT), React (MIT), CesiumJS (Apache-2.0), Leaflet (BSD-2-Clause)
- FastAPI (MIT), SQLAlchemy (MIT), Alembic (MIT), Polars (MIT), Numba (BSD-2-Clause), Pydantic (MIT)
- PyMuPDF (AGPL-3.0) for PDF rendering and text layers
- rapidocr-onnxruntime (Apache-2.0) for optional OCR
- d-geolib (Deltares; see its licence in the installed package) for D-Series exports
- DOV codelists and the G3Dv3 model-unit tables (Databank Ondergrond Vlaanderen, Modellicentie Gratis Hergebruik)
```

Set the two metadata fields.

- [ ] **Step 4: Run the test**

Run: `uv run pytest tests/unit/docs/test_licence_files.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(licence): GNU AGPL-3.0-or-later, NOTICE with bundled third parties, licence fields in pyproject and package.json"
```

---

### Task 6: Standard repository files

**Files:**
- Create: `README.md` (replace the current one), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `.github/CODEOWNERS`, `.github/FUNDING.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/ISSUE_TEMPLATE/config.yml`
- Create: `tests/unit/docs/test_repo_files.py`

- [ ] **Step 1: Write the failing test**

```python
"""The standard open-source files exist and carry the agreed sections."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

REQUIRED = {
    "README.md": ["AGPL-3.0", "Support the project", "GeoStrix", "trademark"],
    "CONTRIBUTING.md": ["Signed-off-by", "Conventional Commits", "develop", "tests"],
    "CODE_OF_CONDUCT.md": ["Contributor Covenant"],
    "SECURITY.md": ["security advisor"],
    "CHANGELOG.md": ["## [0.1.6]", "Keep a Changelog"],
    ".github/CODEOWNERS": ["@Vorsie"],
    ".github/FUNDING.yml": ["github: [Vorsie]"],
    ".github/PULL_REQUEST_TEMPLATE.md": ["What the tests prove", "Signed-off-by"],
    ".github/ISSUE_TEMPLATE/bug_report.md": ["[bug]", "Acceptance criteria", "Help > Save logs for support"],
    ".github/ISSUE_TEMPLATE/feature_request.md": ["[feat]", "Acceptance criteria"],
}


def test_every_standard_file_exists_with_its_sections() -> None:
    """Each file exists and contains the phrases the design fixed."""
    missing: list[str] = []
    for rel, phrases in REQUIRED.items():
        path = ROOT / rel
        if not path.exists():
            missing.append(f"{rel}: missing")
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in phrases:
            if phrase not in text:
                missing.append(f"{rel}: lacks {phrase!r}")
    assert missing == [], missing
```

- [ ] **Step 2: Run it, see it fail**

Run: `uv run pytest tests/unit/docs/test_repo_files.py -q`. Expected: FAIL, every file missing.

- [ ] **Step 3: Write the files**

`README.md` sections, in this order: title + one-line pitch ("StrixGeo builds and manages the unified subsurface dataset of a project: CPT, boreholes, lab tests and reports in, a validated ground model with characterisation outputs out. It does no design calculation."); badges (`![CI](https://github.com/Vorsie/strixgeo/actions/workflows/ci.yml/badge.svg)`, `![Licence: AGPL-3.0-or-later](https://img.shields.io/badge/licence-AGPL--3.0--or--later-blue)`); "Download" (link `https://github.com/Vorsie/strixgeo/releases/latest`, Windows 10/11, unsigned installer note); "What it does" (bullets: DOV import, GEF, borehole XML, PDF digitisers, lab exports; three-level model; cross-sections; 3-D voxel model; exports DXF, Plaxis 2D/3D, D-Stability, D-Sheet Piling; no GeoStudio exporter exists); "What it does not do" (the out-of-scope list from CLAUDE.md); "Build from source" (the block below); "Contributing" (link); "Support the project" (the Sponsors paragraph and link `https://github.com/sponsors/Vorsie`, "Thanks" list); "Licence" (AGPL-3.0-or-later, the trademark line); "Not related to GeoStrix" (one sentence: "GeoStrix is an unrelated open-source project for mineral exploration.").

Build block:

```text
uv sync --group dev --group docs
docker compose up -d
uv run alembic upgrade head
cd desktop
npm ci
npm run dev
```
(`npm run dev` starts the engine itself; the API alone: `uv run python -m groundmodel.api.serve`.)

`CONTRIBUTING.md` sections: "Branches" (PR into `develop`; `main` is released builds; rebase merge); "Commits" (Conventional Commits types table copied from CLAUDE.md; `git commit -s` for the DCO; sign-off text); "Tests first" (a failing test in the rule's words before the fix; the PR says what the tests prove); "Gates" (the five CI jobs and the local commands); "Rules of the domain" (English only; translate at the presentation boundary; characterisation outputs only; backwards compatibility: a `.strix` written by any released build must open in every later build); "Releasing" (owner-only: walker 0 findings, `npm run release`, tag, main fast-forward); "Where to read" (CLAUDE.md, docs/).

`CODE_OF_CONDUCT.md`: the Contributor Covenant 2.1 text (`curl -fsSL https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md -o CODE_OF_CONDUCT.md`), contact line set to the owner's e-mail.

`SECURITY.md`:

```markdown
# Security policy

Report a vulnerability privately through GitHub security advisories:
https://github.com/Vorsie/strixgeo/security/advisories/new. Do not open a public issue.
You get an answer within 7 days. StrixGeo is a desktop application; the engine listens on
localhost only and never on a network interface.
```

`CHANGELOG.md`: header "All notable changes are listed here. The format follows Keep a Changelog; versions follow semver." then `## [Unreleased]`, `## [0.1.6]`, `## [0.1.5]`, `## [0.1.4]` down to `## [0.1.0]`, each with the English translation of its Dutch release notes (the notes live on the releases of Vorsie/strixgeo-releases; the 0.1.5 and 0.1.6 texts are in the session scratchpad `release_notes_016.md`).

`.github/CODEOWNERS`: `* @Vorsie`. `.github/FUNDING.yml`: `github: [Vorsie]`. `.github/ISSUE_TEMPLATE/config.yml`: `blank_issues_enabled: false`. The three templates: exactly the texts agreed on 2026-10-17 (PR: Summary, What the tests prove, Checklist; bug report: Description, Steps to reproduce, Environment, Log, Acceptance criteria; feature request: Description, Acceptance criteria, Notes), with the YAML front matter `name`, `about`, `title`, `labels`.

- [ ] **Step 4: Run the test**

Run: `uv run pytest tests/unit/docs/test_repo_files.py -q`. Expected: PASS.

- [ ] **Step 5: Commit** (one file per commit)

```bash
git commit -m "docs(repo): README, CONTRIBUTING, code of conduct, security policy, changelog, issue and PR templates, funding"
```

---

### Task 7: NAD documentation cites the standard, not the private workbook

**Files:**
- Modify: `docs/exports.md:135-141`

- [ ] **Step 1: Edit**

Change the heading to `### NAD soil parameters, transcribed from NBN EN 1997-1 ANB Tabel 2.1` and the sentence to `and are transcribed by the owner from NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex), cross-checked against the printed table (see docs/reference/nad_reference_manifest.json).`

- [ ] **Step 2: Verify no private filename remains**

Run: `git grep -n "NAD_NEN_v2" -- docs src tests`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(exports): NAD parameters cite the national annex table, not a private workbook"
```

---

### Task 8: Ruff clean on the whole tree

**Files:**
- Modify: `pyproject.toml:149-150` (ruff config), the 50 findings in `src/` (mostly D101/D102/D103 docstrings, E501, F401), the non-docstring findings in `tests/` (F401, I001, F841, E402, E501), 25 files reformatted

- [ ] **Step 1: Make test docstrings optional**

Under `[tool.ruff.lint]` add:

```toml
[tool.ruff.lint.per-file-ignores]
"tests/**" = ["D1"]
```

Rationale in a comment: the DoD requires docstrings on public API in `src`; a test's name is its documentation.

- [ ] **Step 2: Fix the rest**

Run: `uv run ruff check src tests --fix && uv run ruff format src tests && uv run ruff check src tests --statistics`
Then write the missing docstrings in `src` by hand (numpy style, one line is enough for a private helper, full for a public function) until the statistics print nothing. Expected: `All checks passed!` and `ruff format --check src tests` clean.

- [ ] **Step 3: Run the unit suite**

Run: `uv run pytest tests/unit -q`. Expected: green, same count as before.

- [ ] **Step 4: Commit** (one file per commit; a formatting-only commit per file is acceptable)

```bash
git commit -m "style: ruff clean on src and tests; test docstrings optional"
```

---

### Task 8b: mypy clean (found during Task 8: 151 pre-existing errors in 60 files on both trees)

**Files:** the 60 files `uv run mypy src` names (arg-type 36, attr-defined 31, type-arg 28, unused-ignore 12, assignment 11, import-untyped 10, operator 9, no-untyped-def 5, list-item and others).

- [ ] **Step 1: Record the baseline**: `VIRTUAL_ENV= uv run mypy src > scratch_mypy_before.txt`; 151 errors.
- [ ] **Step 2: Fix by category without behaviour change**: `unused-ignore` (delete the stale `# type: ignore`), `import-untyped` (add the missing `[[tool.mypy.overrides]] ignore_missing_imports` entry for that package in pyproject, like the existing ones), `type-arg` (write the generic parameters), `no-untyped-def` (annotate), `arg-type`/`assignment`/`operator`/`attr-defined`/`list-item` (read each: most are an `Optional` not narrowed, a `Sequence` vs `Iterable`, or a `None` default; fix the type, never the logic; where the logic is genuinely wrong, stop and report it as a finding, do not fix silently).
- [ ] **Step 3: Gates**: `uv run mypy src` = Success; `uv run pytest tests/unit -q` same count; `uv run ruff check src tests` clean.
- [ ] **Step 4**: `.github/workflows/ci.yml` lint-types job: remove `continue-on-error: true` from the mypy step (Task 9 adds it as informational); CLAUDE.md sentence loses "mypy informational until ...".
- [ ] **Step 5: Commit** (one file per commit).

### Task 9: CI on every PR

**Files:**
- Modify: `.github/workflows/ci.yml` (five jobs)
- Create: `scripts/check_dco.sh`
- Create: `tests/unit/docs/test_ci_workflow.py`

- [ ] **Step 1: Write the failing test**

```python
"""The CI workflow carries the five required jobs of the open-source design."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]


def test_ci_has_the_five_required_jobs() -> None:
    """lint-types, python-unit, desktop, integration and dco exist as jobs."""
    wf = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))
    assert set(wf["jobs"]) >= {"lint-types", "python-unit", "desktop", "integration", "dco"}


def test_integration_job_uses_a_postgis_service() -> None:
    """The integration job runs against a PostGIS service container, not the dev DB."""
    wf = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))
    job = wf["jobs"]["integration"]
    assert "postgis/postgis:16-3.4" in job["services"]["db"]["image"]
    assert job["env"]["DATABASE_URL"].endswith("/groundmodel_integration")
```

(`pyyaml` is in the dev group; if not, add `pyyaml>=6` to `dev`.)

- [ ] **Step 2: Run it, see it fail**

Run: `uv run pytest tests/unit/docs/test_ci_workflow.py -q`. Expected: FAIL, jobs `python`/`desktop` only.

- [ ] **Step 3: Write `scripts/check_dco.sh`**

```bash
#!/usr/bin/env bash
# Every commit in the range must carry a Signed-off-by trailer (DCO).
set -euo pipefail
range="${1:?usage: check_dco.sh <base>..<head>}"
bad=0
while read -r sha; do
  if ! git log -1 --format=%B "$sha" | grep -qE '^Signed-off-by: .+ <.+@.+>$'; then
    echo "missing Signed-off-by: $(git log -1 --format='%h %s' "$sha")"
    bad=1
  fi
done < <(git rev-list "$range")
exit $bad
```

- [ ] **Step 4: Rewrite `ci.yml`**

Keep the header (name, `on`, concurrency) and the SHA-pinned action references already in the file. Jobs:

```yaml
jobs:
  lint-types:
    name: Ruff + mypy
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: astral-sh/setup-uv@caf0cab7a618c569241d31dcd442f54681755d39 # v3
        with: { enable-cache: true, cache-dependency-glob: uv.lock }
      - run: uv python install 3.11
      - run: uv sync --group dev
      - run: uv run ruff check src tests
      - run: uv run ruff format --check src tests
      - name: mypy (informational until Task 8b clears the 151 pre-existing errors)
        continue-on-error: true
        run: uv run mypy src

  python-unit:
    name: Python unit tests
    # the existing "python" job, renamed; steps unchanged

  desktop:
    name: Desktop eslint-reason + tsc + tests
    # the existing job, plus:
      - name: Type-check
        working-directory: desktop
        run: |
          npx tsc --noEmit -p tsconfig.web.json
          npx tsc --noEmit -p tsconfig.node.json
          npx tsc --noEmit -p tsconfig.e2e.json

  integration:
    name: Integration tests (PostGIS service)
    runs-on: ubuntu-latest
    timeout-minutes: 40
    services:
      db:
        image: postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5
        env:
          POSTGRES_USER: groundmodel
          POSTGRES_PASSWORD: groundmodel
          POSTGRES_DB: groundmodel_integration
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U groundmodel -d groundmodel_integration"
          --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      DATABASE_URL: postgresql+asyncpg://groundmodel:groundmodel@127.0.0.1:5432/groundmodel_integration
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: astral-sh/setup-uv@caf0cab7a618c569241d31dcd442f54681755d39 # v3
        with: { enable-cache: true, cache-dependency-glob: uv.lock }
      - run: uv python install 3.11
      - run: uv sync --group dev
      - run: uv run alembic upgrade head
      - run: uv run pytest tests/integration -q -o faulthandler_timeout=300

  dco:
    name: DCO sign-off
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
        with: { fetch-depth: 0 }
      - run: bash scripts/check_dco.sh "${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}"
```

Every `uses:` keeps its SHA pin; `uv.lock` is the cache key. The `paths-ignore` on push stays; the pull_request trigger has no path filter (every PR runs every job, so the required checks always report).

- [ ] **Step 5: Run the test**

Run: `uv run pytest tests/unit/docs/test_ci_workflow.py -q`. Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git commit -m "ci: lint-types, python-unit, desktop (three tsc configs), integration on a PostGIS service, DCO sign-off"
```

- [ ] **Step 6b: Sign off the branch (session main)**: the branch is unpushed, so rewrite it once with the DCO trailer on every commit: `git rebase origin/develop --exec 'git commit --amend --no-edit -s'` (the committer is the owner's git identity); verify `bash scripts/check_dco.sh origin/develop..HEAD` prints nothing.
- [ ] **Step 7: Prove the CI on the private repo (session main)**

Push `feat/open-source`, open the PR against `develop`, wait for the five jobs. Expected: all green. Then the negative test: cut `test/dco-negative` with one commit without `-s`, open a PR, expect `dco` red, close the PR, delete the branch.

---

### Task 10: Land and prepare the flip (session main, after 0.1.6 is published)

- [ ] **Step 1: Land** `feat/open-source` on `develop` by fast-forward (one PR, or one PR per task if the owner prefers), gated push, `gh pr view N --json state -q .state` = MERGED before the branch delete.
- [ ] **Step 2: Point the release machinery at the public repo** (small PR `chore/public-repo-feed`): `desktop/package.json:89-93` publish block `"repo": "strixgeo"`; `desktop/scripts/publishedVersion.mjs:21` `RELEASES_REPO = 'Vorsie/strixgeo'`; `desktop/src/main/updaterService.ts:27` and `:270` comments; `docs/distribution-build.md` "Releasing" section; memory `reference_strixgeo_releases_repo.md` (session main).
- [ ] **Step 3: Bump** `desktop/package.json` version to `0.2.0` and `pyproject.toml` version to `0.2.0` (PR `chore/bump-0.2.0`), add the `## [0.2.0]` entry to `CHANGELOG.md`.

### Task 11: Flip day (session main)

- [ ] **Step 1: Rename and publish the repo**

```bash
gh repo rename strixgeo --repo Vorsie/Strix --yes
gh repo edit Vorsie/strixgeo --visibility public --accept-visibility-change-consequences
gh repo edit Vorsie/strixgeo --description "Free, open-source ground model platform for geotechnical data (CPT, boreholes, lab, reports) with exports to design tools" --homepage https://strixgeo.com --enable-wiki=false
git remote set-url origin git@github.com:Vorsie/strixgeo.git
```

- [ ] **Step 2: Branch rules** (for `develop` and `main`):

```bash
for b in develop main; do
gh api -X PUT repos/Vorsie/strixgeo/branches/$b/protection --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["Ruff + mypy","Python unit tests","Desktop eslint-reason + tsc + tests","Integration tests (PostGIS service)","DCO sign-off"]},
 "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,
 "required_linear_history":true,"allow_force_pushes":false,"allow_deletions":false}
JSON
done
gh api -X PATCH repos/Vorsie/strixgeo -f allow_squash_merge=false -f allow_merge_commit=false -f allow_rebase_merge=true -f delete_branch_on_merge=true
```

- [ ] **Step 3: Release 0.2.0**: the release chain as for 0.1.6 (app closed, deep walker 0 findings, `npm run release` with `GH_TOKEN`, tag `v0.2.0`, `main` fast-forward, remove `desktop/dist/latest.yml`). Then the bridge for installed 0.1.x builds:

```bash
gh release create v0.2.0 --repo Vorsie/strixgeo-releases --title "StrixGeo 0.2.0" --notes-file scratchpad/release_notes_020.md desktop/dist/StrixGeo-Setup-0.2.0.exe desktop/dist/StrixGeo-Setup-0.2.0.exe.blockmap desktop/dist/latest.yml
```

- [ ] **Step 4: Archive strixgeo-releases after 0.2.1 ships** (`gh repo archive Vorsie/strixgeo-releases --yes`), and set the Sponsors profile live when GitHub approves it.

### Task 12: Site (strixgeo-site, Astro)

**Files:**
- Modify: `src/pages/download.astro` (whole page), `src/pages/index.astro:28-31`, `:70` and the plan/pricing block if any, `src/pages/beta-eula.astro` (rename to `licence.astro`, redirect kept), `src/pages/terms.astro`, `src/pages/privacy.astro`, `src/components/Nav.astro:18`, `src/components/Footer.astro:8-9`
- Delete: `src/components/SignupForm.astro` usage on the download page (the component may stay for the newsletter)

- [ ] **Step 1: download.astro**

```astro
---
import Base from '../layouts/Base.astro';
const release = 'https://github.com/Vorsie/strixgeo/releases/latest';
---
<Base title="Download StrixGeo" description="StrixGeo is free and open source. Download the Windows installer or build it from source.">
  <section class="hero">
    <div class="eyebrow">Download</div>
    <h1>Free and open source.</h1>
    <p class="lede">StrixGeo is licensed under the GNU AGPL-3.0-or-later. Windows 10 and 11. The installer is not code-signed yet, so Windows shows a SmartScreen warning the first time; choose "More info" and "Run anyway".</p>
    <a class="btn btn--primary" href={release}>Download the latest installer</a>
    <p class="micro">Every release, its notes and checksums: <a href={release}>github.com/Vorsie/strixgeo/releases</a>.</p>
  </section>
  <section>
    <h2>Build from source</h2>
    <p>The source, the build instructions and the issue tracker are on <a href="https://github.com/Vorsie/strixgeo">GitHub</a>. Contributions are welcome; see CONTRIBUTING.md.</p>
    <h2>Support the project</h2>
    <p>StrixGeo costs nothing. If it saves you time, you can <a href="https://github.com/sponsors/Vorsie">sponsor the development on GitHub</a>.</p>
  </section>
</Base>
```

- [ ] **Step 2: index.astro**: line 28 button `href="/download"` label "Download", line 31 micro text "Free and open source (AGPL-3.0). Windows 10 and 11.", line 70 newsletter sentence "Leave your email to hear about new releases. One message, no spam."; delete any plan or price mention (grep `plan|price|Solo|Pro|Studio` prints nothing after the edit).
- [ ] **Step 3: licence, terms, privacy**: `beta-eula.astro` becomes `licence.astro` with one paragraph (AGPL-3.0-or-later, link to the LICENSE file on GitHub, the trademark line) and an Astro redirect from `/beta-eula`; `terms.astro` keeps the site terms and loses the licence-key and beta paragraphs, adds "The software is provided without warranty, as stated in its licence."; `privacy.astro` deletes the activation-server paragraph, keeps the diagnostics paragraph ("sent only when you switch it on in Settings, to an endpoint you configure; by default nothing is sent").
- [ ] **Step 4: Nav and Footer**: Nav CTA `href="/download"` label "Download"; Footer links `Privacy · Cookies · Terms · Licence · GitHub · Support the project` (GitHub = repo URL, Support = Sponsors URL).
- [ ] **Step 5: Build and link-check**

Run: `cd C:\Users\robin\Documents\strixgeo-site && npm run build && grep -rl "beta key\|Request beta access\|mailerlite" dist/ ; echo exit=$?`
Expected: build OK; the grep prints nothing (exit 1).

- [ ] **Step 6: Deploy on flip day** with the GO-LIVE.md recipe:

```bash
cd dist && tar czf - . | ssh -i ~/.ssh/strixgeo_combell_ed25519 strixgeocom@ssh.strixgeo.com 'tar xzf - -C www'
```

Then `curl -sI https://strixgeo.com/download | head -1` = 200 and the page shows the download button (the nginx front cache may answer the old page for a few minutes).

- [ ] **Step 7: Commit the site repo** (`feat(site): open-source download page, licence page, sponsors links`).

### Task 13: Docs and memory rewrite (session main)

- [ ] **Step 1**: `CLAUDE.md` "Commercial Direction" (line 61) becomes "Project direction": free and open source, AGPL-3.0-or-later, one public repo, Sponsors; the pointer to `docs/commercial-direction.md` stays but that file is rewritten: the three-level hierarchy, cross-sections, the explicit-content invariant and the v1.0 gate stay; the distribution model, pricing and paid-tier sections go.
- [ ] **Step 2**: `CLAUDE.local.md`: delete "Commercial planning (private)", the Activation / Beta ships unsigned / Protection tier ruling bullets; add one line "Open source since 0.2.0 (2026-10-xx): AGPL-3.0-or-later, Sponsors, no paid tier."
- [ ] **Step 3**: memory files: `project_coworker_distribution.md` (delete), `reference_strixgeo_releases_repo.md` (feed = Vorsie/strixgeo from 0.2.0), `feedback_honest_commercial_advice.md` (keep; still applies to open-source strategy), new `project_open_source_agpl_2026_10_17.md` (the decisions table of the spec) and the MEMORY.md index lines.
- [ ] **Step 3b**: `docs/manual/chapters/05-support.rst` "What the beta does not send": check the sentence that the app "offers to send a redacted diagnostics bundle" against the renderer (no send UI without an endpoint); rewrite to the consent + `STRIXGEO_DIAGNOSTICS_URL` state. Also the chapter's "StrixGeo is in closed beta" sentence.
- [ ] **Step 3c**: README screenshots (spec section 3 lists them; the owner picks two or three: a cross-section, the 3-D model, the PDF triage).
- [ ] **Step 3d**: two follow-ups found in the Task 8 review: `tests/unit/application/test_link_litho_to_geo.py:153-160` asserts a `session.get(..., GEO_CONTACT_ID)` call that the test itself makes (vacuous; delete line 153 and its comment, keep the test green); `g1a2b3c4d5e6_lens_companion_and_primary_section.py:56,76` uses `sa.dialects.postgresql.UUID` without an explicit import (works only because env.py loads the models first; give it the explicit `from sqlalchemy.dialects import postgresql`).
- [ ] **Step 3e**: CI follow-ups from the Task 9 review: `tests/integration/db/test_migration_upgrade_from_empty.py` takes host/port/credentials from `DATABASE_URL` and FAILS instead of skipping when `CI` is set; `test_dov_borehole_by_name_live.py` skips on any `httpx.HTTPError` inside the tests (today only the collection probe skips).
- [ ] **Step 4**: `docs/debt.md` new items: "Hosted Windows installer build in GitHub Actions" and "rename `registerPrototypeIpc` to `registerUpdaterIpc` (it registers only the updater since Task 2)" (Tier D, trigger: the first external contributor who needs a build they cannot make locally).
