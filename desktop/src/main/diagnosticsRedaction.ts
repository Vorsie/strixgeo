/**
 * Redaction pass for locally captured diagnostics (Electron main process).
 *
 * A crash report may say **what** broke. It must not say **who** the engineer
 * is or **which site** they were working on — those are the two things a
 * geotech consultancy cannot let leave the building, and the reason a
 * "just ship us the log" support flow is normally refused by their IT.
 *
 * The pass is deliberately mechanical: a fixed, ordered list of patterns, each
 * one testable on its own (``diagnosticsRedaction.test.ts``). It is a
 * *defence in depth* layer, not the primary control — the primary control is
 * that {@link normaliseDiagnosticEvent} builds every captured record from a
 * **field whitelist**, so nothing reaches this function unless a capture site
 * deliberately put it there.
 *
 * ## What comes out
 *
 * | Pattern | Becomes | Why |
 * |---|---|---|
 * | Database connection string | ``<dsn>`` | Carries the backend password |
 * | ``file://`` URL | ``<file-url>`` | Carries the full project path |
 * | Windows / POSIX path to a data file | ``<path:.strix>`` | Project + client names live in these |
 * | Windows / POSIX path to a code file | user name replaced, rest kept | Stack frames must stay readable |
 * | Home-directory user name | ``<user>`` | Identifies the person |
 * | Email address | ``<email>`` | Identifies the person |
 * | Routable IPv4 (not ``127.0.0.1``) | ``<ip>`` | Identifies the network |
 * | URL query string | ``?<query>`` | Carries names and ids as parameters |
 * | Coordinate pair (≥4 integer digits) | ``<coords>`` | Identifies the site |
 *
 * {@link redactMessage} adds ONE more rule on top, for the ``message`` field
 * only (a stack frame quotes nothing): any quoted string literal —
 * ``"Boom Clay"`` / ``'Kanaal Noord'`` / `` `kb-4711` `` — has its content
 * replaced with ``<redacted>`` (a DOV open-data URL inside quotes is kept), so
 * a formation / project / borehole name an error interpolates never survives.
 *
 * ## What deliberately stays
 *
 * * **UUIDs.** They carry no name, path or measurement, and they are the only
 *   way to answer "which record was it?" in a follow-up question. Flagged for
 *   the owner as a decision, not an oversight — if it is ruled out, one rule
 *   here removes them.
 * * **Routes, HTTP statuses, module paths, line numbers, error types.** These
 *   are the report.
 * * **``127.0.0.1``** — our own backend, not a network fact about the user.
 */

/**
 * Maximum length of any single redacted string.
 *
 * Two kilobytes holds a full stack trace of ~25 frames. Beyond that a captured
 * message is either a pathological loop or a payload dump, and neither belongs
 * in a support bundle.
 */
export const REDACTED_TEXT_CAP = 2000

/** Marker appended when {@link redactText} truncates. */
export const TRUNCATION_MARKER = ' …[truncated]'

/**
 * Basename extensions treated as *code*.
 *
 * A path ending in one of these is part of a stack frame: its directory
 * structure is our own build layout and carries no user data, so only the user
 * name is stripped. Everything else is treated as a document the user chose the
 * location and the name of.
 */
const CODE_EXTENSIONS = new Set([
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'asar',
  'node',
  'exe',
  'dll',
  'html',
])

// A path SEGMENT can contain spaces ("OneDrive - Acme NV", "Two Words", a
// "First Last" user folder), so the body allows a literal space and stops only
// on a *real* delimiter — a quote, a pipe, an angle bracket, a bracket/paren (a
// V8 stack frame wraps the path in parens; swallowing the closer would break
// the extension read below), or any whitespace OTHER than a plain space
// (newline, tab, form-feed: a filesystem path never spans a line, and neither
// Windows nor a sane POSIX path holds a tab). Stopping at the first space —
// the previous behaviour — left everything after it (the employer, the client,
// the site, the engineer's surname) verbatim in a "redacted" bundle.
//
// The body is required to END on a non-space (``TAIL``) so trailing whitespace
// is trimmed: a path that abuts following prose ("…x.gef (row 42)") keeps the
// separator instead of eating it. The whole body is optional so a bare root
// (``C:\``) or an empty ``file://`` still matches, exactly as before.
const PATH_INNER = '[^\\r\\n\\t\\f\\v"\'<>|()\\[\\]]'
const PATH_TAIL = '[^\\s"\'<>|()\\[\\]]'
const PATH_BODY = `(?:${PATH_INNER}*${PATH_TAIL})?`

const FILE_URL_RE = new RegExp(`file://${PATH_BODY}`, 'gi')
const WINDOWS_PATH_RE = new RegExp(`[A-Za-z]:\\\\${PATH_BODY}`, 'g')
// Anchored to real filesystem roots so an API route (``/cpt/import``) is never
// mistaken for a path — routes are the most useful thing in an api diagnostic.
const POSIX_PATH_RE = new RegExp(`/(?:Users|home|var|tmp|opt|private|Applications)/${PATH_BODY}`, 'g')
// The user-folder name is a single segment and can contain a space
// ("First Last"), so it stops at the next path separator or a real delimiter —
// NOT at the first space, which used to leave the surname behind. It excludes
// ``<>`` so an already-substituted ``<user>`` is never re-matched.
const WINDOWS_USER_RE = /([A-Za-z]:\\Users\\)[^\\/\r\n\t\f\v"'<>|()[\]]+/g
const POSIX_USER_RE = /(\/(?:Users|home)\/)[^/\r\n\t\f\v"'<>|()[\]]+/g
const URL_QUERY_RE = /(https?:\/\/[^\s"'<>|?]*)\?[^\s"'<>|]*/g
// Hosts whose URLs are PUBLIC OPEN DATA and therefore exempt from the query
// strip above (owner ruling 2026-08-28, verbatim: "all data from dov doesnt
// need any redaction whatsoever").
//
// A DOV request carries its entire diagnostic value in the query string — the
// layer, the bbox, the permkey — so scrubbing it costs every DOV import
// diagnosis while protecting nothing: the records it names are published by
// the Flemish government and readable by anyone. The exemption is keyed on the
// HOST, not on the word "dov" appearing anywhere, so a client project called
// "DOV-Antwerpen" is still redacted normally.
const OPEN_DATA_HOSTS = ['dov.vlaanderen.be']

/** Is this URL's host one whose data is public and needs no redaction? */
function isOpenDataUrl(url: string): boolean {
  const host = url.replace(/^https?:\/\//i, '').split(/[/?#]/, 1)[0].toLowerCase()
  return OPEN_DATA_HOSTS.some(open => host === open || host.endsWith(`.${open}`))
}
// The backend prints its own DSN — password included — on startup, and the
// crash bundle carries backend.log. Matched by scheme so a future driver
// (psycopg, asyncpg) is covered without a new rule.
const DSN_RE = /\b(?:postgres|postgresql|postgresql\+asyncpg|asyncpg|mysql|mongodb)(?:\+\w+)?:\/\/\S*/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g
// Loopback is excluded: it is our own backend, not a fact about the user's
// network. The lookahead is on the whole literal so ``127.0.0.10`` still goes.
const IPV4_RE = /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g
// Four or more integer digits with a decimal part, twice, comma-separated —
// the shape of a projected coordinate (Lambert 72 easting/northing, RD, UTM).
const COORDINATE_PAIR_RE = /-?\d{4,7}\.\d+\s*,\s*-?\d{4,7}\.\d+/g
// Last dotted extension in a basename, allowing a V8 ``:line:col`` suffix.
const EXTENSION_RE = /\.([A-Za-z0-9]{1,8})(?![A-Za-z0-9])/g

// Quoted string literals inside a MESSAGE carry the names this redaction
// exists to remove — an interpreter error names the formation "Boom Clay", the
// project 'Kanaal Noord', the borehole `kb-4711` it failed on, in quotes.
// redactText alone leaves those, so a message gets this extra pass. Stack
// frames don't quote user data, so they keep using redactText alone.
//
// A single-quote pair is only treated as a literal when BOTH quotes sit on a
// word boundary; otherwise an English contraction ("couldn't", "it's") would
// be read as an opening quote and the whole message mangled. Double quotes and
// backticks have no such ambiguity, so they match any balanced pair.
const DOUBLE_QUOTED_RE = /"([^"\r\n]*)"/g
const BACKTICK_QUOTED_RE = /`([^`\r\n]*)`/g
const SINGLE_QUOTED_RE = /(^|[^A-Za-z0-9])'([^'\r\n]*)'(?=[^A-Za-z0-9]|$)/g

/** Lower-cased final extension of a path, or ``null`` when it has none. */
function finalExtension(path: string): string | null {
  const separator = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  const basename = separator >= 0 ? path.slice(separator + 1) : path
  const matches = basename.match(EXTENSION_RE)
  if (!matches || matches.length === 0) return null
  return matches[matches.length - 1].slice(1).toLowerCase()
}

/**
 * Replace one matched path — keeping code paths readable, erasing data paths.
 *
 * Kept as a named helper rather than an inline arrow because both the Windows
 * and the POSIX rule need exactly this decision.
 */
function replacePath(match: string): string {
  const extension = finalExtension(match)
  if (extension !== null && CODE_EXTENSIONS.has(extension)) {
    // A stack frame. Strip the user name; keep the module structure — the
    // directory layout is our own build output, not the user's filing.
    return match.replace(WINDOWS_USER_RE, '$1<user>').replace(POSIX_USER_RE, '$1<user>')
  }
  return extension === null ? '<path>' : `<path:.${extension}>`
}

/**
 * Redact a free-text string captured from a crash or an error.
 *
 * Parameters
 * ----------
 * text : string
 *     The raw message or stack trace. A non-string (an object a capture site
 *     passed by mistake) yields an empty string rather than
 *     ``"[object Object]"`` — an unreadable value is not worth the risk of it
 *     having been a payload.
 *
 * Returns
 * -------
 * string
 *     The redacted, length-capped text.
 */
export function redactText(text: unknown): string {
  if (typeof text !== 'string') return ''
  if (text === '') return ''

  let out = text
    .replace(DSN_RE, '<dsn>')
    .replace(FILE_URL_RE, '<file-url>')
    .replace(WINDOWS_PATH_RE, replacePath)
    .replace(POSIX_PATH_RE, replacePath)
    .replace(URL_QUERY_RE, (whole, base: string) =>
      isOpenDataUrl(base) ? whole : `${base}?<query>`,
    )
    .replace(EMAIL_RE, '<email>')
    .replace(IPV4_RE, '<ip>')
    .replace(COORDINATE_PAIR_RE, '<coords>')

  // A home-directory name can also appear outside a path-shaped token (a
  // message that interpolated it), so the user rules run again on the whole
  // string rather than only inside ``replacePath``.
  out = out.replace(WINDOWS_USER_RE, '$1<user>').replace(POSIX_USER_RE, '$1<user>')

  if (out.length > REDACTED_TEXT_CAP) {
    out = out.slice(0, REDACTED_TEXT_CAP) + TRUNCATION_MARKER
  }
  return out
}

/**
 * Replace one quoted literal's content — keeping the quote characters so the
 * report still shows a name WAS there, and preserving an open-data (DOV) URL
 * verbatim (owner ruling 2026-08-28: DOV data needs no redaction).
 */
function redactQuoted(open: string, close: string, inner: string): string {
  if (isOpenDataUrl(inner.trim())) return `${open}${inner}${close}`
  return `${open}<redacted>${close}`
}

/** Redact every quoted string literal in one pass (double, backtick, single). */
function redactQuotedLiterals(text: string): string {
  return text
    .replace(DOUBLE_QUOTED_RE, (_m, inner: string) => redactQuoted('"', '"', inner))
    .replace(BACKTICK_QUOTED_RE, (_m, inner: string) => redactQuoted('`', '`', inner))
    .replace(
      SINGLE_QUOTED_RE,
      (_m, lead: string, inner: string) => `${lead}${redactQuoted("'", "'", inner)}`,
    )
}

/**
 * Redact a free-text crash/error MESSAGE.
 *
 * The message-only superset of {@link redactText}: it first strips quoted
 * string literals (which carry formation / project / borehole names an error
 * interpolates), then applies the full {@link redactText} pass. Stack frames do
 * not quote user data, so they stay on {@link redactText} alone.
 *
 * Parameters
 * ----------
 * text : unknown
 *     The raw message. A non-string yields ``''`` (same contract as
 *     {@link redactText}).
 *
 * Returns
 * -------
 * string
 *     The redacted, length-capped message.
 */
export function redactMessage(text: unknown): string {
  if (typeof text !== 'string') return ''
  if (text === '') return ''
  return redactText(redactQuotedLiterals(text))
}
