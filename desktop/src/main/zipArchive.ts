/**
 * Minimal ZIP writer (Electron main process).
 *
 * Exists so a crash bundle can be a real ``.zip`` — the format a tester can
 * double-click and a support thread can attach — **without adding a runtime
 * dependency**. Every byte here comes from Node built-ins (``zlib`` for
 * DEFLATE and CRC-32), which keeps the packaging story unchanged: no new
 * ``dependencies`` entry, nothing to unpack from the asar, nothing to audit.
 *
 * Scope is deliberately the smallest thing that produces a valid archive:
 * single disk, no ZIP64, no encryption, no directory entries, stored or
 * deflated files only. That covers "a handful of log files" and nothing else;
 * if a future caller needs more, take the dependency instead of growing this.
 *
 * Structure written (PKZIP APPNOTE 6.3.x):
 *
 *     [local header + data] × n
 *     [central directory header] × n
 *     [end of central directory]
 *
 * ## Verification
 *
 * ``zipArchive.test.ts`` walks the result by spec offsets — an independent
 * reader, so a writer bug cannot hide behind a matching reader bug. The
 * external oracle is Windows' own unpacker; re-run it by hand when this file
 * changes:
 *
 *     Expand-Archive -Path out.zip -DestinationPath out -Force
 */

import { crc32, deflateRawSync } from 'zlib'

/** One file to place in the archive. */
export interface ZipEntry {
  /** Name inside the archive. Forward slashes for any nesting. */
  name: string
  /** File content; strings are encoded UTF-8. */
  data: Uint8Array | string
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

/** Version 2.0 — the floor for DEFLATE support. */
const VERSION_NEEDED = 20

/** Bit 11 — the archive's names are UTF-8. */
const FLAG_UTF8_NAMES = 0x0800

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** MS-DOS epoch — timestamps before 1980 cannot be represented in the format. */
const DOS_EPOCH_YEAR = 1980

/** ``[dosTime, dosDate]`` for a JS date, as packed 16-bit fields. */
function dosTimestamp(at: Date): [number, number] {
  const year = Math.max(at.getFullYear(), DOS_EPOCH_YEAR)
  const dosDate = ((year - DOS_EPOCH_YEAR) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
  // Seconds are stored in 2-second units — the format's own resolution.
  const dosTime = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2)
  return [dosTime, dosDate]
}

/** The compressed form, or the raw bytes when deflating would not help. */
function compress(raw: Buffer): { method: number; body: Buffer } {
  if (raw.length === 0) return { method: METHOD_STORE, body: raw }
  const deflated = deflateRawSync(raw)
  // Storing a file that deflate made bigger (already-compressed input, or a
  // few bytes) keeps the archive honest about its own size.
  return deflated.length < raw.length
    ? { method: METHOD_DEFLATE, body: deflated }
    : { method: METHOD_STORE, body: raw }
}

/**
 * Build a ZIP archive in memory.
 *
 * Parameters
 * ----------
 * entries : ZipEntry[]
 *     Files to include, in the order they should appear.
 * modifiedAt : Date, optional
 *     Timestamp stamped on every entry; defaults to now. Pinning it makes the
 *     output byte-stable, which is what a test needs.
 *
 * Returns
 * -------
 * Buffer
 *     The complete archive.
 *
 * Raises
 * ------
 * Error
 *     When two entries share a name — an archive with duplicates unpacks
 *     differently depending on the tool, which is never what a support bundle
 *     wants.
 */
export function createZipArchive(entries: ZipEntry[], modifiedAt: Date = new Date()): Buffer {
  const seen = new Set<string>()
  const [dosTime, dosDate] = dosTimestamp(modifiedAt)

  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`duplicate zip entry name: ${entry.name}`)
    }
    seen.add(entry.name)

    const nameBytes = Buffer.from(entry.name, 'utf-8')
    const rawBuffer =
      typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf-8') : Buffer.from(entry.data)
    const checksum = crc32(rawBuffer)
    const { method, body } = compress(rawBuffer)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0)
    localHeader.writeUInt16LE(VERSION_NEEDED, 4)
    localHeader.writeUInt16LE(FLAG_UTF8_NAMES, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(body.length, 18)
    localHeader.writeUInt32LE(rawBuffer.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localChunks.push(localHeader, nameBytes, body)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0)
    centralHeader.writeUInt16LE(VERSION_NEEDED, 4)
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6)
    centralHeader.writeUInt16LE(FLAG_UTF8_NAMES, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(body.length, 20)
    centralHeader.writeUInt32LE(rawBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralChunks.push(centralHeader, nameBytes)
    offset += localHeader.length + nameBytes.length + body.length
  }

  const central = Buffer.concat(centralChunks)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localChunks, central, eocd])
}
