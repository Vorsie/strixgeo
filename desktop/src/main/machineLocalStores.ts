/**
 * Where the LARGE, machine-local stores live in a packaged build (audit M1).
 *
 * ``packagedProfile`` claims ``%APPDATA%\StrixGeo`` (Roaming) for the user
 * profile. That is right for the SMALL stores — recents, recovery files, the DB
 * credentials — which a user reasonably wants to follow them between machines.
 * It is wrong for the LARGE, machine-specific ones: the live PostgreSQL cluster
 * (``pgdata``), the numba compile cache and the logs. A domain-joined
 * consultancy syncs or redirects Roaming to a network share, and a running
 * database on a share is at best slow and at worst corrupt; the caches and logs
 * are pure churn on the sync.
 *
 * So those move to ``%LOCALAPPDATA%\StrixGeo``. This module decides WHEN the
 * split applies and WHERE the local root lands — the same gate ``packagedProfile``
 * uses (packaged, not an isolated ``--user-data-dir`` run) plus a resolvable
 * ``%LOCALAPPDATA%``. Pure and Electron-free.
 *
 * @module main/machineLocalStores
 */

import { join } from 'path'

import { PACKAGED_PROFILE_DIR_NAME } from './packagedProfile'

/** What the split decision needs to know about this launch. */
export interface MachineLocalContext {
  /** ``app.isPackaged`` — dev keeps Docker's database and relocates nothing. */
  packaged: boolean
  /** Whether an explicit ``--user-data-dir`` isolates this run (tests). */
  isolated: boolean
  /** ``%LOCALAPPDATA%`` (``process.env.LOCALAPPDATA``), or absent. */
  localAppData: string | null | undefined
}

/**
 * Resolve the machine-local StrixGeo directory for the large stores.
 *
 * Parameters
 * ----------
 * ctx : MachineLocalContext
 *     The launch context — see {@link MachineLocalContext}.
 *
 * Returns
 * -------
 * string | null
 *     ``%LOCALAPPDATA%\StrixGeo`` when the split applies; ``null`` for dev, an
 *     isolated run, or a machine with no ``%LOCALAPPDATA%`` (the large stores
 *     then stay in the Roaming profile — correct, if not ideal).
 */
export function resolveMachineLocalStrixDir(ctx: MachineLocalContext): string | null {
  if (!ctx.packaged) return null
  // An explicit --user-data-dir is a deliberate isolation request; a machine-wide
  // Local\StrixGeo would collide across such runs and defeat it.
  if (ctx.isolated) return null
  if (!ctx.localAppData) return null
  return join(ctx.localAppData, PACKAGED_PROFILE_DIR_NAME)
}
