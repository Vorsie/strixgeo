/**
 * The crash-bundle ZIP writer.
 *
 * Verified against the PKZIP APPNOTE structure directly — the reader below
 * walks the central directory by spec offsets rather than calling our own
 * writer's helpers, so a bug in the writer cannot hide behind a matching bug in
 * the reader. A real ``Expand-Archive`` round-trip is the external oracle and
 * is run by hand when this file changes (see the module docstring of
 * ``zipArchive.ts``).
 */

import { inflateRawSync } from 'zlib'

import { describe, expect, it } from 'vitest'

import { createZipArchive } from './zipArchive'

/**
 * Minimal spec-driven reader: find the End Of Central Directory record, walk
 * the central directory, and inflate each entry from its local header.
 */
function readZipEntries(zip: Buffer): Record<string, string> {
  const eocdOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocdOffset).toBeGreaterThanOrEqual(0)

  const entryCount = zip.readUInt16LE(eocdOffset + 10)
  let cursor = zip.readUInt32LE(eocdOffset + 16)

  const out: Record<string, string> = {}
  for (let i = 0; i < entryCount; i++) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50) // central file header
    const method = zip.readUInt16LE(cursor + 10)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf-8')

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50) // local file header
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = zip.subarray(dataStart, dataStart + compressedSize)

    out[name] = method === 0 ? data.toString('utf-8') : inflateRawSync(data).toString('utf-8')
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return out
}

describe('the archive is a real zip', () => {
  it('Z1 — one entry round-trips its content', () => {
    const zip = createZipArchive([{ name: 'manifest.json', data: '{"ok":true}' }])

    expect(readZipEntries(zip)).toEqual({ 'manifest.json': '{"ok":true}' })
  })

  it('Z2 — several entries all survive, under their own names', () => {
    const zip = createZipArchive([
      { name: 'manifest.json', data: '{"ok":true}' },
      { name: 'diagnostics.log', data: '{"message":"boom"}\n' },
      { name: 'backend.log', data: 'line one\nline two\n' },
    ])

    const entries = readZipEntries(zip)
    expect(Object.keys(entries).sort()).toEqual([
      'backend.log',
      'diagnostics.log',
      'manifest.json',
    ])
    expect(entries['backend.log']).toBe('line one\nline two\n')
  })

  it('Z3 — an empty file is still an entry', () => {
    const zip = createZipArchive([{ name: 'empty.log', data: '' }])

    expect(readZipEntries(zip)).toEqual({ 'empty.log': '' })
  })

  it('Z4 — content large enough to compress still round-trips', () => {
    const body = 'a repeated diagnostic line\n'.repeat(5000)

    const zip = createZipArchive([{ name: 'big.log', data: body }])

    expect(readZipEntries(zip)['big.log']).toBe(body)
    // Compression is the point of deflating at all: a support bundle has to be
    // small enough to email.
    expect(zip.length).toBeLessThan(body.length / 2)
  })

  it('Z5 — an archive with no entries is still a well-formed zip', () => {
    const zip = createZipArchive([])

    expect(readZipEntries(zip)).toEqual({})
  })

  it('Z6 — a duplicate entry name is refused rather than written twice', () => {
    expect(() =>
      createZipArchive([
        { name: 'a.log', data: 'one' },
        { name: 'a.log', data: 'two' },
      ]),
    ).toThrow(/duplicate/i)
  })
})
