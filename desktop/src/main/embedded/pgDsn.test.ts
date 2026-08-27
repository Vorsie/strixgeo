import { describe, it, expect } from 'vitest'
import { buildSqlAlchemyDsn, buildLibpqUri, redactPasswords } from './pgDsn'

const BASE = {
  host: '127.0.0.1',
  port: 54121,
  user: 'strixgeo',
  password: 'plainpassword',
  database: 'groundmodel',
}

describe('buildSqlAlchemyDsn', () => {
  it('builds the asyncpg URL the backend reads from DATABASE_URL', () => {
    expect(buildSqlAlchemyDsn(BASE)).toBe(
      'postgresql+asyncpg://strixgeo:plainpassword@127.0.0.1:54121/groundmodel',
    )
  })

  // The password is generated per install. If a generated character is left
  // raw, the URL silently reparses: a '@' cuts the host short, a '/' cuts the
  // database name, and the backend fails to connect with an error that names
  // a host nobody configured.
  it('percent-encodes a password containing URL-significant characters', () => {
    const dsn = buildSqlAlchemyDsn({ ...BASE, password: 'a@b/c:d#e?f%g' })

    expect(dsn).toBe(
      'postgresql+asyncpg://strixgeo:a%40b%2Fc%3Ad%23e%3Ff%25g@127.0.0.1:54121/groundmodel',
    )
  })

  it('survives a round-trip through the URL parser with the password intact', () => {
    const password = 'a@b/c:d#e?f%g'
    const parsed = new URL(
      buildSqlAlchemyDsn({ ...BASE, password }).replace('postgresql+asyncpg:', 'postgresql:'),
    )

    expect(decodeURIComponent(parsed.password)).toBe(password)
    expect(parsed.hostname).toBe('127.0.0.1')
    expect(parsed.port).toBe('54121')
    expect(parsed.pathname).toBe('/groundmodel')
  })

  it('percent-encodes the user as well', () => {
    expect(buildSqlAlchemyDsn({ ...BASE, user: 'a b' })).toContain('a%20b:')
  })
})

describe('buildLibpqUri', () => {
  // pg_isready / psql speak libpq, which does not understand the SQLAlchemy
  // '+driver' marker — passing the asyncpg URL to them fails to parse.
  it('omits the SQLAlchemy driver marker', () => {
    expect(buildLibpqUri(BASE)).toBe(
      'postgresql://strixgeo:plainpassword@127.0.0.1:54121/groundmodel',
    )
  })

  it('encodes the password the same way', () => {
    expect(buildLibpqUri({ ...BASE, password: 'p@ss' })).toContain('p%40ss')
  })
})

describe('redactPasswords', () => {
  // The text this runs over is a child process's stderr on its way to a
  // native error dialog. SQLAlchemy's URL-parse error quotes the whole DSN.
  it('removes the password from a DSN embedded in an error message', () => {
    const message =
      "ArgumentError: Could not parse SQLAlchemy URL from string " +
      "'postgresql+asyncpg://strixgeo:hunter2secret@127.0.0.1:54121/groundmodel'"

    const redacted = redactPasswords(message)

    expect(redacted).not.toContain('hunter2secret')
    expect(redacted).toContain('strixgeo:***@127.0.0.1:54121/groundmodel')
  })

  it('redacts the driverless libpq form too', () => {
    expect(redactPasswords('postgresql://strixgeo:abc123@127.0.0.1:5432/db')).toBe(
      'postgresql://strixgeo:***@127.0.0.1:5432/db',
    )
  })

  it('redacts every occurrence, not just the first', () => {
    const two =
      'postgresql://u:aaa@h:1/d and postgresql+asyncpg://u:bbb@h:2/d'

    const redacted = redactPasswords(two)

    expect(redacted).not.toContain('aaa')
    expect(redacted).not.toContain('bbb')
  })

  it('leaves text without a DSN untouched', () => {
    expect(redactPasswords('initdb exited with code 1')).toBe('initdb exited with code 1')
  })

  it('does not mangle a URL that carries no password', () => {
    expect(redactPasswords('postgresql://127.0.0.1:5432/db')).toBe(
      'postgresql://127.0.0.1:5432/db',
    )
  })
})
