// The packaged app's own user profile (owner ruling 2026-08-27).
//
// Electron derives `app.getPath('userData')` from package.json's `name`
// (`ground-model-desktop`) — the SAME folder the dev app uses, because
// `build.productName` renames the product, not the profile. Sharing that
// folder would put the embedded Postgres cluster next to the developer's live
// recovery/recents, make the single-instance lock mutual (dev and an
// installed build could never run at the same time), and bake the internal
// repo name into every customer machine and support doc forever. A packaged
// build therefore claims `%APPDATA%\StrixGeo` for itself.
//
// The rename is only safe while NO real install exists: the profile holds the
// customer's `pgdata`, so a later move strands their data unless migrated
// (docs/distribution-build.md). Shipped now, before install #1, it costs
// nothing and is permanent in the good direction.
//
// MUST run before anything reads userData — the single-instance lock, the
// recovery store, the diagnostics store and the embedded
// stack all resolve paths off it. `packagedProfile.test.ts` PP3 pins the
// call-site order in `index.ts`.

import { join } from 'path'

/** The packaged profile's directory name under %APPDATA% — the brand name. */
export const PACKAGED_PROFILE_DIR_NAME = 'StrixGeo'

/** The slice of Electron's `app` this module needs (injectable for tests). */
export interface ProfileApp {
  isPackaged: boolean
  getPath(name: 'appData'): string
  setPath(name: 'userData' | 'sessionData' | 'logs', value: string): void
  commandLine: { hasSwitch(name: string): boolean }
}

/**
 * Move a PACKAGED app's profile to `%APPDATA%\StrixGeo`; leave dev alone.
 *
 * `sessionData` (Chromium caches) is set explicitly rather than trusting it
 * to follow `userData` — its default is derived, and a derived default is a
 * behaviour change away from splitting the profile in two.
 *
 * The LARGE, machine-local stores do NOT belong in the Roaming profile (audit
 * M1): a domain-joined consultancy syncs or redirects Roaming to a share, and a
 * running database / big caches / churny logs must not travel. Of those, only
 * `logs` is Electron's to relocate here (via `getPath('logs')`); `pgdata` and
 * the numba cache move through the embedded layout. When `%LOCALAPPDATA%` is
 * given, `logs` is pointed at `%LOCALAPPDATA%\StrixGeo\logs`.
 *
 * Parameters
 * ----------
 * electronApp
 *     Electron's `app`, or a test double exposing the same members.
 * localAppDataDir
 *     `%LOCALAPPDATA%` (`process.env.LOCALAPPDATA`). When present, `logs` moves
 *     under it; when absent, `logs` keeps its default (derived from userData).
 *
 * Returns
 * -------
 * boolean
 *     `true` when the profile was moved (packaged), `false` for dev or when
 *     an explicit `--user-data-dir` isolates the run.
 */
export function applyPackagedProfile(
  electronApp: ProfileApp,
  localAppDataDir?: string | null,
): boolean {
  if (!electronApp.isPackaged) return false
  // An explicit --user-data-dir is a deliberate isolation request (test runs,
  // docs/distribution-build.md) — overriding it here would silently point an
  // "isolated" run at the real future-install profile.
  if (electronApp.commandLine.hasSwitch('user-data-dir')) return false
  const dir = join(electronApp.getPath('appData'), PACKAGED_PROFILE_DIR_NAME)
  electronApp.setPath('userData', dir)
  electronApp.setPath('sessionData', dir)
  // Relocate logs to the machine-local root when it is resolvable (M1). If it is
  // not, leave logs at their derived default rather than crash.
  if (localAppDataDir) {
    electronApp.setPath('logs', join(localAppDataDir, PACKAGED_PROFILE_DIR_NAME, 'logs'))
  }
  return true
}
