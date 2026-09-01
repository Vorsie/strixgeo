// Red-first pins for the .strix binary container codec (owner directive
// 2026-09-01: "an encoder ... to binary for strix files and ofcourse a
// decoder. keep it simple, a base 15 rotator seems good enough").
//
// The codec is opacity, NOT cryptography: gzip + a seeded add-mod-256
// keystream inside a versioned binary container. Every pin below is phrased
// against the observable contract (round-trips, sniffs legacy JSON, detects
// corruption LOUDLY), not the internals.

import { describe, expect, it } from 'vitest'
import { gzipSync } from 'zlib'
import {
  STRIX_CODEC_VERSION,
  STRIX_CORRUPT_MESSAGE,
  STRIX_HEADER_SIZE,
  STRIX_MAGIC,
  STRIX_TRUNCATED_MESSAGE,
  STRIX_UNKNOWN_FORMAT_MESSAGE,
  StrixCorruptError,
  StrixDecodeError,
  StrixTruncatedError,
  StrixUnknownFormatError,
  decodeStrix,
  encodeStrix,
  strixKeystream,
  toStrixReadFailure,
} from './strixCodec'

// A realistic .strix payload: the exact shape today's writer produces
// (serialiseProjectFile → JSON.stringify(payload, null, 2) + '\n').
const SAMPLE_JSON =
  JSON.stringify(
    {
      format_version: 3,
      project: { id: 'p-1', name: 'Sité Ω — boring 12', status: 'active' },
      cpts: [{ id: 'c1', depths: [0, 0.02, 0.04], qc: [1.1, 2.2, 3.3] }],
      boreholes: [],
      geological_formations: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
      litho_contact_correlation_edges: [],
      bodies: [],
      formation_absences: [],
      body_boundary_shapes: [],
      body_boundary_nodes: [],
      body_geometry_facts: [],
      geotech_tie_tombstones: [],
      body_separations: [],
      body_unions: [],
      stratigraphy_lumping: null,
    },
    null,
    2,
  ) + '\n'

describe('strixKeystream — the seeded byte keystream (fixed vectors)', () => {
  // Frozen golden vectors generated once from the documented algorithm
  // (xorshift32 stepped per byte, output = XOR-fold of the four state bytes).
  // These pin the algorithm so an accidental change to the PRNG constants or
  // the byte-extraction is caught immediately — a changed keystream would make
  // every previously-written .strix undecodable.
  it('produces the frozen vector for seed 12345', () => {
    expect(Array.from(strixKeystream(12345, 16))).toEqual([
      45, 233, 104, 81, 136, 11, 116, 186, 77, 179, 233, 149, 70, 157, 81, 212,
    ])
  })

  it('produces the frozen vector for seed 1', () => {
    expect(Array.from(strixKeystream(1, 16))).toEqual([
      5, 11, 60, 145, 177, 200, 190, 78, 164, 42, 55, 229, 205, 177, 105, 41,
    ])
  })

  it('falls back off a non-zero constant when seeded with 0 (xorshift traps at 0)', () => {
    // Seed 0 would lock a bare xorshift32 at all-zeros forever; the codec
    // substitutes a fixed non-zero constant so a 0 seed still yields a real
    // keystream rather than an identity transform.
    expect(Array.from(strixKeystream(0, 8))).toEqual([2, 165, 119, 159, 167, 149, 102, 85])
  })

  it('is deterministic for a given seed', () => {
    expect(Array.from(strixKeystream(0xdeadbeef, 64))).toEqual(
      Array.from(strixKeystream(0xdeadbeef, 64)),
    )
  })

  it('diverges for different seeds', () => {
    const a = Array.from(strixKeystream(1000, 64))
    const b = Array.from(strixKeystream(1001, 64))
    expect(a).not.toEqual(b)
  })

  it('never leaks a leading zero byte that would expose the gzip magic', () => {
    // The first payload bytes are gzip's 1f 8b magic; a zero keystream byte
    // there would pass them through unchanged. Check a spread of seeds.
    for (const seed of [1, 2, 3, 255, 65536, 0xdeadbeef]) {
      expect(strixKeystream(seed, 1)[0]).not.toBe(0)
    }
  })
})

describe('encodeStrix / decodeStrix — round trip', () => {
  it('round-trips a project JSON string byte-for-byte', () => {
    const encoded = encodeStrix(SAMPLE_JSON)
    const decoded = decodeStrix(encoded)
    expect(decoded).toBe(SAMPLE_JSON)
  })

  it('round-trips to a deep-equal parsed object', () => {
    const decoded = decodeStrix(encodeStrix(SAMPLE_JSON))
    expect(JSON.parse(decoded)).toEqual(JSON.parse(SAMPLE_JSON))
  })

  it('round-trips a large payload (~5 MB) with unicode', () => {
    const big = JSON.stringify({
      note: 'Ω'.repeat(1000),
      rows: Array.from({ length: 40000 }, (_, i) => ({ i, q: i * 0.01, s: 'zånd' })),
    })
    const decoded = decodeStrix(encodeStrix(big))
    expect(decoded).toBe(big)
  })

  it('round-trips an explicit fixed seed', () => {
    const encoded = encodeStrix(SAMPLE_JSON, 0x01020304)
    expect(decodeStrix(encoded)).toBe(SAMPLE_JSON)
  })

  it('compresses — the container is smaller than the plaintext for real data', () => {
    const encoded = encodeStrix(SAMPLE_JSON)
    expect(encoded.length).toBeLessThan(Buffer.byteLength(SAMPLE_JSON, 'utf-8'))
  })
})

describe('binary container layout', () => {
  it('starts with the STRIXB1 magic and the current codec version byte', () => {
    const encoded = encodeStrix(SAMPLE_JSON, 42)
    expect(encoded.subarray(0, 7).toString('latin1')).toBe('STRIXB1')
    expect(STRIX_MAGIC.toString('latin1')).toBe('STRIXB1')
    expect(encoded[7]).toBe(STRIX_CODEC_VERSION)
  })

  it('carries the seed and a payload past the fixed 20-byte header', () => {
    const encoded = encodeStrix(SAMPLE_JSON, 0x11223344)
    expect(STRIX_HEADER_SIZE).toBe(20)
    // Seed stored little-endian at offset 8.
    expect(encoded.readUInt32LE(8)).toBe(0x11223344)
    expect(encoded.length).toBeGreaterThan(STRIX_HEADER_SIZE)
  })
})

describe('legacy plain-JSON sniff — must open forever, unchanged', () => {
  it('returns a leading-brace JSON file verbatim', () => {
    const legacy = SAMPLE_JSON // starts with '{'
    expect(decodeStrix(Buffer.from(legacy, 'utf-8'))).toBe(legacy)
  })

  it('tolerates leading whitespace before the brace', () => {
    const legacy = '  \n\t{"format_version":3}\n'
    expect(decodeStrix(Buffer.from(legacy, 'utf-8'))).toBe(legacy)
  })

  it('does not confuse a legacy file for a binary one (no false STRIX magic)', () => {
    // A legacy file can never start with '{' AND the STRIX magic — the sniff is
    // unambiguous because '{' (0x7B) is not 'S' (0x53).
    const decoded = decodeStrix(Buffer.from('{"a":1}', 'utf-8'))
    expect(JSON.parse(decoded)).toEqual({ a: 1 })
  })
})

describe('corruption detection — must be LOUD and specific', () => {
  it('throws a typed corruption error when a payload byte is flipped', () => {
    const encoded = Buffer.from(encodeStrix(SAMPLE_JSON, 7))
    // Flip a byte in the middle of the ciphered payload.
    const mid = STRIX_HEADER_SIZE + Math.floor((encoded.length - STRIX_HEADER_SIZE) / 2)
    encoded[mid] = encoded[mid] ^ 0xff
    expect(() => decodeStrix(encoded)).toThrow(StrixCorruptError)
    try {
      decodeStrix(encoded)
    } catch (err) {
      expect(err).toBeInstanceOf(StrixDecodeError)
      expect((err as StrixCorruptError).message).toBe(STRIX_CORRUPT_MESSAGE)
      expect((err as StrixCorruptError).message).toMatch(/damaged|corrupt/i)
    }
  })

  it('throws the typed corruption error when the stored checksum is wrong', () => {
    // Corrupt only the CRC field (offset 12..15): gunzip still succeeds and the
    // plaintext is intact, so ONLY the header-checksum comparison can catch it.
    const encoded = Buffer.from(encodeStrix(SAMPLE_JSON, 9))
    encoded[12] = encoded[12] ^ 0xff
    expect(() => decodeStrix(encoded)).toThrow(StrixCorruptError)
    expect(() => decodeStrix(encoded)).toThrow(STRIX_CORRUPT_MESSAGE)
  })
})

describe('truncation detection', () => {
  it('throws a typed truncation error when the file is cut inside the header', () => {
    const encoded = encodeStrix(SAMPLE_JSON, 3)
    const cut = encoded.subarray(0, 10) // < STRIX_HEADER_SIZE
    expect(() => decodeStrix(cut)).toThrow(StrixTruncatedError)
    expect(() => decodeStrix(cut)).toThrow(STRIX_TRUNCATED_MESSAGE)
  })

  it('throws a typed decode error when the payload is cut short', () => {
    const encoded = encodeStrix(SAMPLE_JSON, 3)
    const cut = encoded.subarray(0, encoded.length - 25) // keep header, lose tail
    expect(() => decodeStrix(cut)).toThrow(StrixDecodeError)
  })
})

describe('unknown / future format', () => {
  it('rejects a future codec version byte with the newer-version message', () => {
    const encoded = Buffer.from(encodeStrix(SAMPLE_JSON, 5))
    encoded[7] = 99 // bump the version byte past what this build knows
    expect(() => decodeStrix(encoded)).toThrow(StrixUnknownFormatError)
    expect(() => decodeStrix(encoded)).toThrow(STRIX_UNKNOWN_FORMAT_MESSAGE)
  })

  it('rejects a future magic (STRIXB2 …) with the newer-version message', () => {
    const future = Buffer.concat([Buffer.from('STRIXB2', 'latin1'), Buffer.alloc(32)])
    expect(() => decodeStrix(future)).toThrow(StrixUnknownFormatError)
  })

  it('rejects an unrecognisable non-JSON, non-STRIX blob', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    expect(() => decodeStrix(junk)).toThrow(StrixUnknownFormatError)
  })

  it('rejects an empty file', () => {
    expect(() => decodeStrix(Buffer.alloc(0))).toThrow(StrixDecodeError)
  })
})

describe('seed variance — identical content, different bytes, both decode', () => {
  it('two saves of identical content differ byte-wise but both decode equal', () => {
    const a = encodeStrix(SAMPLE_JSON, 111)
    const b = encodeStrix(SAMPLE_JSON, 222)
    expect(Buffer.compare(a, b)).not.toBe(0)
    expect(decodeStrix(a)).toBe(SAMPLE_JSON)
    expect(decodeStrix(b)).toBe(SAMPLE_JSON)
  })

  it('the default (random) seed still yields a decodable file each time', () => {
    const first = encodeStrix(SAMPLE_JSON)
    const second = encodeStrix(SAMPLE_JSON)
    // Overwhelmingly likely to differ (random 32-bit seed); both must decode.
    expect(decodeStrix(first)).toBe(SAMPLE_JSON)
    expect(decodeStrix(second)).toBe(SAMPLE_JSON)
  })

  it('the ciphered payload is not raw gzip — the keystream masks the magic', () => {
    const encoded = encodeStrix(SAMPLE_JSON, 12345)
    const rawGzip = gzipSync(Buffer.from(SAMPLE_JSON, 'utf-8'))
    // The bytes just past the header must NOT equal the plain gzip magic.
    expect(encoded[STRIX_HEADER_SIZE]).not.toBe(rawGzip[0])
  })
})

describe('decompression-bomb guard', () => {
  it('refuses a payload that inflates past the ceiling — a typed corrupt error, not a raw RangeError', () => {
    // ~200 KB of plaintext gzips to a few hundred bytes; decoding it under a
    // 1 KB ceiling must be caught as the one typed corruption error, never
    // surface as an unhandled RangeError / ERR_BUFFER_TOO_LARGE.
    const large = JSON.stringify({ blob: 'A'.repeat(200_000) })
    const encoded = encodeStrix(large, 5)
    expect(() => decodeStrix(encoded, { maxPlaintextBytes: 1024 })).toThrow(StrixCorruptError)
  })

  it('decodes the same file cleanly when the ceiling admits it', () => {
    const large = JSON.stringify({ blob: 'A'.repeat(200_000) })
    const encoded = encodeStrix(large, 5)
    expect(decodeStrix(encoded, { maxPlaintextBytes: 10_000_000 })).toBe(large)
  })
})

describe('typed reason codes — the stable discriminators the IPC forwards', () => {
  // The renderer branches on ``code``, never on message text, so the codes are
  // part of the contract and pinned here.
  it('a corrupt file carries code strix-corrupt', () => {
    const encoded = Buffer.from(encodeStrix(SAMPLE_JSON, 1))
    encoded[12] = encoded[12] ^ 0xff // wreck the CRC field
    try {
      decodeStrix(encoded)
      throw new Error('expected a decode failure')
    } catch (err) {
      expect(err).toBeInstanceOf(StrixCorruptError)
      expect((err as StrixCorruptError).code).toBe('strix-corrupt')
    }
  })

  it('a header-truncated file carries code strix-truncated', () => {
    const cut = encodeStrix(SAMPLE_JSON, 1).subarray(0, 10)
    try {
      decodeStrix(cut)
      throw new Error('expected a decode failure')
    } catch (err) {
      expect((err as StrixTruncatedError).code).toBe('strix-truncated')
    }
  })

  it('a newer-format file carries code strix-unknown-format', () => {
    const future = Buffer.concat([Buffer.from('STRIXB2', 'latin1'), Buffer.alloc(32)])
    try {
      decodeStrix(future)
      throw new Error('expected a decode failure')
    } catch (err) {
      expect((err as StrixUnknownFormatError).code).toBe('strix-unknown-format')
    }
  })
})

describe('toStrixReadFailure — flattening for the IPC boundary', () => {
  it('flattens a StrixDecodeError into { code, message }', () => {
    const failure = toStrixReadFailure(new StrixCorruptError())
    expect(failure).toEqual({ code: 'strix-corrupt', message: STRIX_CORRUPT_MESSAGE })
  })

  it('rethrows a non-decode error rather than mislabelling it as corruption', () => {
    const bug = new TypeError('unexpected')
    expect(() => toStrixReadFailure(bug)).toThrow(bug)
  })
})
