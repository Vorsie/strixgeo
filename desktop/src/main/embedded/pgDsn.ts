/**
 * Connection-string construction for the embedded database.
 *
 * Two dialects are needed and they are NOT interchangeable: SQLAlchemy wants
 * the ``+asyncpg`` driver marker, libpq tools (``pg_isready``, ``psql``) reject
 * it. Both are built here so the encoding rules cannot drift apart.
 *
 * @module main/embedded/pgDsn
 */

/** Everything needed to reach one database. */
export interface PgConnection {
  host: string
  port: number
  user: string
  password: string
  database: string
}

/**
 * Render the authority + path portion shared by both dialects.
 *
 * The user and password are percent-encoded because the password is generated
 * per install: an unencoded ``@`` would end the userinfo early and point the
 * backend at a host nobody configured.
 */
function authority({ host, port, user, password, database }: PgConnection): string {
  return (
    `${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${database}`
  )
}

/**
 * Build the URL the backend reads from ``DATABASE_URL``.
 *
 * @param connection - Host, port, credentials and database name.
 * @returns A ``postgresql+asyncpg://`` URL.
 */
export function buildSqlAlchemyDsn(connection: PgConnection): string {
  return `postgresql+asyncpg://${authority(connection)}`
}

/**
 * Build the URL libpq command-line tools accept.
 *
 * @param connection - Host, port, credentials and database name.
 * @returns A ``postgresql://`` URL with no driver marker.
 */
export function buildLibpqUri(connection: PgConnection): string {
  return `postgresql://${authority(connection)}`
}

/**
 * Replace the password in any Postgres URL appearing in the text.
 *
 * Applied to everything that can reach a dialog or the log. The failure
 * messages shown to a user are assembled from a child process's stderr, and
 * SQLAlchemy's URL-parse errors quote the whole DSN — password included — so
 * without this the only thing standing between the generated password and an
 * on-screen dialog is the fact that today's alphabet happens never to produce
 * an unparseable URL. That is a coincidence, not a guard.
 *
 * @param text - Arbitrary text that may embed one or more DSNs.
 * @returns The same text with every ``user:password@`` reduced to
 *   ``user:***@``.
 */
export function redactPasswords(text: string): string {
  return text.replace(/(postgresql(?:\+\w+)?:\/\/[^:/@\s]+:)[^@\s]*@/gi, '$1***@')
}
