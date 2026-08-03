/**
 * App-managed crash-recovery file store (Electron main process).
 *
 * A crash loses no *interpretation* — that lives in PostgreSQL. What it
 * loses is renderer-only session state: the stratigraphy lumping map, the
 * litho ghost workspace, an unsaved metadata draft, import manifests, the
 * dirty flag. This module is the storage layer an autosave will write that
 * state to; the autosave timer and the renderer wiring are a later phase.
 *
 * Layout — two slots per project, in an app-owned directory:
 *
 *     <userData>/recovery/<projectId>.recovery.json           (primary)
 *     <userData>/recovery/<projectId>.recovery.declined.json  (declined)
 *
 * The autosave scheduler writes the primary slot and nothing else. The
 * declined slot holds a copy the user chose to keep-but-not-restore ("Open
 * without restoring"), so that a restart re-offers it; see
 * {@link RECOVERY_DECLINED_FILE_SUFFIX} and {@link declineRecovery}. Readers
 * prefer the primary slot and fall back to the declined one
 * ({@link resolveSlot}). Three clears, one per intent:
 * {@link deletePrimaryRecovery} (this session's delta has a home now),
 * {@link deleteDeclinedRecovery} (a declined copy has just been restored, so
 * the decline is over) and {@link deleteRecovery} (the user pressed Discard —
 * the only path that destroys work the user has not seen back).
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
  renameSync,
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
 * Suffix of the **declined** slot — where a recovery copy goes when the user
 * picks "Open without restoring".
 *
 * Owner decision 2026-08-03: declining preserves the copy (Word-style), so a
 * later restart re-offers the same unsaved work; only the prompt's explicit
 * *Discard* destroys it. A second slot is what makes that possible, because
 * the autosave scheduler owns the primary slot: it overwrites the primary file
 * as soon as the new session has anything at risk, and every decided exit
 * deletes it. Left in the primary slot, a declined session's only copy would
 * be gone within seconds of the user choosing to keep working.
 *
 * The two suffixes are **disjoint** — ``.recovery.declined.json`` does not end
 * in ``.recovery.json`` — so a filename matches at most one slot and the
 * directory scan needs no ordering rule between them.
 */
export const RECOVERY_DECLINED_FILE_SUFFIX = '.recovery.declined.json'

/**
 * Suffix of the **quarantine** slot — where a primary file goes when it turns
 * out to be unreadable (unparseable, foreign ``kind``, a format version we do
 * not speak, or above the cap).
 *
 * This is not a third recovery slot; nothing ever reads it. It exists because
 * "presence wins" (see {@link resolveSlot}) is the right rule for a READABLE
 * primary and the wrong rule for garbage: an unreadable primary left in place
 * shadowed a perfectly good declined copy at every launch, forever, and no
 * path in the app ever cleaned it up. Moving it aside restores the fallback
 * and keeps the bytes around for a support question — "what was actually in
 * that file?" is unanswerable once it is unlinked.
 *
 * Disjoint from both slot suffixes (it does not end in ``.recovery.json``), so
 * the directory scan in {@link listRecovery} skips it without an extra rule.
 */
export const RECOVERY_CORRUPT_FILE_SUFFIX = '.recovery.corrupt.json'

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
  /**
   * True when this descriptor came from the **declined** slot — i.e. the user
   * already chose "Open without restoring" for this work at least once.
   *
   * The start screen needs the distinction to word the offer honestly ("you
   * chose not to restore this last time") rather than presenting a
   * previously-declined copy as fresh crash debris.
   */
  declined: boolean
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
  return join(recoveryDir(), `${canonicalProjectId(projectId)}${RECOVERY_FILE_SUFFIX}`)
}

/**
 * Absolute path of one project's **declined** recovery file.
 *
 * Same single-composer discipline (and therefore the same id validation) as
 * {@link recoveryFilePath}; only the suffix differs. See
 * {@link RECOVERY_DECLINED_FILE_SUFFIX} for why the slot exists.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns ``<userData>/recovery/<projectId>.recovery.declined.json`` with the
 *   id in its canonical lowercase form.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function declinedRecoveryFilePath(projectId: unknown): string {
  return join(recoveryDir(), `${canonicalProjectId(projectId)}${RECOVERY_DECLINED_FILE_SUFFIX}`)
}

/**
 * Absolute path of one project's **quarantined** recovery file.
 *
 * Same single-composer discipline as {@link recoveryFilePath}; see
 * {@link RECOVERY_CORRUPT_FILE_SUFFIX} for why the slot exists.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns ``<userData>/recovery/<projectId>.recovery.corrupt.json`` with the
 *   id in its canonical lowercase form.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function corruptRecoveryFilePath(projectId: unknown): string {
  return join(recoveryDir(), `${canonicalProjectId(projectId)}${RECOVERY_CORRUPT_FILE_SUFFIX}`)
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

/** One recovery file on disk, resolved to a slot and loaded. */
interface ResolvedSlot {
  /** Absolute path of the file. */
  filePath: string
  /** True when the file lives in the declined slot. */
  declined: boolean
  /** The validated envelope. */
  envelope: RecoveryEnvelope
  /** On-disk size in bytes. */
  sizeBytes: number
}

/**
 * Move an unreadable primary file out of the way, so it stops shadowing the
 * declined copy behind it.
 *
 * Overwrites an older quarantine on purpose: this is a diagnostic, not an
 * archive, and keeping every corrupt file would grow the directory without
 * bound in exactly the situation where something is repeatedly writing
 * garbage. ``renameSync`` replaces the destination on NTFS as well as on
 * POSIX.
 *
 * Never throws. A quarantine that fails leaves the caller exactly where it
 * would have been without this function — no offer for this project — and a
 * failure to tidy up must not turn into a failure to start.
 *
 * @param id - Canonical (lowercase) project id.
 * @param reason - What made the file unreadable, for the log line.
 */
function quarantinePrimary(id: string, reason: string): void {
  const from = recoveryFilePath(id)
  const to = corruptRecoveryFilePath(id)
  try {
    renameSync(from, to)
    // WARNING, not DEBUG: something wrote a file this module cannot read, and
    // the name of the file plus the reason is the whole diagnosis. Losing it
    // to a suppressed level would leave "recovery silently offered nothing".
    // eslint-disable-next-line no-console
    console.warn(`[main] recovery: quarantined an unreadable primary (${reason}) -> ${to}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[main] recovery: could not quarantine ${from} (${reason})`, err)
  }
}

/**
 * Pick which of a project's two slots a reader should use — and load it — or
 * ``null`` when the project has nothing readable.
 *
 * **A readable primary slot wins whenever both exist.** A primary file present
 * alongside a declined one means the session that declined went on to produce
 * new work and then died without a clean exit — that work is strictly newer
 * than the copy it declined, so offering the declined copy instead would hand
 * the user back the older of the two.
 *
 * That rationale is about *state*, and it only holds while the primary IS
 * state. An unparseable, foreign, stale or over-cap primary is garbage: it
 * carries nothing to prefer, and leaving it to win would hide a valid declined
 * copy at every launch for as long as the file exists (nothing in the app ever
 * deleted it). So an unreadable primary is quarantined
 * ({@link quarantinePrimary}) and the resolve continues to the declined slot —
 * which is not a silent substitution, because there was no newer work to
 * substitute *for*.
 *
 * @param id - Canonical (lowercase) project id.
 * @param cap - Byte ceiling in force for the current configuration.
 * @returns The slot to read together with its validated envelope, or ``null``
 *   when the project has no readable file in either slot.
 * @throws Error when the DECLINED file exceeds ``cap``. The declined slot has
 *   nothing behind it to fall back to, so the over-cap read stays the loud
 *   failure {@link readRecovery} documents.
 */
function resolveSlot(id: string, cap: number): ResolvedSlot | null {
  const primary = recoveryFilePath(id)
  if (existsSync(primary)) {
    let loaded: { envelope: RecoveryEnvelope; sizeBytes: number } | null = null
    let reason = 'corrupt, foreign or stale envelope'
    try {
      loaded = loadEnvelope(primary, id, cap)
    } catch (err) {
      // The only throw from loadEnvelope is the cap refusal (plus a file that
      // vanished mid-resolve). Both mean the same thing here: unusable.
      reason = err instanceof Error ? err.message : String(err)
    }
    if (loaded !== null) {
      return { filePath: primary, declined: false, envelope: loaded.envelope, sizeBytes: loaded.sizeBytes }
    }
    quarantinePrimary(id, reason)
  }
  const declined = declinedRecoveryFilePath(id)
  if (existsSync(declined)) {
    const loaded = loadEnvelope(declined, id, cap)
    if (loaded === null) return null
    return { filePath: declined, declined: true, envelope: loaded.envelope, sizeBytes: loaded.sizeBytes }
  }
  return null
}

/**
 * Read + validate one recovery file, whichever slot it sits in.
 *
 * The ONE read path: the cap, the JSON parse, and the envelope validation are
 * spelled once so the declined slot cannot drift into weaker checks than the
 * primary one. Callers differ only in what they do with the over-cap throw —
 * {@link readRecovery} propagates it (the user asked for this file by name),
 * {@link listRecovery} catches it and skips the entry.
 *
 * @param filePath - Absolute path of the file to load.
 * @param id - Canonical (lowercase) project id the envelope must declare.
 * @param cap - Byte ceiling in force for the current configuration.
 * @returns The validated envelope plus its on-disk size, or ``null`` when the
 *   file is missing, unparseable, foreign, stale, or renamed.
 * @throws Error when the file exceeds ``cap``.
 */
function loadEnvelope(
  filePath: string,
  id: string,
  cap: number,
): { envelope: RecoveryEnvelope; sizeBytes: number } | null {
  // Cap before reading: statSync is O(1), readFileSync would allocate.
  const sizeBytes = statSync(filePath).size
  if (sizeBytes > cap) {
    throw new Error(
      `recovery read refused — file ${filePath} (${sizeBytes} bytes) exceeds the ` +
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
  return envelope === null ? null : { envelope, sizeBytes }
}

/**
 * Persist one project's recovery payload, atomically.
 *
 * Creates ``<userData>/recovery/`` on the first ever write. An existing file
 * for the same project is replaced wholesale — one recovery file per
 * project, always the latest.
 *
 * Writes the **primary** slot only, never the declined one. That is the
 * property that makes "Open without restoring" survivable: the autosave
 * scheduler runs continuously against the primary slot, so a declined copy is
 * out of its reach by construction rather than by a check it could forget.
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
    declined: false,
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
 * **One descriptor per project, not per file.** A project with both a primary
 * and a declined copy is one offer to the user, resolved by the same rule
 * {@link readRecovery} uses (see {@link resolveSlot}) — listing both would
 * put two entries for the same project on the start screen, of which only one
 * is what Restore would actually load.
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
  // Deduplicate by project so the two slots of one project collapse into the
  // single offer the user will be shown.
  const seen = new Set<string>()

  for (const name of names) {
    // The two suffixes are disjoint, so a name belongs to at most one slot and
    // the order of these two tests does not matter. Everything else — the
    // ``.tmp.<pid>`` orphan a crashed atomic write leaves behind, foreign
    // files — matches neither and is skipped.
    let suffix: string
    if (name.endsWith(RECOVERY_DECLINED_FILE_SUFFIX)) suffix = RECOVERY_DECLINED_FILE_SUFFIX
    else if (name.endsWith(RECOVERY_FILE_SUFFIX)) suffix = RECOVERY_FILE_SUFFIX
    else continue

    const stem = name.slice(0, name.length - suffix.length)
    if (!isValidProjectId(stem)) continue
    // The descriptor carries the canonical id (a caller round-trips it back
    // into read/delete/decline).
    const projectId = stem.toLowerCase()
    if (seen.has(projectId)) continue

    try {
      // Resolve the slot rather than describing the file we happened to walk
      // onto: readdir order is arbitrary, and the descriptor must describe the
      // file a Restore would actually load.
      const slot = resolveSlot(projectId, cap)
      if (slot === null) continue
      seen.add(projectId)
      descriptors.push({
        projectId,
        projectName: slot.envelope.project_name,
        filePath: slot.filePath,
        writtenAt: slot.envelope.written_at,
        appVersion: slot.envelope.app_version,
        sizeBytes: slot.sizeBytes,
        declined: slot.declined,
      })
    } catch {
      // Corrupt JSON, an over-cap file, a file that vanished mid-scan, an
      // unreadable file — skip the entry, keep the rest. Unlike readRecovery,
      // a throw here must not take the whole start screen down with it.
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
 * Reads whichever slot {@link resolveSlot} picks: the primary file when one
 * exists, otherwise the declined copy left behind by an earlier "Open without
 * restoring". Both go through the same validation and the same cap.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns The opaque payload, or ``null`` when there is no recovery file in
 *   either slot or the file is corrupt / foreign / stale (the caller shows
 *   "nothing to restore" rather than an error). An unreadable PRIMARY file is
 *   quarantined on the way past, so the declined copy behind it — if any — is
 *   what comes back.
 * @throws Error when the store is unconfigured, the id is malformed, or the
 *   DECLINED file exceeds the read cap. The cap is a throw there, not a skip:
 *   nothing sits behind the declined slot, so silently returning "nothing"
 *   would hide a real problem.
 */
export function readRecovery(projectId: unknown): unknown {
  const cfg = requireConfig()
  const id = canonicalProjectId(projectId)
  const slot = resolveSlot(id, effectiveCapBytes(cfg))
  return slot === null ? null : slot.envelope.payload
}

/**
 * Move one project's recovery file into the declined slot — called when the
 * user picks "Open without restoring".
 *
 * The rename is what keeps the copy alive: the autosave scheduler is about to
 * start writing the primary slot for the newly-opened session, and the next
 * decided exit deletes that file. Out of the scheduler's way, the declined
 * copy survives until the user explicitly discards it, so a restart re-offers
 * the same unsaved work (owner decision 2026-08-03).
 *
 * An older declined copy is **overwritten** — ``renameSync`` replaces the
 * destination on NTFS as well as on POSIX. Newest decline wins: two declines
 * without an intervening Discard mean the second one carries the later
 * session state, and keeping the earlier copy would only give a future restart
 * a choice it has no way to make.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns True when a file was moved, false when there was nothing to
 *   decline (no recovery file was ever written for this session).
 * @throws Error when the store is unconfigured, the id is malformed, or the
 *   rename fails for any reason other than a missing source.
 */
export function declineRecovery(projectId: unknown): boolean {
  const id = canonicalProjectId(projectId)
  try {
    renameSync(recoveryFilePath(id), declinedRecoveryFilePath(id))
    return true
  } catch (err) {
    // ENOENT is the expected "this session never had anything at risk" case.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw err
  }
}

/**
 * Delete one project's recovery files — **both slots** — called once the
 * session they protected has been saved or explicitly discarded.
 *
 * Clearing both is what makes Discard mean discard. If it cleared only the
 * primary slot, a project the user had once declined would keep re-offering
 * that stale copy at every launch, and the prompt's Discard button — the only
 * control the user is given over it — would appear not to work.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns True when at least one file was removed, false when there was
 *   nothing to remove. A missing file is a no-op, not an error: the common
 *   path is "clear recovery on clean shutdown" where none may ever have been
 *   written.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function deleteRecovery(projectId: unknown): boolean {
  const id = canonicalProjectId(projectId)
  // Not short-circuiting: the declined copy must go even when the primary one
  // was already gone (the ordinary decline-then-discard sequence).
  const removedPrimary = unlinkIfPresent(recoveryFilePath(id))
  const removedDeclined = unlinkIfPresent(declinedRecoveryFilePath(id))
  // A quarantined file is the only other thing this module ever leaves on
  // disk, and Discard means "nothing about this project's unsaved work
  // survives". Nothing reads it, so its removal does not count as a removal
  // for the return value — the caller's log line is about the user's work.
  unlinkIfPresent(corruptRecoveryFilePath(id))
  return removedPrimary || removedDeclined
}

/**
 * Delete one project's **declined** recovery copy, leaving the primary slot
 * alone — the clear that ends a decline without touching live state.
 *
 * The third verb exists for one path: restoring a copy that came OUT of the
 * declined slot. Restore leaves the work at risk all over again, so the
 * restored content is written to the primary slot first and the decline is
 * ended second. Without this call the declined file stays behind that new
 * primary, every clean exit clears only the primary, and the same work is
 * offered again at every launch — forever, with no way for the user to say no
 * that sticks.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns True when a declined copy was removed, false when there was none.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function deleteDeclinedRecovery(projectId: unknown): boolean {
  return unlinkIfPresent(declinedRecoveryFilePath(canonicalProjectId(projectId)))
}

/**
 * Delete one project's **primary** recovery file, leaving a declined copy
 * alone — the clear every path EXCEPT the prompt's Discard wants.
 *
 * The two clears exist because two different intents were being spelled with
 * one call. A save, a discard-and-close, a clean close, a quit and the
 * autosave scheduler's dirty→clean transition all mean "*this session's*
 * delta now has a durable home". They say nothing about a copy the user
 * declined in an earlier session, which by owner decision (2026-08-03)
 * survives until they Discard it — and which {@link deleteRecovery} would
 * take with it, reinstating exactly the silent loss the declined slot was
 * added to prevent.
 *
 * @param projectId - Project UUID (either case); anything else is refused.
 * @returns True when the primary file was removed, false when there was none.
 *   A declined copy left in place does NOT count as a removal: the caller's
 *   log line would otherwise claim to have cleared something it did not.
 * @throws Error when the store is unconfigured or the id is malformed.
 */
export function deletePrimaryRecovery(projectId: unknown): boolean {
  return unlinkIfPresent(recoveryFilePath(canonicalProjectId(projectId)))
}

/**
 * Unlink a file, treating "already gone" as a non-event.
 *
 * @param filePath - Absolute path to remove.
 * @returns True when the file was removed, false when it did not exist.
 * @throws The underlying error for anything other than ENOENT — a locked file
 *   or a permissions problem is real and worth surfacing.
 */
function unlinkIfPresent(filePath: string): boolean {
  try {
    unlinkSync(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw err
  }
}
