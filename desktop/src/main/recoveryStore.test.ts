// Unit tests for the app-managed recovery-file store (crash-recovery phase 1).
//
// These exercise the real filesystem inside a throwaway temp directory
// rather than a stubbed fs: the whole point of the module is that a
// half-written or hand-edited file on a REAL disk degrades gracefully, and
// a fake fs would let a wrong assumption about mkdir/rename/ENOENT pass.
//
// The module must stay free of any ``electron`` import (see the note in
// vitest.config.ts) — the userData directory is injected through
// ``configureRecoveryStore`` instead, which is exactly what lets these
// tests point it at a temp dir.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  RECOVERY_DIR_NAME,
  RECOVERY_FILE_SUFFIX,
  RECOVERY_FORMAT_VERSION,
  RECOVERY_KIND,
  configureRecoveryStore,
  deleteRecovery,
  isValidProjectId,
  listRecovery,
  readRecovery,
  recoveryFilePath,
  resetRecoveryStoreForTests,
  validateWriteOptions,
  writeRecovery,
} from './recoveryStore'

const PROJECT_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const PROJECT_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

let userDataDir: string

/** Absolute path of the recovery directory for the current temp userData. */
function recoveryDir(): string {
  return join(userDataDir, RECOVERY_DIR_NAME)
}

/** Write a raw string straight into the recovery dir, bypassing the store. */
function plantRawFile(fileName: string, contents: string): void {
  mkdirSync(recoveryDir(), { recursive: true })
  writeFileSync(join(recoveryDir(), fileName), contents, 'utf-8')
}

/**
 * Plant a well-formed but oversized envelope, bypassing the store.
 *
 * The store itself now refuses an over-cap write, so the read-side cap tests
 * cannot use ``writeRecovery`` to produce their fixture — an over-cap file on
 * disk can only come from corruption, an older build, or a hand edit, which
 * is exactly what this simulates.
 */
function plantOversizedFile(projectId: string, fillerChars: number): void {
  plantRawFile(
    `${projectId}${RECOVERY_FILE_SUFFIX}`,
    JSON.stringify({
      kind: RECOVERY_KIND,
      format_version: RECOVERY_FORMAT_VERSION,
      project_id: projectId,
      project_name: 'x',
      written_at: new Date().toISOString(),
      app_version: '9.9.9-test',
      payload: { filler: 'x'.repeat(fillerChars) },
    }),
  )
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'strix-recovery-test-'))
  configureRecoveryStore({ userDataDir, appVersion: '9.9.9-test' })
})

afterEach(() => {
  resetRecoveryStoreForTests()
  rmSync(userDataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// projectId validation — the ONLY caller-supplied input, so it is the
// entire attack surface of this module.
// ---------------------------------------------------------------------------

describe('isValidProjectId', () => {
  it('accepts a canonical lowercase UUID', () => {
    expect(isValidProjectId(PROJECT_A)).toBe(true)
  })

  it('accepts an uppercase UUID (Postgres can emit either case)', () => {
    expect(isValidProjectId(PROJECT_A.toUpperCase())).toBe(true)
  })

  it('rejects traversal-shaped ids', () => {
    expect(isValidProjectId('../../../../Windows/System32/foo')).toBe(false)
    expect(isValidProjectId('..')).toBe(false)
    expect(isValidProjectId(`../${PROJECT_A}`)).toBe(false)
  })

  it('rejects absolute paths and separators', () => {
    expect(isValidProjectId('C:\\Windows\\System32\\config\\SAM')).toBe(false)
    expect(isValidProjectId('/etc/passwd')).toBe(false)
    expect(isValidProjectId(`${PROJECT_A}/../../evil`)).toBe(false)
    expect(isValidProjectId(`${PROJECT_A}\\evil`)).toBe(false)
  })

  it('rejects a UUID with extra characters appended (no partial-match slip)', () => {
    expect(isValidProjectId(`${PROJECT_A}.recovery.json`)).toBe(false)
    expect(isValidProjectId(`${PROJECT_A}\n`)).toBe(false)
    expect(isValidProjectId(` ${PROJECT_A}`)).toBe(false)
  })

  it('rejects non-strings, empty strings and malformed UUIDs', () => {
    expect(isValidProjectId('')).toBe(false)
    expect(isValidProjectId(undefined)).toBe(false)
    expect(isValidProjectId(null)).toBe(false)
    expect(isValidProjectId(42)).toBe(false)
    expect(isValidProjectId('not-a-uuid')).toBe(false)
    expect(isValidProjectId('3f2504e04f8911d39a0c0305e82c3301')).toBe(false)
  })
})

describe('traversal-shaped projectIds are refused, never sanitised', () => {
  const EVIL = '../../../../Windows/System32/foo'

  it('writeRecovery throws instead of writing outside the recovery dir', () => {
    expect(() => writeRecovery(EVIL, { a: 1 })).toThrow(/project id/i)
    // And nothing was created anywhere under userData.
    expect(existsSync(recoveryDir())).toBe(false)
  })

  it('readRecovery throws rather than reading an arbitrary file', () => {
    expect(() => readRecovery(EVIL)).toThrow(/project id/i)
  })

  it('deleteRecovery throws rather than unlinking an arbitrary file', () => {
    expect(() => deleteRecovery(EVIL)).toThrow(/project id/i)
  })

  it('recoveryFilePath refuses to build a path for an invalid id', () => {
    expect(() => recoveryFilePath(EVIL)).toThrow(/project id/i)
  })
})

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('configureRecoveryStore', () => {
  it('throws a clear error when the store is used before it is configured', () => {
    resetRecoveryStoreForTests()
    expect(() => listRecovery()).toThrow(/not configured/i)
    expect(() => writeRecovery(PROJECT_A, {})).toThrow(/not configured/i)
  })

  it('builds the path as <userData>/recovery/<projectId>.recovery.json', () => {
    expect(recoveryFilePath(PROJECT_A)).toBe(
      join(userDataDir, RECOVERY_DIR_NAME, `${PROJECT_A}${RECOVERY_FILE_SUFFIX}`),
    )
  })
})

// ---------------------------------------------------------------------------
// writeRecovery / readRecovery
// ---------------------------------------------------------------------------

describe('writeRecovery', () => {
  it('creates the recovery directory on the first ever write', () => {
    expect(existsSync(recoveryDir())).toBe(false)
    writeRecovery(PROJECT_A, { lumping: { a: 'b' } }, { projectName: 'Kanaal Noord' })
    expect(existsSync(recoveryDir())).toBe(true)
    expect(existsSync(recoveryFilePath(PROJECT_A))).toBe(true)
  })

  it('writes the documented envelope fields around the opaque payload', () => {
    const before = Date.now()
    writeRecovery(PROJECT_A, { ghosts: [1, 2, 3] }, { projectName: 'Kanaal Noord' })
    const raw = JSON.parse(readFileSync(recoveryFilePath(PROJECT_A), 'utf-8'))
    expect(raw.kind).toBe(RECOVERY_KIND)
    expect(raw.format_version).toBe(RECOVERY_FORMAT_VERSION)
    expect(raw.project_id).toBe(PROJECT_A)
    expect(raw.project_name).toBe('Kanaal Noord')
    expect(raw.app_version).toBe('9.9.9-test')
    expect(Date.parse(raw.written_at)).toBeGreaterThanOrEqual(before - 1000)
    expect(raw.payload).toEqual({ ghosts: [1, 2, 3] })
  })

  it('leaves no temp file behind (the write is atomic)', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    const names = readdirSync(recoveryDir())
    expect(names).toEqual([`${PROJECT_A}${RECOVERY_FILE_SUFFIX}`])
  })

  it('overwrites a previous recovery file for the same project', () => {
    writeRecovery(PROJECT_A, { generation: 1 })
    writeRecovery(PROJECT_A, { generation: 2 })
    expect(readRecovery(PROJECT_A)).toEqual({ generation: 2 })
    expect(readdirSync(recoveryDir())).toHaveLength(1)
  })

  it('returns a descriptor for the file it just wrote', () => {
    const d = writeRecovery(PROJECT_A, { a: 1 }, { projectName: 'Kanaal Noord' })
    expect(d.projectId).toBe(PROJECT_A)
    expect(d.projectName).toBe('Kanaal Noord')
    expect(d.filePath).toBe(recoveryFilePath(PROJECT_A))
    expect(d.appVersion).toBe('9.9.9-test')
    expect(d.sizeBytes).toBeGreaterThan(0)
  })
})

// The write cap and the read cap are ONE number. A write that sails past a
// cap the read path enforces produces a file that looks like protection and
// is not: the next launch refuses it, and the session delta it was supposed
// to hold is gone with no warning at the moment it mattered.
describe('writeRecovery size cap', () => {
  /** Point the store at a small cap so the tests need no huge payloads. */
  function withCap(bytes: number): void {
    configureRecoveryStore({ userDataDir, appVersion: '9.9.9-test', fileCapBytes: bytes })
  }

  it('refuses a payload the read path would later refuse, and writes nothing', () => {
    withCap(400)
    expect(() => writeRecovery(PROJECT_A, { filler: 'x'.repeat(2000) })).toThrow(/cap/i)
    // Refused before mkdir — a rejected write leaves no trace at all.
    expect(existsSync(recoveryDir())).toBe(false)
  })

  it('leaves the previous recovery file intact when the new payload is over cap', () => {
    withCap(400)
    writeRecovery(PROJECT_A, { generation: 1 })
    const before = readFileSync(recoveryFilePath(PROJECT_A), 'utf-8')

    expect(() =>
      writeRecovery(PROJECT_A, { generation: 2, filler: 'x'.repeat(2000) }),
    ).toThrow(/cap/i)

    // The still-restorable older delta must survive the refusal — neither
    // clobbered, nor truncated, nor deleted.
    expect(existsSync(recoveryFilePath(PROJECT_A))).toBe(true)
    expect(readFileSync(recoveryFilePath(PROJECT_A), 'utf-8')).toBe(before)
    expect(readRecovery(PROJECT_A)).toEqual({ generation: 1 })
    // And no half-written temp orphan from the refused write.
    expect(readdirSync(recoveryDir())).toEqual([`${PROJECT_A}${RECOVERY_FILE_SUFFIX}`])
  })

  it('measures bytes, not characters (multi-byte text cannot slip past)', () => {
    // The read path caps on the on-disk BYTE size, so the write path must
    // too. 200 '€' are 600 UTF-8 bytes; 200 'x' are 200. A String.length
    // check would have judged both identical and let the first one through.
    withCap(600)
    writeRecovery(PROJECT_A, { text: 'x'.repeat(200) })
    expect(readRecovery(PROJECT_A)).toEqual({ text: 'x'.repeat(200) })
    expect(() => writeRecovery(PROJECT_B, { text: '€'.repeat(200) })).toThrow(/cap/i)
    expect(existsSync(recoveryFilePath(PROJECT_B))).toBe(false)
  })
})

// The renderer is untrusted input: an IPC argument annotated ``string`` in
// the handler signature is a comment, not a check.
describe('validateWriteOptions', () => {
  it('accepts no options at all', () => {
    expect(validateWriteOptions(undefined)).toEqual({})
    expect(validateWriteOptions(null)).toEqual({})
    expect(validateWriteOptions({})).toEqual({ projectName: undefined })
  })

  it('accepts a string projectName', () => {
    expect(validateWriteOptions({ projectName: 'Kanaal Noord' })).toEqual({
      projectName: 'Kanaal Noord',
    })
  })

  it('rejects a projectName that is not a string', () => {
    expect(() => validateWriteOptions({ projectName: 42 })).toThrow(/projectName/)
    expect(() => validateWriteOptions({ projectName: null })).toThrow(/projectName/)
    expect(() => validateWriteOptions({ projectName: ['Kanaal'] })).toThrow(/projectName/)
    expect(() => validateWriteOptions({ projectName: { nested: 'x' } })).toThrow(/projectName/)
    // Carries a ``slice``, so it would have survived an unchecked
    // ``.slice(0, 200)`` and landed a non-string in the envelope.
    expect(() => validateWriteOptions({ projectName: [1, 2, 3] })).toThrow(/projectName/)
  })

  it('rejects options that are not an object', () => {
    expect(() => validateWriteOptions('Kanaal Noord')).toThrow(/object/)
    expect(() => validateWriteOptions(42)).toThrow(/object/)
    expect(() => validateWriteOptions([])).toThrow(/object/)
  })
})

describe('writeRecovery with untrusted options', () => {
  // The message is asserted, not just "it threw": an unvalidated non-string
  // ALSO throws here — a TypeError from ``.slice`` whose text happens to
  // mention projectName. Only the refusal message proves the check ran.
  const REFUSAL = /recovery refused — options\.projectName must be a string/

  it('refuses a non-string projectName and writes nothing', () => {
    expect(() => writeRecovery(PROJECT_A, { a: 1 }, { projectName: 42 })).toThrow(REFUSAL)
    expect(existsSync(recoveryDir())).toBe(false)
  })

  it('refuses a non-string that carries its own slice (the silent-corruption case)', () => {
    // An array survives ``(value ?? '').slice(0, 200)`` and lands a non-string
    // in project_name — a file that writes cleanly and that validateEnvelope
    // then refuses on read: unrecoverable work with no error at write time.
    expect(() => writeRecovery(PROJECT_A, { a: 1 }, { projectName: ['Kanaal'] })).toThrow(REFUSAL)
    expect(existsSync(recoveryDir())).toBe(false)
  })

  it('leaves an existing recovery file intact when the options are refused', () => {
    writeRecovery(PROJECT_A, { generation: 1 }, { projectName: 'Kanaal Noord' })
    expect(() => writeRecovery(PROJECT_A, { generation: 2 }, { projectName: ['x'] })).toThrow(
      REFUSAL,
    )
    expect(readRecovery(PROJECT_A)).toEqual({ generation: 1 })
    expect(listRecovery()[0].projectName).toBe('Kanaal Noord')
  })
})

// The payload contract is "plain JSON values only". A value JSON.stringify
// cannot express must fail LOUDLY at the write, not throw a bare TypeError out
// of an autosave the renderer did not know could fail this way.
describe('writeRecovery with a non-JSON-serialisable payload', () => {
  const REFUSAL = /recovery write refused — payload is not JSON-serialisable/

  it('refuses a BigInt and writes nothing', () => {
    expect(() => writeRecovery(PROJECT_A, { count: BigInt(1) })).toThrow(REFUSAL)
    expect(existsSync(recoveryDir())).toBe(false)
  })

  it('refuses a circular reference and writes nothing', () => {
    const circular: Record<string, unknown> = { name: 'ghosts' }
    circular.self = circular
    expect(() => writeRecovery(PROJECT_A, circular)).toThrow(REFUSAL)
    expect(existsSync(recoveryDir())).toBe(false)
  })

  it('leaves an existing recovery file intact when the payload is refused', () => {
    writeRecovery(PROJECT_A, { generation: 1 })
    expect(() => writeRecovery(PROJECT_A, { generation: BigInt(2) })).toThrow(REFUSAL)
    expect(readRecovery(PROJECT_A)).toEqual({ generation: 1 })
    expect(readdirSync(recoveryDir())).toEqual([`${PROJECT_A}${RECOVERY_FILE_SUFFIX}`])
  })
})

// A UUID is accepted in either case because the database can render it either
// way. If the id were used verbatim, a session that wrote under the uppercase
// spelling and read back under the lowercase one would find the file (NTFS is
// case-insensitive), fail the envelope's id comparison, and report "nothing to
// recover" while the work sat right there on disk.
describe('projectId case is canonicalised at the boundary', () => {
  const UPPER = PROJECT_A.toUpperCase()

  it('reads back work written under the uppercase spelling', () => {
    writeRecovery(UPPER, { generation: 1 }, { projectName: 'Kanaal Noord' })
    expect(readRecovery(PROJECT_A)).toEqual({ generation: 1 })
  })

  it('reads back work written under the lowercase spelling', () => {
    writeRecovery(PROJECT_A, { generation: 2 })
    expect(readRecovery(UPPER)).toEqual({ generation: 2 })
  })

  it('does not create two files for the two spellings of one project', () => {
    writeRecovery(UPPER, { generation: 1 })
    writeRecovery(PROJECT_A, { generation: 2 })
    expect(readdirSync(recoveryDir())).toEqual([`${PROJECT_A}${RECOVERY_FILE_SUFFIX}`])
    expect(readRecovery(UPPER)).toEqual({ generation: 2 })
  })

  it('reports and lists the canonical id whichever spelling wrote it', () => {
    const d = writeRecovery(UPPER, { a: 1 }, { projectName: 'Kanaal Noord' })
    expect(d.projectId).toBe(PROJECT_A)
    expect(d.filePath).toBe(recoveryFilePath(UPPER))
    expect(listRecovery().map(x => x.projectId)).toEqual([PROJECT_A])
  })

  it('deletes the file whichever spelling asks for it', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    expect(deleteRecovery(UPPER)).toBe(true)
    expect(listRecovery()).toEqual([])
  })

  it('still accepts a legacy file whose envelope id carries the other case', () => {
    // Written by a build that stored the id verbatim — the file is genuine,
    // so a case-only difference must not read as "somebody renamed this".
    plantRawFile(
      `${PROJECT_A}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: RECOVERY_KIND,
        format_version: RECOVERY_FORMAT_VERSION,
        project_id: UPPER,
        project_name: 'Kanaal Noord',
        written_at: new Date().toISOString(),
        app_version: '1.0.0',
        payload: { legacy: true },
      }),
    )
    expect(readRecovery(PROJECT_A)).toEqual({ legacy: true })
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_A])
  })
})

describe('readRecovery', () => {
  it('round-trips a nested payload faithfully', () => {
    const payload = {
      lumping: { KLEI: ['a', 'b'], nested: { deep: [1, 2, { x: null }] } },
      dirty: true,
      draft: 'Kanaal — Noord/Zuid ⚠',
      count: 0,
    }
    writeRecovery(PROJECT_A, payload)
    expect(readRecovery(PROJECT_A)).toEqual(payload)
  })

  it('round-trips a non-object payload (the shape is the renderer phase\'s call)', () => {
    writeRecovery(PROJECT_A, [1, 2, 3])
    expect(readRecovery(PROJECT_A)).toEqual([1, 2, 3])
  })

  it('returns null when no recovery file exists for the project', () => {
    expect(readRecovery(PROJECT_B)).toBe(null)
  })

  it('returns null for a corrupt file rather than throwing', () => {
    plantRawFile(`${PROJECT_A}${RECOVERY_FILE_SUFFIX}`, '{"kind": "strixgeo.rec')
    expect(readRecovery(PROJECT_A)).toBe(null)
  })

  it('returns null for a file whose envelope kind does not match', () => {
    plantRawFile(
      `${PROJECT_A}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: 'something.else',
        format_version: RECOVERY_FORMAT_VERSION,
        project_id: PROJECT_A,
        project_name: 'x',
        written_at: new Date().toISOString(),
        app_version: '1.0.0',
        payload: { a: 1 },
      }),
    )
    expect(readRecovery(PROJECT_A)).toBe(null)
  })

  it('returns null for a stale file from an older format version', () => {
    plantRawFile(
      `${PROJECT_A}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: RECOVERY_KIND,
        format_version: RECOVERY_FORMAT_VERSION - 1,
        project_id: PROJECT_A,
        project_name: 'x',
        written_at: new Date().toISOString(),
        app_version: '0.0.1',
        payload: { a: 1 },
      }),
    )
    expect(readRecovery(PROJECT_A)).toBe(null)
  })

  it('refuses a file above the read cap instead of loading it into memory', () => {
    configureRecoveryStore({
      userDataDir,
      appVersion: '9.9.9-test',
      fileCapBytes: 200,
    })
    plantOversizedFile(PROJECT_A, 500)
    expect(() => readRecovery(PROJECT_A)).toThrow(/cap/i)
  })
})

// ---------------------------------------------------------------------------
// listRecovery
// ---------------------------------------------------------------------------

describe('listRecovery', () => {
  it('returns an empty list when the recovery directory does not exist yet', () => {
    expect(existsSync(recoveryDir())).toBe(false)
    expect(listRecovery()).toEqual([])
  })

  it('returns one descriptor per valid file, without the payload', () => {
    writeRecovery(PROJECT_A, { big: 'payload' }, { projectName: 'Kanaal Noord' })
    writeRecovery(PROJECT_B, { big: 'payload' }, { projectName: 'Haven Zuid' })

    const list = listRecovery()
    expect(list).toHaveLength(2)
    const a = list.find(d => d.projectId === PROJECT_A)!
    expect(a.projectName).toBe('Kanaal Noord')
    expect(a.filePath).toBe(recoveryFilePath(PROJECT_A))
    expect(a.appVersion).toBe('9.9.9-test')
    expect(typeof a.writtenAt).toBe('string')
    expect(a.sizeBytes).toBeGreaterThan(0)
    // The start screen only renders a banner — the payload must NOT ride along.
    expect(Object.prototype.hasOwnProperty.call(a, 'payload')).toBe(false)
    expect(JSON.stringify(list)).not.toContain('big')
  })

  it('skips a corrupt file and keeps the good ones', () => {
    writeRecovery(PROJECT_A, { a: 1 }, { projectName: 'Good' })
    plantRawFile(`${PROJECT_B}${RECOVERY_FILE_SUFFIX}`, 'not json at all {{{')

    const list = listRecovery()
    expect(list.map(d => d.projectId)).toEqual([PROJECT_A])
  })

  it('skips a file whose kind does not match (foreign file in the folder)', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    plantRawFile(
      `${PROJECT_B}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: 'strixgeo.project',
        format_version: RECOVERY_FORMAT_VERSION,
        project_id: PROJECT_B,
        project_name: 'x',
        written_at: new Date().toISOString(),
        app_version: '1.0.0',
        payload: {},
      }),
    )
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_A])
  })

  it('skips a stale file written by an older format version', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    plantRawFile(
      `${PROJECT_B}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: RECOVERY_KIND,
        format_version: RECOVERY_FORMAT_VERSION + 1,
        project_id: PROJECT_B,
        project_name: 'x',
        written_at: new Date().toISOString(),
        app_version: '99.0.0',
        payload: {},
      }),
    )
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_A])
  })

  it('skips a file whose envelope project_id disagrees with its filename', () => {
    // A renamed file: the envelope is the authority we trust for the id, so a
    // mismatch means somebody moved the file and the descriptor would lie.
    plantRawFile(
      `${PROJECT_B}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: RECOVERY_KIND,
        format_version: RECOVERY_FORMAT_VERSION,
        project_id: PROJECT_A,
        project_name: 'x',
        written_at: new Date().toISOString(),
        app_version: '1.0.0',
        payload: {},
      }),
    )
    expect(listRecovery()).toEqual([])
  })

  it('ignores files that are not recovery files at all', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    plantRawFile('notes.txt', 'hello')
    plantRawFile('.gitkeep', '')
    plantRawFile(`${PROJECT_A}${RECOVERY_FILE_SUFFIX}.tmp.1234`, '{}')
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_A])
  })

  it('ignores a file whose name is not a UUID', () => {
    plantRawFile(
      `evil${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: RECOVERY_KIND,
        format_version: RECOVERY_FORMAT_VERSION,
        project_id: PROJECT_A,
        project_name: 'x',
        written_at: new Date().toISOString(),
        app_version: '1.0.0',
        payload: {},
      }),
    )
    expect(listRecovery()).toEqual([])
  })

  it('skips an entry with a pathological project_name (DoS class, mirrors debt #41)', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    plantRawFile(
      `${PROJECT_B}${RECOVERY_FILE_SUFFIX}`,
      JSON.stringify({
        kind: RECOVERY_KIND,
        format_version: RECOVERY_FORMAT_VERSION,
        project_id: PROJECT_B,
        project_name: 'x'.repeat(10_000),
        written_at: new Date().toISOString(),
        app_version: '1.0.0',
        payload: {},
      }),
    )
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_A])
  })

  it('skips a file above the read cap rather than parsing it', () => {
    configureRecoveryStore({
      userDataDir,
      appVersion: '9.9.9-test',
      fileCapBytes: 400,
    })
    writeRecovery(PROJECT_A, { small: 1 })
    plantOversizedFile(PROJECT_B, 2000)
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_A])
  })

  it('returns most-recently-written first so the banner can show the newest', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    // Force a strictly later timestamp — ISO strings have ms resolution and
    // two writes in the same millisecond would make the order arbitrary.
    const path = recoveryFilePath(PROJECT_A)
    const envelope = JSON.parse(readFileSync(path, 'utf-8'))
    envelope.written_at = '2020-01-01T00:00:00.000Z'
    writeFileSync(path, JSON.stringify(envelope), 'utf-8')
    writeRecovery(PROJECT_B, { b: 2 })
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_B, PROJECT_A])
  })
})

// ---------------------------------------------------------------------------
// deleteRecovery
// ---------------------------------------------------------------------------

describe('deleteRecovery', () => {
  it('removes the file and reports that it did', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    expect(deleteRecovery(PROJECT_A)).toBe(true)
    expect(existsSync(recoveryFilePath(PROJECT_A))).toBe(false)
    expect(listRecovery()).toEqual([])
  })

  it('is a no-op (not an error) when the file is already gone', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    deleteRecovery(PROJECT_A)
    expect(() => deleteRecovery(PROJECT_A)).not.toThrow()
    expect(deleteRecovery(PROJECT_A)).toBe(false)
  })

  it('is a no-op when the recovery directory has never been created', () => {
    expect(existsSync(recoveryDir())).toBe(false)
    expect(deleteRecovery(PROJECT_A)).toBe(false)
  })

  it('leaves other projects untouched', () => {
    writeRecovery(PROJECT_A, { a: 1 })
    writeRecovery(PROJECT_B, { b: 2 })
    deleteRecovery(PROJECT_A)
    expect(listRecovery().map(d => d.projectId)).toEqual([PROJECT_B])
  })
})
