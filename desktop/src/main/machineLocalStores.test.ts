// M1 — the LARGE machine-local stores (the live Postgres cluster, the numba
// cache, the logs) belong under %LOCALAPPDATA%\StrixGeo, NOT the Roaming
// profile: a domain-joined consultancy syncs or redirects Roaming to a share,
// and a live database / big caches / logs must not travel. Small stores
// (recents, recovery, credentials) stay in Roaming.
//
// This pins WHEN the split applies — packaged, not an isolated --user-data-dir
// run, and a resolvable %LOCALAPPDATA% — and where the dir lands.

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveMachineLocalStrixDir } from './machineLocalStores'
import { PACKAGED_PROFILE_DIR_NAME } from './packagedProfile'

const LOCAL = 'C:\\Users\\test\\AppData\\Local'

describe('resolveMachineLocalStrixDir', () => {
  it('packaged, non-isolated, LOCALAPPDATA present → %LOCALAPPDATA%\\StrixGeo', () => {
    const dir = resolveMachineLocalStrixDir({ packaged: true, isolated: false, localAppData: LOCAL })
    expect(dir).toBe(join(LOCAL, PACKAGED_PROFILE_DIR_NAME))
  })

  it('dev → null (Docker owns the DB; nothing to relocate)', () => {
    expect(
      resolveMachineLocalStrixDir({ packaged: false, isolated: false, localAppData: LOCAL }),
    ).toBeNull()
  })

  it('isolated (--user-data-dir) → null, so a test run co-locates under its own userData', () => {
    // Forcing a machine-wide Local\StrixGeo here would collide across isolated
    // runs and defeat the isolation the switch exists to give.
    expect(
      resolveMachineLocalStrixDir({ packaged: true, isolated: true, localAppData: LOCAL }),
    ).toBeNull()
  })

  it('no LOCALAPPDATA → null, so the split degrades to keeping pgdata in Roaming', () => {
    expect(
      resolveMachineLocalStrixDir({ packaged: true, isolated: false, localAppData: undefined }),
    ).toBeNull()
    expect(
      resolveMachineLocalStrixDir({ packaged: true, isolated: false, localAppData: '' }),
    ).toBeNull()
  })
})
