/**
 * App-managed crash-recovery file store (Electron main process).
 *
 * A crash loses no *interpretation* — that lives in PostgreSQL. What it
 * loses is renderer-only session state: the stratigraphy lumping map, the
 * litho ghost workspace, an unsaved metadata draft, import manifests, the
 * dirty flag. This module is the storage layer an autosave will write that
 * state to; the autosave timer and the renderer wiring are a later phase.
 *
 * Layout — one file per project, in an app-owned directory:
 *
 *     <userData>/recovery/<projectId>.recovery.json
 *
 * The file is a small envelope (``kind`` / ``format_version`` / ids /
 * timestamps) wrapping an **opaque** ``payload``. This module never
 * interprets the payload: it round-trips it faithfully and the renderer
 * phase owns its inner shape.
 *
 * ## Security posture
 *
 * ``index.ts`` guards the *user-picked* file IPC with an authorised-path set
 * (``authorisePath`` / ``pathIsAuthorised``): a path becomes readable or
 * writable only after the user selected it in a native dialog. Recovery
 * paths are **app-managed and never user-picked**, so that mechanism does
 * not apply — and routing them through it would weaken it by adding paths
 * the user never consented to.
 *
 * The replacement guarantee is stricter: **no caller ever supplies a path.**
 * The only input is a ``projectId``, which must be a well-formed UUID before
 * it touches the filesystem; the path is then built here from the configured
 * userData directory. A traversal-shaped id is *refused*, never sanitised —
 * sanitising invites the "which of the six normalisations wins" class of bug.
 *
 * Every other renderer-supplied value gets the same treatment: the string
 * fields of {@link RecoveryWriteOptions} are type-checked before they reach
 * the envelope, because IPC arguments arrive as ``any`` at runtime whatever
 * the TypeScript signature claims.
 *
 * Two further hardening measures mirror what ``index.ts`` already does:
 *   * a size cap on both the read and the write path (cf.
 *     ``assertFileSizeUnder`` / ``PROJECT_READ_CAP_BYTES``) so a huge or
 *     corrupt file cannot be pulled into main-process memory — and so an
 *     oversized payload cannot be written at all, since that would produce a
 *     file the read path then refuses;
 *   * per-entry validation on list (cf. ``isValidRecentProjectEntry``) so a
 *     corrupt, foreign, or hand-edited file degrades to "skip this entry"
 *     instead of crashing the start screen.
 *
 * ## Why the userData directory is injected
 *
 * This module must not ``import 'electron'`` — vitest exercises the main
 * process helpers in jsdom (see ``vitest.config.ts``), and an Electron
 * import there fails to resolve. ``index.ts`` calls
 * ``configureRecoveryStore`` once at startup with ``app.getPath('userData')``
 * and ``app.getVersion()``; the tests point it at a temp directory.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs'
import { join } from 'path'

import { writeFileAtomic } from './atomicWrite'

/** Sub-directory of ``userData`` that holds every recovery file. */
export const RECOVERY_DIR_NAME = 'recovery'

/** Suffix every recovery file carries — the stem is the project UUID. */
export const RECOVERY_FILE_SUFFIX = '.recovery.json'

/**
 * Envelope discriminator. Files in the folder that do not carry exactly this
 * value are foreign (or a hand-copied ``.strix``) and are skipped.
 */
export const RECOVERY_KIND = 'strixgeo.recovery'

/**
 * Envelope schema version. Bump when the envelope fields change; files with
 * any other version are skipped as stale rather than best-effort parsed —
 * a half-understood recovery file is worse than no recovery offer at all.
 */
export const RECOVERY_FORMAT_VERSION = 1

/**
 * Ceiling on a recovery file, applied on **both** the read and the write
 * path (16 MiB).
 *
 * Recovery payloads are session state, not bundles — a realistic one is tens
 * of kilobytes. The cap exists so a corrupt or maliciously-grown file cannot
 * be read into the main process, which would freeze the UI thread. It is far
 * below the ``PROJECT_READ_CAP_BYTES`` used for ``.strix`` bundles because
 * nothing legitimate here approaches that size.
 *
 * It is ONE number by design. An earlier revision capped only reads, which
 * meant an oversized payload wrote happily and then became silently
 * unrecoverable at the next launch — the write path has to refuse exactly
 * what the read path will refuse, or the file is a lie.
 */
export const RECOVERY_FILE_CAP_BYTES = 16 * 1024 * 1024

// Per-field length caps on the envelope, mirroring the recent-projects caps
// in ``security.ts`` (debt #41): a hand-edited file with a 100-MB name must
// not reach the start-screen banner render.
const PROJECT_NAME_MAX_LEN = 200
const ISO_TIMESTAMP_MAX_LEN = 64
const APP_VERSION_MAX_LEN = 64

// Canonical 8-4-4-4-12 hex UUID, anchored at both ends and with no
// tolerance for surrounding whitespace, braces, or a trailing extension.
// Deliberately version-agnostic (accepts v1 as well as v4) because the id
// comes from the database, not from us. Anchoring is what makes
// "../../../etc/passwd", "a/../b" and "<uuid>.recovery.json" all fail.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Runtime configuration, injected once at startup so this module stays free
 * of any ``electron`` import.
 */
export interface RecoveryStoreConfig {
  /** Absolute path of Electron's ``userData`` directory. */
  userDataDir: string
  /** Application version stamped into every envelope (``app.getVersion()``). */
  appVersion: string
  /**
   * Optional override of {@link RECOVERY_FILE_CAP_BYTES}, governing reads and
   * writes alike. Exists so tests can exercise the cap without writing a
   * 16 MiB file.
   */
  fileCapBytes?: number
}

/**
 * The cap in force for the current configuration.
 *
 * Resolved in ONE place because write, read and list must enforce the same
 * number — three inline ``?? RECOVERY_FILE_CAP_BYTES`` expressions could drift
 * apart in a later edit, and a write cap above the read cap is precisely the
 * "wrote fine, unrecoverable at next launch" failure the single cap exists to
 * prevent.
 *
 * @param cfg - The active configuration.
 * @returns The override when set, otherwise {@link RECOVERY_FILE_CAP_BYTES}.
 */
function effectiveCapBytes(cfg: RecoveryStoreConfig): number {
  return cfg.fileCapBytes ?? RECOVERY_FILE_CAP_BYTES
}

/**
 * What the start screen needs to render a "recover unsaved work?" banner —
 * deliberately WITHOUT the payload, which can be large and is only needed
 * once the user actually chooses Restore.
 */
export interface RecoveryDescriptor {
  /** Project UUID the recovery file belongs to. */
  projectId: string
  /** Project name snapshot taken at write time (may be empty). */
  projectName: string
  /** Absolute path of the recovery file (for diagnostics / support). */
  filePath: string
  /** ISO-8601 timestamp of the write. */
  writtenAt: string
  /** App version that wrote the file. */
  appVersion: string
  /** On-disk size in bytes. */
  sizeBytes: number
}

/** Optional metadata a caller can attach to a write. */
export interface RecoveryWriteOptions {
  /** Project name snapshot for the banner. Defaults to an empty string. */
  projectName?: string
}

/**
 * On-disk envelope. Field names are snake_case to match the ``.strix``
 * bundle convention for JSON written to disk; the TypeScript-facing
 * {@link RecoveryDescriptor} uses camelCase like the rest of the IPC surface.
 */
interface RecoveryEnvelope {
  kind: string
  format_version: number
  project_id: string
  project_name: string
  written_at: string
  app_version: string
  payload: unknown
}

let config: RecoveryStoreConfig | null = null

/**
 * Install the runtime configuration. Called once from ``index.ts`` after
 * Electron is ready; calling it again replaces the configuration (the tests
 * rely on that to swap in a smaller file cap).
 *
 * @param next - The userData directory, app version, and an optional file cap
 *   governing reads and writes alike.
 */
export function configureRecoveryStore(next: RecoveryStoreConfig): void {
  config = { ...next }
}

/**
 * Drop the configuration. Test-only seam — production code configures once
 * at startup and never unconfigures.
 */
export function resetRecoveryStoreForTests(): void {
  config = null
}

/** Return the active configuration, or throw a diagnosable error. */
function requireConfig(): RecoveryStoreConfig {
  if (config === null) {
    throw new Error(
      'recoveryStore is not configured — call configureRecoveryStore() with ' +
        "app.getPath('userData') before using the recovery IPC.",
    )
  }
  return config
}

/**
 * True when ``value`` is a canonical hex UUID and therefore safe to use as a
 * filename stem.
 *
 * This is the entire input-validation surface of the module: every path is
 * built from a value that passed here, so a traversal segment, a separator,
 * a drive letter, or a trailing extension can never reach the filesystem.
 *
 * @param value - The candidate project id, from IPC (so: untrusted, any type).
 * @returns True when the value is a well-formed UUID.
 */
export function isValidProjectId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Throw a uniform "refused" error for a project id that failed validation. */
function assertValidProjectId(projectId: unknown): asserts projectId is string {
  if (!isValidProjectId(projectId)) {
    // Refuse, never sanitise — and don't echo the raw value back into the
    // message beyond a truncated form, so a crafted id can't inject a huge
    // string into the log line.
    const shown = typeof projectId === 'string' ? projectId.slice(0, 80) : typeof projectId
    throw new Error(`recovery refused — malformed project id: ${shown}`)
  }
}

/**
 * Validate a project id and return it in its ONE canonical form (lowercase).
 *
 * {@link UUID_PATTERN} accepts either case because the id comes from the
 * database and Postgres clients differ on how they render a ``uuid``. Accepting
 * both without normalising is a trap: the id is the filename stem AND the value
 * {@link validateEnvelope} compares. A file written under an uppercase id and
 * read back under the lowercase one resolves to the same file on NTFS, then
 * fails the strict envelope comparison — {@link readRecovery} returns ``null``
 * and the user is told there is nothing to recover while their session state
 * sits on disk. Case-folding at the single entry boundary means the rest of the
 * module only ever sees one spelling.
 *
 * Lowercase (not uppercase) because that is the canonical UUID form in RFC 4122
 * and what Postgres itself emits.
 *
 * @param projectId - Candidate id from IPC (untrusted, any type).
 * @returns The id, lowercased.
 * @throws Error when the value is not a well-formed UUID.
 */
function canonicalProjectId(projectId: unknown): string {
  assertValidProjectId(projectId)
  return projectId.toLowerCase()
}

/**
 * Validate the caller-supplied write options and return them narrowed.
 *
 * ``ipcRenderer.invoke`` will happily send ``{ projectName: 12345 }`` — the
 * handler's type annotation is erased at runtime. An unchecked non-string
 * reaches ``.slice()`` (a TypeError mid-envelope) or, when it happens to
 * carry a ``slice``, lands a non-string in a field {@link validateEnvelope}
 * later refuses — an unreadable recovery file. Refuse like a malformed
 * project id; never coerce, which would hide the renderer bug behind a
 * plausible ``"[object Object]"`` banner.
 *
 * @param options - Candidate options from IPC (untrusted, any type);
 *   ``undefined`` and ``null`` mean "no options".
 * @returns The options, narrowed to {@link RecoveryWriteOptions}.
 * @throws Error when the value is not an object, or a string field is not a
 *   string.
 */
export function validateWriteOptions(options: unknown): RecoveryWriteOptions {
  if (options === undefined || options === null) return {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    // Name arrays explicitly — "got object" for an array reads as a bug in
    // the message rather than in the caller.
    const shown = Array.isArray(options) ? 'array' : typeof options
    throw new Error(`recovery refused — write options must be an object, got ${shown}`)
  }
  const { projectName } = options as Record<string, unknown>
  if (projectName !== undefined && typeof projectName !== 'string') {
    throw new Error(
      `recovery refused — options.projectName must be a string, got ${
        projectName === null ? 'null' : typeof projectName
      }`,
    )
  }
  return { projectName }
}

/** Absolute path of the recovery directory. */
function recoveryDir(): string {
  return join(requireConfig().userDataDir, RECOVERY_DIR_NAME)
}

/**
 * Absolute path of one project's recovery file.
 *
 * The single place the path is composed — write, read and delete all route
 * through here, so the filename convention cannot be spelled four different
 * ways, and every one of them inherits the id validation for free.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns ``<userData>/recovery/<projectId>.recovery.json`` with the id in its
 *   canonical lowercase form.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function recoveryFilePath(projectId: unknown): string {
  const dir = recoveryDir()
  return join(dir, `${canonicalProjectId(projectId)}${RECOVERY_FILE_SUFFIX}`)
}

/**
 * Validate a parsed envelope. Returns the envelope when it is trustworthy,
 * or ``null`` when the caller should skip the file.
 *
 * Rejects: non-objects, a foreign ``kind``, a format version we do not
 * speak (the stale-file-from-an-old-app-version case), a project id that
 * disagrees with the filename it was found under, and pathological field
 * lengths.
 *
 * @param parsed - Result of ``JSON.parse`` on the file contents.
 * @param expectedProjectId - The id derived from the filename, already in
 *   canonical (lowercase) form.
 */
function validateEnvelope(parsed: unknown, expectedProjectId: string): RecoveryEnvelope | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const v = parsed as Record<string, unknown>
  if (v.kind !== RECOVERY_KIND) return null
  if (v.format_version !== RECOVERY_FORMAT_VERSION) return null
  // Compare case-folded: files written by a build that stored the id verbatim
  // may carry an uppercase spelling, and a mismatch here means "no recovery
  // offered" — the id disagreeing only in case is not a renamed file.
  const declaredId = v.project_id
  if (typeof declaredId !== 'string' || declaredId.toLowerCase() !== expectedProjectId) return null
  const name = v.project_name
  if (typeof name !== 'string' || name.length > PROJECT_NAME_MAX_LEN) return null
  const writtenAt = v.written_at
  if (typeof writtenAt !== 'string' || writtenAt.length > ISO_TIMESTAMP_MAX_LEN) return null
  const appVersion = v.app_version
  if (typeof appVersion !== 'string' || appVersion.length > APP_VERSION_MAX_LEN) return null
  if (!('payload' in v)) return null
  return {
    kind: RECOVERY_KIND,
    format_version: RECOVERY_FORMAT_VERSION,
    project_id: expectedProjectId,
    project_name: name,
    written_at: writtenAt,
    app_version: appVersion,
    payload: v.payload,
  }
}

/**
 * Persist one project's recovery payload, atomically.
 *
 * Creates ``<userData>/recovery/`` on the first ever write. An existing file
 * for the same project is replaced wholesale — one recovery file per
 * project, always the latest.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @param payload - Opaque session state. **Plain JSON values only** — object,
 *   array, string, number, boolean, ``null``. This is a hard contract, not a
 *   style preference: a ``Set`` or a ``Map`` survives the contextBridge
 *   structured clone intact, so the renderer sees a healthy object right up to
 *   the moment ``JSON.stringify`` turns it into ``{}`` here — and it restores
 *   as empty, silently, exactly when the user needed it. The design's items 4
 *   and 5 (the litho ghost workspace, the import manifests) ARE sets, so the
 *   renderer phase must convert them (``[...set]`` / ``Object.fromEntries``)
 *   before calling. ``undefined`` is stored as ``null`` so the envelope always
 *   has a ``payload`` key.
 * @param options - Optional metadata (project name for the banner). Untrusted
 *   IPC input; see {@link validateWriteOptions}.
 * @returns A descriptor for the file just written.
 * @throws Error when the store is unconfigured, the id is malformed, the
 *   options carry a non-string field, the payload is not JSON-serialisable,
 *   the serialised envelope exceeds {@link RECOVERY_FILE_CAP_BYTES}, or the
 *   write itself fails.
 */
export function writeRecovery(
  projectId: unknown,
  payload: unknown,
  options: unknown = {},
): RecoveryDescriptor {
  const cfg = requireConfig()
  // Validate BEFORE creating any directory — a refused write must leave no
  // trace on disk at all, and must not disturb an existing recovery file.
  const id = canonicalProjectId(projectId)
  const opts = validateWriteOptions(options)

  const envelope: RecoveryEnvelope = {
    kind: RECOVERY_KIND,
    format_version: RECOVERY_FORMAT_VERSION,
    project_id: id,
    project_name: (opts.projectName ?? '').slice(0, PROJECT_NAME_MAX_LEN),
    written_at: new Date().toISOString(),
    app_version: cfg.appVersion.slice(0, APP_VERSION_MAX_LEN),
    payload: payload === undefined ? null : payload,
  }

  // A BigInt or a circular reference throws here. Re-thrown in this module's
  // refusal style so the renderer sees "your payload is wrong", not a bare
  // TypeError from deep inside a save it did not know could fail this way.
  let serialised: string
  try {
    serialised = JSON.stringify(envelope)
  } catch (err) {
    throw new Error(
      `recovery write refused — payload is not JSON-serialisable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  // Same cap as the read path, measured in BYTES (Buffer.byteLength, not
  // String.length — the payload carries user text, and a multi-byte character
  // would otherwise slip past the byte-measured read cap). Checked before
  // mkdir and before the atomic write, so an over-cap payload leaves the
  // previous — still restorable — recovery file completely untouched.
  const cap = effectiveCapBytes(cfg)
  const byteLength = Buffer.byteLength(serialised, 'utf-8')
  if (byteLength > cap) {
    throw new Error(
      `recovery write refused — payload for project ${id} serialises to ` +
        `${byteLength} bytes, above the ${cap} byte cap. Writing it would produce ` +
        'a file the recovery read path refuses, i.e. silently unrecoverable work.',
    )
  }

  // ``recoveryDir()`` is needed here only to create the directory; the file
  // path itself comes from the one composer.
  const dir = recoveryDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = recoveryFilePath(id)
  writeFileAtomic(filePath, serialised)

  return {
    projectId: id,
    projectName: envelope.project_name,
    filePath,
    writtenAt: envelope.written_at,
    appVersion: envelope.app_version,
    sizeBytes: statSync(filePath).size,
  }
}

/**
 * Describe every valid recovery file on disk, newest first.
 *
 * Never returns the payload — the start screen only needs enough to render a
 * banner, and the payloads can be large. Any file that is corrupt, foreign,
 * stale, oversized, or not named after a UUID is skipped rather than thrown
 * on: one bad file must not stop the user from seeing the others.
 *
 * @returns Descriptors sorted by ``writtenAt`` descending. Empty when the
 *   recovery directory does not exist yet.
 * @throws Error only when the store is unconfigured.
 */
export function listRecovery(): RecoveryDescriptor[] {
  const cfg = requireConfig()
  const dir = recoveryDir()
  if (!existsSync(dir)) return []

  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    // Unreadable directory (permissions, a race with a delete) — behave as
    // if there is nothing to recover rather than blocking startup.
    return []
  }

  const cap = effectiveCapBytes(cfg)
  const descriptors: RecoveryDescriptor[] = []

  for (const name of names) {
    if (!name.endsWith(RECOVERY_FILE_SUFFIX)) continue
    // Also filters the ``.tmp.<pid>`` orphan a crashed atomic write leaves
    // behind, since that never ends in the suffix.
    const stem = name.slice(0, name.length - RECOVERY_FILE_SUFFIX.length)
    if (!isValidProjectId(stem)) continue
    // The descriptor carries the canonical id (a caller round-trips it back
    // into read/delete); ``filePath`` keeps the on-disk spelling verbatim.
    const projectId = stem.toLowerCase()

    const filePath = join(dir, name)
    try {
      const size = statSync(filePath).size
      // Cap before reading: statSync is O(1), readFileSync would allocate.
      if (size > cap) continue
      const envelope = validateEnvelope(JSON.parse(readFileSync(filePath, 'utf-8')), projectId)
      if (envelope === null) continue
      descriptors.push({
        projectId,
        projectName: envelope.project_name,
        filePath,
        writtenAt: envelope.written_at,
        appVersion: envelope.app_version,
        sizeBytes: size,
      })
    } catch {
      // Corrupt JSON, a file that vanished mid-scan, an unreadable file —
      // skip the entry, keep the rest.
      continue
    }
  }

  // Newest first so a banner showing a single entry shows the freshest one.
  descriptors.sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))
  return descriptors
}

/**
 * Read one project's recovery payload — for when the user chooses Restore.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns The opaque payload, or ``null`` when there is no recovery file or
 *   the file is corrupt / foreign / stale (the caller shows "nothing to
 *   restore" rather than an error).
 * @throws Error when the store is unconfigured, the id is malformed, or the
 *   file exceeds the read cap. The cap is a throw, not a skip: the user
 *   explicitly asked for this file, so silently returning "nothing" would
 *   hide a real problem.
 */
export function readRecovery(projectId: unknown): unknown {
  const cfg = requireConfig()
  const id = canonicalProjectId(projectId)
  const filePath = recoveryFilePath(id)
  if (!existsSync(filePath)) return null

  const cap = effectiveCapBytes(cfg)
  const size = statSync(filePath).size
  if (size > cap) {
    throw new Error(
      `recovery read refused — file ${filePath} (${size} bytes) exceeds the ` +
        `${cap} byte cap. A recovery file this large indicates corruption.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
  const envelope = validateEnvelope(parsed, id)
  return envelope === null ? null : envelope.payload
}

/**
 * Delete one project's recovery file — called once the session it protected
 * has been saved or explicitly discarded.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns True when a file was removed, false when there was nothing to
 *   remove. A missing file is a no-op, not an error: the common path is
 *   "clear recovery on clean shutdown" where none may ever have been written.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function deleteRecovery(projectId: unknown): boolean {
  const filePath = recoveryFilePath(projectId)
  try {
    unlinkSync(filePath)
    return true
  } catch (err) {
    // ENOENT is the expected "already gone" case. Anything else (a locked
    // file, a permissions problem) is real and worth surfacing.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw err
  }
}
