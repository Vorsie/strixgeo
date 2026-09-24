// The crash-recovery payload codec.
//
// A crash in Strix destroys no interpretation — every gesture is an awaited
// HTTP call and Postgres outlives Electron. What it destroys is a small,
// oddly-shaped SESSION DELTA of six items (docs/design/autosave-recovery.md
// §2). This module is the only place that knows how those six items are
// written into, and read back out of, the recovery file.
//
// Two hard constraints shape the encoding:
//
//   * The recovery store's payload contract is PLAIN JSON. A ``Set`` or a
//     ``Map`` silently serialises to ``{}`` — the ghost workspace, which is
//     mostly Sets and Maps, would arrive back empty and look restored. Every
//     collection is therefore converted explicitly, and ``ghostsFromSnapshot``
//     is the matching decoder so no caller has to re-invent the pairing.
//   * The file comes back OFF DISK, possibly written by a different build.
//     ``parseRecoverySnapshot`` treats it as untrusted input: it validates
//     field by field, returns ``null`` on any mismatch, and never throws —
//     a bad recovery file must not take down the start screen.
//
// Pure: no React, no ``window``, no API. The scheduler
// (``hooks/useRecoveryAutosave``) owns when this runs; the restore flow owns
// what is done with the result.

import type { ProjectResponse } from '../api/client'
import type { LithoLayerSuggestion } from '../api/clients/geology.types'
import type { BulkAnchorGhost, LithoSuggestionEdit } from '../hooks/useGeologicalModel'
import { log } from './log'
import type { StratigraphyLumping } from './projectFile'
import {
  PROJECT_METADATA_FIELDS,
  projectMetadataDraftPatch,
} from './projectMetadataFields'
import type { ProjectMetadataDraft, ProjectMetadataField } from './projectMetadataFields'
import { parseStratigraphyLumping } from './stratigraphyLumping'

/**
 * Payload-level compatibility gate.
 *
 * Deliberately NOT coupled to the recovery file's envelope
 * ``format_version`` (owned by the main-process store) nor to
 * ``PROJECT_FILE_FORMAT_VERSION``: the three version the shape of three
 * different things and move for different reasons.
 */
export const RECOVERY_SNAPSHOT_VERSION = 1

/** One anchor's ghost workspace, flattened to plain JSON. */
export interface SerialisedAnchorGhost {
  kind: 'cpt' | 'borehole'
  suggestions: LithoLayerSuggestion[]
  surfaceElevationM: number | null
  /** ``accepted`` as an array — a Set would serialise to ``{}``. */
  accepted: number[]
  /** ``rejected`` as an array — same reason. */
  rejected: number[]
  /** ``edits`` as entry pairs — a Map would serialise to ``{}``. */
  edits: [number, LithoSuggestionEdit][]
  /** ``contactIdsByAcceptedIdx`` as entry pairs; absent when unpopulated. */
  contactIdsByAcceptedIdx?: [number, string[]][]
}

/** The six at-risk items, as they sit in the recovery file. */
export interface RecoverySnapshotV1 {
  snapshot_version: typeof RECOVERY_SNAPSHOT_VERSION
  /** The ``.strix`` this session was editing; null for a never-saved project. */
  filePath: string | null
  /** Item 1 — the lumping map plus the revision reconciliation compares. */
  lumping: {
    current: StratigraphyLumping | null
    revision: number | null
  }
  /** Item 2 — the litho ghost workspace, keyed by anchor id. */
  ghosts: [string, SerialisedAnchorGhost][]
  /** Item 3 — only the metadata scalars that differ live-vs-saved. */
  metadataDraftPatch: ProjectMetadataDraft
  /** Item 4 — the four manifest sets (unreconstructed, not lost). */
  manifests: {
    cpt: string[]
    borehole: string[]
    formation: string[]
    section: string[]
  }
  /** Item 5 — the five session-import sets, snapshotted with the manifests. */
  sessionImports: {
    cpt: string[]
    borehole: string[]
    formation: string[]
    section: string[]
    contact: string[]
  }
  /** Item 6 — the boolean whose loss lets a later Discard destroy real work. */
  hasUnsavedMutations: boolean
}

/** Everything ``buildRecoverySnapshot`` needs, straight off the live hooks. */
export interface RecoverySnapshotInputs {
  filePath: string | null
  /** Live project — the metadata delta is derived against ``saved``. */
  project: ProjectResponse | null
  /** Last-saved snapshot; null for a never-saved project. */
  saved: ProjectResponse | null
  currentLumping: StratigraphyLumping | null
  lumpingRevision: number | null
  ghostsByAnchor: ReadonlyMap<string, BulkAnchorGhost>
  manifestCptIds: ReadonlySet<string>
  manifestBoreholeIds: ReadonlySet<string>
  manifestFormationIds: ReadonlySet<string>
  manifestSectionIds: ReadonlySet<string>
  sessionImportCptIds: ReadonlySet<string>
  sessionImportBoreholeIds: ReadonlySet<string>
  sessionImportFormationIds: ReadonlySet<string>
  sessionImportSectionIds: ReadonlySet<string>
  sessionImportContactIds: ReadonlySet<string>
  hasUnsavedMutations: boolean
}

/**
 * Drop the internal cross-merge marker from one edit.
 *
 * ``_propagateOnly`` is set for the duration of a single shared-boundary
 * drag and is documented as "never persisted to the server". Persisting it
 * into a recovery file would restore a session into the middle of a gesture
 * that is long over.
 *
 * @param edit - The edit as the ghost store holds it.
 * @returns The same edit without the internal marker.
 */
function stripInternalMarkers(edit: LithoSuggestionEdit): LithoSuggestionEdit {
  const { _propagateOnly: _ignored, _absorbAll: _ignoredToo, ...rest } = edit
  return rest
}

/**
 * Flatten one anchor's ghost workspace into plain JSON.
 *
 * @param ghost - The live ghost entry.
 * @returns The same state with every Set / Map converted to an array.
 */
function serialiseGhost(ghost: BulkAnchorGhost): SerialisedAnchorGhost {
  const serialised: SerialisedAnchorGhost = {
    kind: ghost.kind,
    suggestions: [...ghost.suggestions],
    surfaceElevationM: ghost.surfaceElevationM,
    accepted: Array.from(ghost.accepted),
    rejected: Array.from(ghost.rejected),
    edits: Array.from(ghost.edits, ([idx, edit]) => [idx, stripInternalMarkers(edit)]),
  }
  if (ghost.contactIdsByAcceptedIdx !== undefined) {
    serialised.contactIdsByAcceptedIdx = Array.from(
      ghost.contactIdsByAcceptedIdx,
      ([idx, ids]) => [idx, [...ids]],
    )
  }
  return serialised
}

/**
 * Encode the six at-risk items into the recovery payload.
 *
 * @param inputs - Live values straight off ``useProject`` /
 *   ``useGeologicalModel`` / the session-import sets.
 * @returns A plain-JSON snapshot ready for ``window.electron.writeRecovery``.
 */
export function buildRecoverySnapshot(inputs: RecoverySnapshotInputs): RecoverySnapshotV1 {
  return {
    snapshot_version: RECOVERY_SNAPSHOT_VERSION,
    filePath: inputs.filePath,
    lumping: {
      current: inputs.currentLumping,
      revision: inputs.lumpingRevision,
    },
    ghosts: Array.from(inputs.ghostsByAnchor, ([anchorId, ghost]) => [
      anchorId,
      serialiseGhost(ghost),
    ]),
    metadataDraftPatch: projectMetadataDraftPatch(inputs.project, inputs.saved),
    manifests: {
      cpt: Array.from(inputs.manifestCptIds),
      borehole: Array.from(inputs.manifestBoreholeIds),
      formation: Array.from(inputs.manifestFormationIds),
      section: Array.from(inputs.manifestSectionIds),
    },
    sessionImports: {
      cpt: Array.from(inputs.sessionImportCptIds),
      borehole: Array.from(inputs.sessionImportBoreholeIds),
      formation: Array.from(inputs.sessionImportFormationIds),
      section: Array.from(inputs.sessionImportSectionIds),
      contact: Array.from(inputs.sessionImportContactIds),
    },
    hasUnsavedMutations: inputs.hasUnsavedMutations,
  }
}

/**
 * Rebuild the live ghost store from a parsed snapshot.
 *
 * The mirror of {@link serialiseGhost}: arrays go back to the Sets and Maps
 * the ghost overlay reads. Kept here so the encode and decode halves can
 * never drift apart in two different files.
 *
 * @param snapshot - A snapshot that already passed
 *   {@link parseRecoverySnapshot}.
 * @returns The ghost workspace keyed by anchor id.
 */
export function ghostsFromSnapshot(
  snapshot: RecoverySnapshotV1,
): Map<string, BulkAnchorGhost> {
  const restored = new Map<string, BulkAnchorGhost>()
  for (const [anchorId, ghost] of snapshot.ghosts) {
    const entry: BulkAnchorGhost = {
      kind: ghost.kind,
      suggestions: ghost.suggestions,
      surfaceElevationM: ghost.surfaceElevationM,
      accepted: new Set(ghost.accepted),
      rejected: new Set(ghost.rejected),
      edits: new Map(ghost.edits),
    }
    if (ghost.contactIdsByAcceptedIdx !== undefined) {
      entry.contactIdsByAcceptedIdx = new Map(
        ghost.contactIdsByAcceptedIdx.map(([idx, ids]) => [idx, ids]),
      )
    }
    restored.set(anchorId, entry)
  }
  return restored
}

// ---------------------------------------------------------------------------
// Reading — every helper below treats its argument as untrusted disk content
// ---------------------------------------------------------------------------

/** Narrow to a plain JSON object (arrays and null are not objects here). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Narrow to an array of strings. */
function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((v): v is string => typeof v === 'string')) return null
  return [...value]
}

/** Narrow to an array of finite numbers. */
function asNumberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return null
  return [...value]
}

/** Narrow to a ``[key, value]`` pair whose key is a finite number. */
function asNumberKeyedEntries(value: unknown): [number, unknown][] | null {
  if (!Array.isArray(value)) return null
  const entries: [number, unknown][] = []
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) return null
    const [key, payload] = pair as [unknown, unknown]
    if (typeof key !== 'number' || !Number.isFinite(key)) return null
    entries.push([key, payload])
  }
  return entries
}

/**
 * Narrow one layer edit.
 *
 * Every field is optional on the live type, so validation is "present ⇒
 * right type" rather than "must be there". ``_propagateOnly`` is dropped on
 * read as well as on write: a file from an older build may still carry it.
 */
function parseEdit(value: unknown): LithoSuggestionEdit | null {
  const raw = asRecord(value)
  if (raw === null) return null
  const edit: LithoSuggestionEdit = {}
  if (raw.depth_top_m !== undefined) {
    if (typeof raw.depth_top_m !== 'number' || !Number.isFinite(raw.depth_top_m)) return null
    edit.depth_top_m = raw.depth_top_m
  }
  if (raw.depth_base_m !== undefined) {
    if (typeof raw.depth_base_m !== 'number' || !Number.isFinite(raw.depth_base_m)) return null
    edit.depth_base_m = raw.depth_base_m
  }
  if (raw.suggested_lithology !== undefined) {
    if (typeof raw.suggested_lithology !== 'string') return null
    edit.suggested_lithology = raw.suggested_lithology
  }
  if (raw.suggested_admixtures !== undefined) {
    if (!Array.isArray(raw.suggested_admixtures)) return null
    const admixtures: { soil_code: string; amount: string; locally: boolean }[] = []
    for (const item of raw.suggested_admixtures) {
      const row = asRecord(item)
      if (row === null) return null
      if (typeof row.soil_code !== 'string') return null
      if (typeof row.amount !== 'string') return null
      if (typeof row.locally !== 'boolean') return null
      admixtures.push({ soil_code: row.soil_code, amount: row.amount, locally: row.locally })
    }
    edit.suggested_admixtures = admixtures
  }
  return edit
}

/**
 * Is this suggestion row safe to hand to the ghost overlay?
 *
 * The rest of the DTO is passed through unvalidated on purpose (see
 * {@link parseGhost}), but the two depths are GEOMETRY: the overlay divides
 * by them to place a band, so a corrupt row arrives as a NaN rectangle rather
 * than as a visible error. They are checked here so the codec keeps its
 * refuse-don't-repair stance instead of leaking a broken ghost into the UI.
 *
 * @param value - One entry of the serialised ``suggestions`` array.
 * @returns ``true`` when the row is an object carrying two finite depths.
 */
function suggestionGeometryIsUsable(value: unknown): boolean {
  const row = asRecord(value)
  if (row === null) return false
  return (
    typeof row.depth_top_m === 'number' &&
    Number.isFinite(row.depth_top_m) &&
    typeof row.depth_base_m === 'number' &&
    Number.isFinite(row.depth_base_m)
  )
}

/**
 * Narrow one anchor's serialised ghost workspace.
 *
 * WHY the suggestion rows are validated only shallowly: they are the one part
 * of the ghost the design calls "re-derivable" (re-running the segmenter
 * reproduces them), and re-encoding a 12-field API DTO here would be a second
 * copy of ``LithoLayerSuggestion`` that the compiler cannot keep in step. The
 * two DEPTHS are the exception — they are geometry the overlay draws with, so
 * a corrupt one is a NaN band rather than a caught error. The IRREPRODUCIBLE
 * parts — the accepted / rejected indices, the edits, the accept bookkeeping —
 * are checked strictly.
 */
function parseGhost(value: unknown): SerialisedAnchorGhost | null {
  const raw = asRecord(value)
  if (raw === null) return null
  if (raw.kind !== 'cpt' && raw.kind !== 'borehole') return null
  if (!Array.isArray(raw.suggestions)) return null
  if (!raw.suggestions.every(suggestionGeometryIsUsable)) return null
  if (
    raw.surfaceElevationM !== null &&
    (typeof raw.surfaceElevationM !== 'number' || !Number.isFinite(raw.surfaceElevationM))
  ) {
    return null
  }
  const accepted = asNumberList(raw.accepted)
  const rejected = asNumberList(raw.rejected)
  if (accepted === null || rejected === null) return null

  const editEntries = asNumberKeyedEntries(raw.edits)
  if (editEntries === null) return null
  const edits: [number, LithoSuggestionEdit][] = []
  for (const [idx, rawEdit] of editEntries) {
    const edit = parseEdit(rawEdit)
    if (edit === null) return null
    edits.push([idx, edit])
  }

  const ghost: SerialisedAnchorGhost = {
    kind: raw.kind,
    suggestions: raw.suggestions as LithoLayerSuggestion[],
    surfaceElevationM: raw.surfaceElevationM as number | null,
    accepted,
    rejected,
    edits,
  }

  if (raw.contactIdsByAcceptedIdx !== undefined) {
    const contactEntries = asNumberKeyedEntries(raw.contactIdsByAcceptedIdx)
    if (contactEntries === null) return null
    const byIdx: [number, string[]][] = []
    for (const [idx, ids] of contactEntries) {
      const list = asStringList(ids)
      if (list === null) return null
      byIdx.push([idx, list])
    }
    ghost.contactIdsByAcceptedIdx = byIdx
  }
  return ghost
}

/**
 * Narrow the metadata delta.
 *
 * A key this build no longer knows is SKIPPED rather than fatal: a recovery
 * file written by an older build should still hand back the other five
 * at-risk items. A known key of the wrong type is fatal — that is corruption,
 * not version drift.
 */
function parseMetadataDraftPatch(value: unknown): ProjectMetadataDraft | null {
  const raw = asRecord(value)
  if (raw === null) return null
  const known = new Set<string>(PROJECT_METADATA_FIELDS)
  const patch: ProjectMetadataDraft = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (!known.has(key)) {
      log.warn('recovery', `recovery file carries unknown metadata field "${key}"; skipped`)
      continue
    }
    const field = key as ProjectMetadataField
    if (field === 'tags') {
      const tags = asStringList(entry)
      if (tags === null) return null
      patch.tags = tags
      continue
    }
    if (field === 'default_horizontal_epsg' || field === 'default_vertical_epsg') {
      if (entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry))) return null
      patch[field] = entry as number | null
      continue
    }
    // ``name`` and ``status`` are the two non-nullable strings; every other
    // remaining field is ``string | null``.
    if (field === 'name' || field === 'status') {
      if (typeof entry !== 'string') return null
      patch[field] = entry
      continue
    }
    if (entry !== null && typeof entry !== 'string') return null
    patch[field] = entry as string | null
  }
  return patch
}

/** Narrow an id-set group (manifests / session imports) against its keys. */
function parseIdGroup<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, string[]> | null {
  const raw = asRecord(value)
  if (raw === null) return null
  const group = {} as Record<K, string[]>
  for (const key of keys) {
    const ids = asStringList(raw[key])
    if (ids === null) return null
    group[key] = ids
  }
  return group
}

const MANIFEST_KEYS = ['cpt', 'borehole', 'formation', 'section'] as const
const SESSION_IMPORT_KEYS = ['cpt', 'borehole', 'formation', 'section', 'contact'] as const

/**
 * Does this snapshot record any database-visible work by the crashed session?
 *
 * Powers the Discard fast path (owner defect 2026-08-12: "Delete backup
 * holds the app busy for too long"): the pre-discard revert re-reads the
 * whole ``.strix`` and replace-restores the ENTIRE project tree, then the
 * post-discard reload re-opens it — tens of seconds of blocked dialog on a
 * real model. When the snapshot proves the session never touched the
 * database, both are semantic no-ops and the caller may skip them.
 *
 * Session-CREATED rows count as a delta: the replace-restore is what
 * REMOVES creates, so skipping while creates exist would leave them alive
 * after "the session never happened". The manifest sets count for the same
 * reason — a non-empty manifest records structure the last save does not
 * carry.
 *
 * Defensive default: a snapshot missing any of these fields — a legacy or
 * foreign payload the compiler never saw — counts as HAVING a delta. The
 * revert is never skipped on absence of evidence, so every unexpected shape
 * degrades to the slow-but-safe path.
 *
 * @param snapshot - A parsed recovery snapshot.
 * @returns ``true`` when discarding this backup requires the database
 *   revert; ``false`` only when the snapshot proves the DB already equals
 *   the last save.
 */
export function snapshotHasDbDelta(snapshot: RecoverySnapshotV1): boolean {
  // Read defensively even though the type promises every field: the whole
  // point of the default is surviving a payload TypeScript never checked.
  const raw = snapshot as Partial<RecoverySnapshotV1>
  // ``!== false`` on purpose: ``true`` AND ``undefined`` (field absent) both
  // mean the revert must run.
  if (raw.hasUnsavedMutations !== false) return true

  for (const [group, keys] of [
    [raw.manifests, MANIFEST_KEYS],
    [raw.sessionImports, SESSION_IMPORT_KEYS],
  ] as const) {
    const record = asRecord(group)
    if (record === null) return true
    for (const key of keys) {
      const ids = record[key]
      if (!Array.isArray(ids) || ids.length > 0) return true
    }
  }
  return false
}

/**
 * Narrow a recovery payload read back off disk.
 *
 * Never throws — a corrupt or foreign file must degrade to "no recovery
 * offer", not to a broken start screen. Every rejection logs the reason so a
 * user-reported "it didn't offer to restore" is diagnosable from the console.
 *
 * @param raw - Whatever ``window.electron.readRecovery`` returned.
 * @returns The validated snapshot, or ``null`` when it cannot be trusted.
 */
export function parseRecoverySnapshot(raw: unknown): RecoverySnapshotV1 | null {
  const refuse = (reason: string): null => {
    log.warn('recovery', `recovery snapshot refused: ${reason}`)
    return null
  }

  const record = asRecord(raw)
  if (record === null) return refuse('payload is not a JSON object')
  if (record.snapshot_version !== RECOVERY_SNAPSHOT_VERSION) {
    return refuse(`unsupported snapshot_version ${String(record.snapshot_version)}`)
  }
  if (record.filePath !== null && typeof record.filePath !== 'string') {
    return refuse('filePath is neither a string nor null')
  }

  const lumpingRecord = asRecord(record.lumping)
  if (lumpingRecord === null) return refuse('lumping is not a JSON object')
  const lumpingParse = parseStratigraphyLumping(lumpingRecord.current)
  if (!lumpingParse.ok) return refuse(`lumping.current ${lumpingParse.reason}`)
  const revision = lumpingRecord.revision
  if (revision !== null && (typeof revision !== 'number' || !Number.isFinite(revision))) {
    return refuse('lumping.revision is neither a number nor null')
  }

  if (!Array.isArray(record.ghosts)) return refuse('ghosts is not an array')
  const ghosts: [string, SerialisedAnchorGhost][] = []
  for (const pair of record.ghosts) {
    if (!Array.isArray(pair) || pair.length !== 2) return refuse('ghosts entry is not a pair')
    const [anchorId, rawGhost] = pair as [unknown, unknown]
    if (typeof anchorId !== 'string') return refuse('ghost anchor id is not a string')
    const ghost = parseGhost(rawGhost)
    if (ghost === null) return refuse(`ghost "${anchorId}" is malformed`)
    ghosts.push([anchorId, ghost])
  }

  const metadataDraftPatch = parseMetadataDraftPatch(record.metadataDraftPatch)
  if (metadataDraftPatch === null) return refuse('metadataDraftPatch is malformed')

  const manifests = parseIdGroup(record.manifests, MANIFEST_KEYS)
  if (manifests === null) return refuse('manifests are malformed')

  const sessionImports = parseIdGroup(record.sessionImports, SESSION_IMPORT_KEYS)
  if (sessionImports === null) return refuse('sessionImports are malformed')

  if (typeof record.hasUnsavedMutations !== 'boolean') {
    return refuse('hasUnsavedMutations is not a boolean')
  }

  // Rebuilt rather than passed through, so no unvalidated extra key rides
  // along into the restore path.
  return {
    snapshot_version: RECOVERY_SNAPSHOT_VERSION,
    filePath: record.filePath,
    lumping: { current: lumpingParse.lumping, revision: revision },
    ghosts,
    metadataDraftPatch,
    manifests,
    sessionImports,
    hasUnsavedMutations: record.hasUnsavedMutations,
  }
}
