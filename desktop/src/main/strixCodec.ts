/**
 * The ``.strix`` binary container codec (Electron main process).
 *
 * WHAT THIS IS. A save file used to be pretty-printed JSON on disk. This module
 * wraps that exact JSON in a small versioned BINARY container so the user's
 * interpreted data does not sit in plaintext in a file a customer can open in
 * Notepad and copy (owner directive 2026-09-01). The pipeline is:
 *
 *   plaintext JSON  →  gzip (deterministic)  →  add-mod-256 seeded keystream
 *                   →  [ magic | header | ciphered payload ]
 *
 * WHAT THIS IS NOT — and the distinction matters, do not blur it. This is
 * OPACITY-tier file protection. This codec only:
 *   - defeats Notepad (the file is binary, not readable JSON),
 *   - defeats casual copy-paste (you cannot lift the data out by eye), and
 *   - makes every save byte-different (the random per-save seed).
 * It is emphatically NOT cryptography. The seed sits in the header by necessity
 * (decode needs it), and the payload is gzip — whose ``1f 8b`` magic is a known
 * plaintext — so ANYONE who reads this format can reverse ANY file. That is the
 * accepted tier (owner ruled opacity is "good enough"); do NOT market it as, or
 * rely on it for, encryption.
 *
 * BACKWARDS COMPATIBILITY. ``decodeStrix`` SNIFFS. A file whose first
 * non-whitespace byte is ``{`` is legacy plain JSON (every ``.strix`` /
 * ``.gmproj`` ever written before this codec) and is returned verbatim — that
 * path must keep working forever. Only the ``STRIXB1`` magic takes the binary
 * path. The bundle's own ``format_version`` lives INSIDE the JSON and is
 * untouched by this container.
 *
 * CORRUPTION IS LOUD. This machine has documented RAM corruption that once
 * scrambled a ``.strix`` mid-save (CLAUDE.local.md → Machine health). A CRC-32
 * of the uncompressed plaintext is stored in the header and re-checked on
 * decode; a mismatch — or a gunzip failure, or a length mismatch — throws a
 * TYPED {@link StrixCorruptError} naming file corruption, never a generic parse
 * error. Header-too-short throws {@link StrixTruncatedError}; a newer magic or
 * version byte throws {@link StrixUnknownFormatError}. Callers on the open /
 * restore path already treat a throw here as "could not open" and degrade
 * gracefully (they must — an unreadable file must never brick Close).
 *
 * TESTABILITY. Imports only Node built-ins (``zlib`` / ``crypto``), never
 * ``electron``, so it runs under vitest alongside the other pure main-process
 * helpers. The pure keystream is exported ({@link strixKeystream}) and pinned
 * against fixed vectors.
 */

import { crc32, gunzipSync, gzipSync } from 'zlib'
import { randomBytes } from 'crypto'

/**
 * Magic bytes that open every binary ``.strix`` file. Versioned IN the magic:
 * a future incompatible container is ``STRIXB2``, not ``STRIXB1`` with a new
 * codec byte, so an old build recognises "this is a StrixGeo file but newer"
 * rather than mis-reading it. Seven bytes, ASCII.
 */
export const STRIX_MAGIC = Buffer.from('STRIXB1', 'latin1')

/**
 * Codec version byte, stored at offset 7. Bumped only for a change to the
 * transform/header that ``STRIXB1`` still describes; an incompatible container
 * gets a new magic instead. This build reads exactly this version.
 */
export const STRIX_CODEC_VERSION = 1

/**
 * Fixed header size in bytes:
 *   7  magic ('STRIXB1')
 * + 1  codec version byte
 * + 4  seed              (little-endian uint32, random per save)
 * + 4  crc32(plaintext)  (little-endian uint32, over the UNCOMPRESSED JSON)
 * + 4  plaintext length  (little-endian uint32, sanity / progress)
 * = 20
 */
export const STRIX_HEADER_SIZE = 20

const OFFSET_VERSION = 7
const OFFSET_SEED = 8
const OFFSET_CRC = 12
const OFFSET_PLAINTEXT_LEN = 16

/**
 * Non-zero fallback state for a 0 seed. A bare xorshift32 seeded with 0 emits
 * zeros forever (0 is its fixed point), which would make the keystream an
 * identity transform and pass the gzip magic through in the clear. The constant
 * is the golden-ratio scramble (2^32 / φ), a conventional non-zero seed.
 */
const STRIX_KEYSTREAM_SEED_FALLBACK = 0x9e3779b9

/** User-honest message for a damaged file that failed the integrity check. */
export const STRIX_CORRUPT_MESSAGE =
  'This StrixGeo project file is damaged and could not be read — its contents ' +
  'failed the integrity check (the stored checksum does not match). The file ' +
  'was most likely corrupted on disk. Re-save it from a build that still has ' +
  'the project open, or restore an earlier copy.'

/** User-honest message for a file that ends before its contents were written. */
export const STRIX_TRUNCATED_MESSAGE =
  'This StrixGeo project file is incomplete — it ends before its full contents ' +
  'were written (the file is truncated). It may be a partial or interrupted ' +
  'save. Re-save it from a build that still has the project open, or restore an ' +
  'earlier copy.'

/** User-honest message for a file written by a newer, unreadable build. */
export const STRIX_UNKNOWN_FORMAT_MESSAGE =
  'This file was written by a newer version of StrixGeo and this build cannot ' +
  'read it. Update StrixGeo to the latest version and try again.'

/**
 * Base class for every typed decode failure.
 *
 * Carries a stable ``code`` so a caller can branch without matching on the
 * message text. Concrete subclasses set the code and a user-honest message.
 */
export abstract class StrixDecodeError extends Error {
  /** Stable machine-readable discriminator (``'strix-corrupt'`` …). */
  abstract readonly code: string
}

/** The decoded bytes failed their integrity check — the file is damaged. */
export class StrixCorruptError extends StrixDecodeError {
  readonly code = 'strix-corrupt'

  /**
   * @param cause - Optional underlying error (e.g. a gunzip failure) kept for
   *   the log; never shown to the user.
   */
  constructor(cause?: unknown) {
    super(STRIX_CORRUPT_MESSAGE, cause === undefined ? undefined : { cause })
    this.name = 'StrixCorruptError'
  }
}

/** The file is shorter than the container it claims to be — a partial write. */
export class StrixTruncatedError extends StrixDecodeError {
  readonly code = 'strix-truncated'

  constructor() {
    super(STRIX_TRUNCATED_MESSAGE)
    this.name = 'StrixTruncatedError'
  }
}

/** The file is a StrixGeo container from a newer, unreadable version. */
export class StrixUnknownFormatError extends StrixDecodeError {
  readonly code = 'strix-unknown-format'

  constructor() {
    super(STRIX_UNKNOWN_FORMAT_MESSAGE)
    this.name = 'StrixUnknownFormatError'
  }
}

/**
 * A decode failure flattened for transport across the Electron IPC boundary.
 *
 * A thrown ``StrixDecodeError`` does NOT survive ``ipcRenderer.invoke`` with its
 * class or ``code`` intact — only the message text crosses, wrapped. So the
 * ``project:read-file`` handler catches the typed error and returns this plain
 * object instead of throwing, letting the renderer branch on ``code`` (never on
 * message text) and show the specific, user-honest ``message`` — which matters
 * on this machine, whose RAM corruption once scrambled a ``.strix`` mid-save.
 */
export interface StrixReadFailure {
  /** Stable discriminator: the failing error's {@link StrixDecodeError.code}. */
  code: string
  /** The user-honest message (one of the ``STRIX_*_MESSAGE`` constants). */
  message: string
}

/**
 * The discriminated result of reading a project file across the IPC boundary.
 *
 * Success carries the plaintext JSON (feed to ``parseProjectFile``); failure
 * carries a {@link StrixReadFailure}. Path-authorisation refusals and I/O
 * errors still THROW — those are exceptional (a renderer bug or a vanished
 * file), not a "this file is unreadable" answer the user needs worded.
 */
export type ProjectReadResult =
  | { ok: true; json: string }
  | { ok: false; reason: StrixReadFailure }

/**
 * Flatten a caught decode error into a {@link StrixReadFailure}, or rethrow.
 *
 * Only a {@link StrixDecodeError} becomes a failure reason; anything else
 * (an unexpected bug) propagates so it is not silently swallowed.
 *
 * @param err - The error caught around {@link decodeStrix}.
 * @returns The flattened, transportable failure reason.
 */
export function toStrixReadFailure(err: unknown): StrixReadFailure {
  if (err instanceof StrixDecodeError) {
    return { code: err.code, message: err.message }
  }
  throw err
}

/**
 * Generate ``length`` keystream bytes from a 32-bit ``seed``.
 *
 * A tiny, fully documented PRNG — xorshift32 (Marsaglia 2003, shift triple
 * 13/17/5) stepped once per byte, with the output byte taken as the XOR-fold of
 * the four state bytes so no single byte lane leaks and a small seed still
 * yields a non-zero first byte. Pure integer maths, kept inside uint32 with
 * ``>>> 0`` after every step. This is the keystream for an add-mod-256
 * transform, not a CSPRNG — its only jobs are determinism and reversibility.
 *
 * @param seed - The header seed (any uint32; 0 falls back to a fixed constant).
 * @param length - Number of keystream bytes to produce.
 * @returns A ``Uint8Array`` of ``length`` keystream bytes.
 */
export function strixKeystream(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed >>> 0
  if (x === 0) x = STRIX_KEYSTREAM_SEED_FALLBACK
  for (let i = 0; i < length; i++) {
    // xorshift32 step — all operations forced back into uint32.
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x >>>= 0
    x ^= x << 5
    x >>>= 0
    // XOR-fold the four state bytes into one output byte.
    out[i] = (x ^ (x >>> 8) ^ (x >>> 16) ^ (x >>> 24)) & 0xff
  }
  return out
}

/**
 * Apply the additive keystream to a buffer.
 *
 * ``sign = +1`` enciphers (encode), ``sign = -1`` deciphers (decode). The
 * transform is add/subtract mod 256 against {@link strixKeystream}, so it is
 * its own inverse with the sign flipped and never depends on the data bytes.
 *
 * @param data - The bytes to transform.
 * @param seed - The keystream seed (same value on encode and decode).
 * @param sign - ``+1`` to add the keystream, ``-1`` to subtract it.
 * @returns A new buffer of the transformed bytes.
 */
function applyKeystream(data: Uint8Array, seed: number, sign: 1 | -1): Buffer {
  const key = strixKeystream(seed, data.length)
  const out = Buffer.allocUnsafe(data.length)
  for (let i = 0; i < data.length; i++) {
    // ``+ 0x100`` keeps the intermediate non-negative before the mask so the
    // subtract path never relies on JS two's-complement ``&`` on a negative.
    out[i] = (data[i] + sign * key[i] + 0x100) & 0xff
  }
  return out
}

/**
 * Encode a plaintext JSON string into a binary ``.strix`` container.
 *
 * The ``json`` is exactly what today's writer produces (``serialiseProjectFile``
 * output); this function only wraps it. A fresh random seed is drawn per call
 * unless one is supplied, so two saves of identical content differ byte-wise on
 * disk yet both decode to the same JSON.
 *
 * @param json - The plaintext project JSON to store.
 * @param seed - Optional explicit 32-bit seed (for deterministic tests); a
 *   cryptographically-random seed is drawn when omitted.
 * @returns The binary container as a ``Buffer``, ready to write to disk.
 */
export function encodeStrix(json: string, seed?: number): Buffer {
  const plaintext = Buffer.from(json, 'utf-8')
  const checksum = crc32(plaintext) >>> 0
  const compressed = gzipSync(plaintext)
  const resolvedSeed = (seed ?? randomBytes(4).readUInt32LE(0)) >>> 0

  const header = Buffer.allocUnsafe(STRIX_HEADER_SIZE)
  STRIX_MAGIC.copy(header, 0)
  header[OFFSET_VERSION] = STRIX_CODEC_VERSION
  header.writeUInt32LE(resolvedSeed, OFFSET_SEED)
  header.writeUInt32LE(checksum, OFFSET_CRC)
  header.writeUInt32LE(plaintext.length, OFFSET_PLAINTEXT_LEN)

  const payload = applyKeystream(compressed, resolvedSeed, 1)
  return Buffer.concat([header, payload])
}

/**
 * Is this the leading brace of a legacy plain-JSON file (after optional
 * leading whitespace)? The pre-codec ``.strix`` / ``.gmproj`` files are
 * pretty-printed JSON, so their first non-whitespace byte is ``{``.
 *
 * PRE-EXISTING BOM LIMITATION (unchanged by this codec): a UTF-8 BOM (EF BB BF)
 * ahead of the ``{`` is NOT treated as whitespace, so a BOM-prefixed legacy
 * file misses this sniff and falls to the unknown-format path. That is not a
 * regression — the old reader ran the bytes straight through ``JSON.parse``,
 * which itself rejects a leading BOM, so a BOM'd file never opened either way.
 * This codec only changes WHICH typed error the caller sees, not whether the
 * file opens. StrixGeo's own writer never emits a BOM.
 */
function looksLikeLegacyJson(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    // ASCII whitespace: space, tab, LF, CR.
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue
    return b === 0x7b // '{'
  }
  return false // all-whitespace / empty is not legacy JSON
}

/** Does ``bytes`` begin with the given prefix? */
function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false
  }
  return true
}

/**
 * Decode a ``.strix`` file back to its plaintext JSON string.
 *
 * SNIFFS the input:
 *   - Legacy plain JSON (leading ``{``) → returned verbatim, forever.
 *   - ``STRIXB1`` magic + this codec version → reversed, decompressed, and
 *     integrity-checked against the header CRC.
 *   - Anything else → a typed {@link StrixDecodeError}.
 *
 * @param bytes - The raw file bytes (a Node ``Buffer`` from ``readFileSync``,
 *   or any ``Uint8Array``).
 * @param options - Optional decode limits.
 * @param options.maxPlaintextBytes - Hard ceiling on the DECOMPRESSED size. A
 *   ``.strix`` is a portable file a colleague can hand you, so a maliciously
 *   crafted one is a decompression-bomb (OOM) vector: a few KB on disk can
 *   inflate to gigabytes. Passing the read cap here makes gunzip refuse to
 *   allocate past it; the resulting ``RangeError`` is caught as a
 *   {@link StrixCorruptError} like any other unreadable payload. Omit for no
 *   ceiling (the unit tests exercise both).
 * @returns The plaintext JSON string (feed straight into ``parseProjectFile``).
 * @throws StrixTruncatedError When a binary file ends inside its header.
 * @throws StrixUnknownFormatError When the magic / version is newer than this
 *   build, or the input is neither legacy JSON nor a StrixGeo container.
 * @throws StrixCorruptError When the payload fails to decompress (including a
 *   decompression-bomb refusal) or its CRC / length does not match the header —
 *   i.e. the file is damaged or hostile.
 */
export function decodeStrix(
  bytes: Uint8Array,
  options?: { maxPlaintextBytes?: number },
): string {
  // 1. Legacy plain JSON — the path that must never break.
  if (looksLikeLegacyJson(bytes)) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf-8')
  }

  // 2. Not legacy JSON and not our exact magic. A ``STRIXB2``/future-magic file
  //    is a newer container; junk, a corrupted magic, or a foreign file is
  //    unreadable here too — and the honest message is the same either way:
  //    this build cannot read it.
  if (!startsWith(bytes, STRIX_MAGIC)) {
    throw new StrixUnknownFormatError()
  }

  // 3. Our magic — but a short read cannot even carry the header.
  if (bytes.length < STRIX_HEADER_SIZE) {
    throw new StrixTruncatedError()
  }

  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // 4. A version byte past what we know = a newer codec of the same magic.
  if (buf[OFFSET_VERSION] !== STRIX_CODEC_VERSION) {
    throw new StrixUnknownFormatError()
  }

  const seed = buf.readUInt32LE(OFFSET_SEED)
  const expectedCrc = buf.readUInt32LE(OFFSET_CRC)
  const expectedLen = buf.readUInt32LE(OFFSET_PLAINTEXT_LEN)
  const payload = buf.subarray(STRIX_HEADER_SIZE)

  const compressed = applyKeystream(payload, seed, -1)

  let plaintext: Buffer
  try {
    // ``maxOutputLength`` caps decompression so a bomb throws instead of
    // exhausting memory; ``0`` would be a real ceiling, so only pass the option
    // when a positive ceiling was supplied.
    const gunzipOptions =
      options?.maxPlaintextBytes !== undefined
        ? { maxOutputLength: options.maxPlaintextBytes }
        : undefined
    plaintext = gunzipSync(compressed, gunzipOptions)
  } catch (err) {
    // A failed inflate means the deflate stream is damaged or truncated, OR the
    // decompressed size blew past ``maxOutputLength`` (a decompression bomb).
    // From the reader's side both are "this file is unreadable" — surface the
    // one typed corruption error rather than an unhandled RangeError.
    throw new StrixCorruptError(err)
  }

  // Integrity: the plaintext length and CRC must match what the writer stored.
  if (plaintext.length !== expectedLen || (crc32(plaintext) >>> 0) !== expectedCrc) {
    throw new StrixCorruptError()
  }

  return plaintext.toString('utf-8')
}
