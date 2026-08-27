import { describe, it, expect } from 'vitest'
import {
  generateSecret,
  loadOrCreateSecrets,
  SECRET_ALPHABET,
  type SecretsIo,
} from './installSecrets'

/**
 * Deterministic byte source that, like a real RNG, never repeats itself: the
 * counter carries across calls, so two secrets drawn in one launch differ.
 */
function makeCountingBytes(): (n: number) => Uint8Array {
  let next = 0
  return (n: number) => Uint8Array.from({ length: n }, () => next++ % 256)
}

const countingBytes = makeCountingBytes()

/** In-memory SecretsIo over a single mutable slot. */
function fakeIo(initial: string | null = null): SecretsIo & { content: string | null } {
  const state = { content: initial }
  return {
    get content() {
      return state.content
    },
    read: () => state.content,
    write: (text: string) => {
      state.content = text
    },
  }
}

const PATH = 'C:\\Users\\coworker\\AppData\\Roaming\\StrixGeo\\pgcredentials.json'

describe('generateSecret', () => {
  it('produces the requested length', () => {
    expect(generateSecret(countingBytes, 32)).toHaveLength(32)
  })

  // Every character must survive both a URL and a Postgres password file
  // unescaped. Restricting the alphabet is belt to the percent-encoding's
  // braces — a generated quote or backslash is the kind of thing that works
  // on nine installs and corrupts the tenth.
  it('only emits characters that are safe in a URL and a password file', () => {
    const secret = generateSecret(countingBytes, 64)

    for (const ch of secret) {
      expect(SECRET_ALPHABET).toContain(ch)
    }
  })

  it('draws entropy from the injected source rather than a fixed seed', () => {
    const a = generateSecret(() => Uint8Array.from([0, 0, 0, 0]), 4)
    const b = generateSecret(() => Uint8Array.from([1, 1, 1, 1]), 4)

    expect(a).not.toBe(b)
  })
})

describe('loadOrCreateSecrets', () => {
  it('generates and persists secrets on the very first launch', () => {
    const io = fakeIo(null)

    const created = loadOrCreateSecrets(io, PATH, countingBytes)

    expect(created.password).toHaveLength(32)
    expect(io.content).not.toBeNull()
    expect(JSON.parse(io.content as string).password).toBe(created.password)
  })

  // A packaged build runs with ENVIRONMENT=production, under which the backend
  // refuses to start on the shipped default SECRET_KEY. Without this the app
  // cannot boot at all once packaged.
  it('generates a backend SECRET_KEY alongside the database password', () => {
    const io = fakeIo(null)

    const created = loadOrCreateSecrets(io, PATH, countingBytes)

    expect(created.secretKey).toHaveLength(32)
    expect(created.secretKey).not.toBe(created.password)
  })

  it('reuses the stored secrets on every later launch', () => {
    const io = fakeIo(null)

    const first = loadOrCreateSecrets(io, PATH, countingBytes)
    const second = loadOrCreateSecrets(io, PATH, countingBytes)

    expect(second.password).toBe(first.password)
    expect(second.secretKey).toBe(first.secretKey)
    expect(second.user).toBe(first.user)
  })

  // The password is baked into the cluster and cannot be re-derived; the key
  // is not used by anything yet. So a file carrying one but not the other is
  // completed in place rather than treated as a dead install.
  it('tops up a missing SECRET_KEY and writes it back', () => {
    const io = fakeIo(JSON.stringify({ user: 'strixgeo', password: 'kept', database: 'groundmodel' }))

    const secrets = loadOrCreateSecrets(io, PATH, countingBytes)

    expect(secrets.password).toBe('kept')
    expect(secrets.secretKey).toHaveLength(32)
    expect(JSON.parse(io.content as string).secretKey).toBe(secrets.secretKey)
  })

  // A cluster is initialised WITH the password. If the file is unreadable we
  // cannot re-derive it, and generating a fresh one would leave the app unable
  // to open a data directory that is otherwise perfectly intact. Failing
  // loudly keeps the recovery (delete pgdata, reopen the .strix) a decision
  // someone makes rather than one silently made for them.
  it('refuses to invent a new password over an unreadable secrets file', () => {
    const io = fakeIo('{ this is not json')

    expect(() => loadOrCreateSecrets(io, PATH, countingBytes)).toThrow(/could not be read/i)
  })

  it('refuses a secrets file that parses but carries no password', () => {
    const io = fakeIo('{"user":"strixgeo"}')

    expect(() => loadOrCreateSecrets(io, PATH, countingBytes)).toThrow(/could not be read/i)
  })

  it('names the file in the failure so the user can find it', () => {
    const io = fakeIo('{ this is not json')

    expect(() => loadOrCreateSecrets(io, PATH, countingBytes)).toThrow(PATH)
  })
})
