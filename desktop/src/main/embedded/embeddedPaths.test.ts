import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { resolveEmbeddedLayout, writablePaths, configurePgdataRoot } from './embeddedPaths'

const RESOURCES = join('C:', 'Program Files', 'StrixGeo', 'resources')
const USER_DATA = join('C:', 'Users', 'coworker', 'AppData', 'Roaming', 'StrixGeo')
const LOCAL_ROOT = join('C:', 'Users', 'coworker', 'AppData', 'Local', 'StrixGeo')

// The pgdata root is module state (configured once at startup by index.ts). Reset
// after every test so a configured case never leaks into the default-behaviour
// tests above.
afterEach(() => configurePgdataRoot(null))

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

describe('resolveEmbeddedLayout with a configured Local pgdata root (M1)', () => {
  it('puts the cluster under the Local root while credentials stay in Roaming', () => {
    // A domain-joined consultancy syncs/redirects Roaming; the live cluster must
    // not travel, but the credentials + recents reasonably follow the user.
    configurePgdataRoot(LOCAL_ROOT)
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)

    expect(layout.dataDir).toBe(join(LOCAL_ROOT, 'pgdata'))
    expect(layout.credentialsFile).toBe(join(USER_DATA, 'pgcredentials.json'))
    // The password file must still not sit INSIDE the (now Local) data dir.
    expect(layout.initPasswordFile.startsWith(layout.dataDir)).toBe(false)
  })

  it('reverts to the Roaming profile when the root is cleared (dev / isolated runs)', () => {
    configurePgdataRoot(LOCAL_ROOT)
    configurePgdataRoot(null)
    const layout = resolveEmbeddedLayout(RESOURCES, USER_DATA)
    expect(layout.dataDir).toBe(join(USER_DATA, 'pgdata'))
  })
})
