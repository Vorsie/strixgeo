import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { resolveEmbeddedLayout, writablePaths } from './embeddedPaths'

const RESOURCES = join('C:', 'Program Files', 'StrixGeo', 'resources')
const USER_DATA = join('C:', 'Users', 'coworker', 'AppData', 'Roaming', 'StrixGeo')

describe('resolveEmbeddedLayout', () => {
  it('takes the Postgres and Python executables from the install directory', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)

    expect(layout.postgresExe).toBe(join(RESOURCES, 'pgsql', 'bin', 'postgres.exe'))
    expect(layout.initdbExe).toBe(join(RESOURCES, 'pgsql', 'bin', 'initdb.exe'))
    expect(layout.pythonExe).toBe(join(RESOURCES, 'python', 'python.exe'))
    expect(layout.backendSrcDir).toBe(join(RESOURCES, 'backend', 'src'))
  })

  it('puts the database cluster and its password under the user profile', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)

    expect(layout.dataDir).toBe(join(USER_DATA, 'pgdata'))
    expect(layout.credentialsFile).toBe(join(USER_DATA, 'pgcredentials.json'))
  })

  // The load-bearing invariant. A standard Windows install lands in
  // "C:\Program Files\", which is read-only for a normal user account — so
  // any writable path that resolves under resourcesPath is a first-launch
  // crash on every machine except the developer's own (where the app runs
  // from a writable build directory and the bug stays invisible).
  it('never places a writable path inside the read-only install directory', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)

    for (const path of writablePaths(layout)) {
      expect(path.startsWith(USER_DATA)).toBe(true)
      expect(path.startsWith(RESOURCES)).toBe(false)
    }
  })

  it('exposes every writable path it owns, so the invariant test cannot rot', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)

    // If a writable member is added to the layout without being added to
    // writablePaths, this count fails and points at the omission.
    expect(writablePaths(layout)).toHaveLength(3)
  })

  // THE first-boot bug, pinned. `initdb` refuses to touch a data directory
  // that already has anything in it — so handing it a password file written
  // INSIDE that directory makes it fail with "directory exists but is not
  // empty", on every machine, every launch, forever. Observed for real.
  it('keeps the initdb password file OUT of the data directory', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)

    expect(layout.initPasswordFile.startsWith(layout.dataDir)).toBe(false)
    expect(layout.initPasswordFile.startsWith(USER_DATA)).toBe(true)
  })
})
