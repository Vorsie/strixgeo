/**
 * The crash bundle a tester can be asked to send by hand.
 *
 * The promise it has to keep: **everything inside it is safe to send**. The
 * diagnostics log is redacted by construction; the backend log is NOT (it
 * carries the database DSN and raw file paths), so the bundle redacts it on the
 * way in. A bundle that leaked either would make the whole "just zip your logs
 * and mail them" support flow unusable at a consultancy.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { inflateRawSync } from 'zlib'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildCrashBundle, crashBundleFileName } from './crashBundle'
import { captureDiagnostic, configureDiagnosticsStore, resetDiagnosticsStoreForTests } from './diagnosticsStore'

let dir: string
let logsDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-bundle-'))
  logsDir = join(dir, 'logs')
  mkdirSync(logsDir, { recursive: true })
  configureDiagnosticsStore({
    userDataDir: dir,
    appVersion: '0.1.0',
    platform: 'win32',
    buildId: '2026.08.26-beta',
  })
})

afterEach(() => {
  resetDiagnosticsStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

/** Every entry name and its text, read back out of the archive. */
function entriesOf(zip: Buffer): Record<string, string> {
  const eocdOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const entryCount = zip.readUInt16LE(eocdOffset + 10)
  let cursor = zip.readUInt32LE(eocdOffset + 16)
  const out: Record<string, string> = {}
  for (let i = 0; i < entryCount; i++) {
    const method = zip.readUInt16LE(cursor + 10)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf-8')
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const data = zip.subarray(dataStart, dataStart + compressedSize)
    out[name] = method === 0 ? data.toString('utf-8') : inflateRawSync(data).toString('utf-8')
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return out
}

describe('what the bundle contains', () => {
  it('CB1 — a manifest naming the build, so a report can be tied to a version', () => {
    const bundle = buildCrashBundle({ logsDir, consent: false, nowIso: '2026-08-26T12:00:00.000Z' })

    const manifest = JSON.parse(entriesOf(bundle.bytes)['manifest.json'])
    expect(manifest.appVersion).toBe('0.1.0')
    expect(manifest.buildId).toBe('2026.08.26-beta')
    expect(manifest.platform).toBe('win32')
    expect(manifest.createdAt).toBe('2026-08-26T12:00:00.000Z')
  })

  it('CB2 — the captured diagnostics', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'boom' }, 'renderer')

    const bundle = buildCrashBundle({ logsDir, consent: false })

    expect(entriesOf(bundle.bytes)['diagnostics.log']).toContain('boom')
  })

  it('CB3 — the manifest records whether the tester had opted in to transmission', () => {
    const bundle = buildCrashBundle({ logsDir, consent: true })

    expect(JSON.parse(entriesOf(bundle.bytes)['manifest.json']).transmissionOptIn).toBe(true)
  })

  it('CB4 — the manifest lists exactly what was put in the archive', () => {
    captureDiagnostic({ kind: 'renderer-error', message: 'boom' }, 'renderer')
    writeFileSync(join(logsDir, 'backend.log'), 'starting up\n', 'utf-8')

    const bundle = buildCrashBundle({ logsDir, consent: false })

    const entries = entriesOf(bundle.bytes)
    const manifest = JSON.parse(entries['manifest.json'])
    expect(manifest.contents.sort()).toEqual(Object.keys(entries).filter(n => n !== 'manifest.json').sort())
  })

  it('CB5 — the file name says what it is and when it was made', () => {
    expect(crashBundleFileName('2026-08-26T12:34:56.000Z')).toBe(
      'strixgeo-diagnostics-2026-08-26T12-34-56.zip',
    )
  })
})

describe('everything in the bundle is safe to send', () => {
  it('CB6 — the backend log’s database credentials do not make it into the archive', () => {
    writeFileSync(
      join(logsDir, 'backend.log'),
      'connecting to postgresql://groundmodel:groundmodel@127.0.0.1:5433/groundmodel\n',
      'utf-8',
    )

    const bundle = buildCrashBundle({ logsDir, consent: false })

    const backend = entriesOf(bundle.bytes)['backend.log']
    expect(backend).not.toContain('groundmodel:groundmodel@')
    expect(backend).toContain('<dsn>')
  })

  it('CB7 — the backend log’s project paths and user name are redacted', () => {
    writeFileSync(
      join(logsDir, 'backend.log'),
      'imported C:\\Users\\robin\\Projecten\\ClientX\\site.strix\n',
      'utf-8',
    )

    const bundle = buildCrashBundle({ logsDir, consent: false })

    const backend = entriesOf(bundle.bytes)['backend.log']
    expect(backend).not.toContain('robin')
    expect(backend).not.toContain('ClientX')
  })

  it('CB8 — a missing backend log is simply absent, not an error', () => {
    const bundle = buildCrashBundle({ logsDir, consent: false })

    expect(Object.keys(entriesOf(bundle.bytes))).not.toContain('backend.log')
  })

  it('CB9 — only files this bundle knows about are ever included', () => {
    writeFileSync(join(logsDir, 'secrets.txt'), 'nothing to see', 'utf-8')

    const bundle = buildCrashBundle({ logsDir, consent: false })

    expect(Object.keys(entriesOf(bundle.bytes))).not.toContain('secrets.txt')
  })

  it('CB10 — an enormous backend log is trimmed to its tail rather than shipped whole', () => {
    const huge = 'a line of backend log output\n'.repeat(200_000)
    writeFileSync(join(logsDir, 'backend.log'), huge, 'utf-8')

    const bundle = buildCrashBundle({ logsDir, consent: false })

    const backend = entriesOf(bundle.bytes)['backend.log']
    expect(backend.length).toBeLessThan(huge.length)
    expect(backend).toContain('[earlier lines trimmed]')
  })
})
