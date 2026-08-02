import { describe, expect, it } from 'vitest'

import {
  RECOVERY_SNAPSHOT_VERSION,
  buildRecoverySnapshot,
  ghostsFromSnapshot,
  parseRecoverySnapshot,
} from './recoverySnapshot'
import type { RecoverySnapshotInputs } from './recoverySnapshot'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import type { ProjectResponse } from '../api/client'

// The capture half of crash recovery (docs/design/autosave-recovery.md §2).
//
// Behaviour under test, in the design's own words:
//   * The six at-risk items are what a crash destroys, so all six must
//     survive a round trip through a file on disk.
//   * The ghost workspace is "irreproducible human triage" — the edits,
//     rejections and accept bookkeeping are the part that matters, and they
//     are held in Sets and Maps that "silently serialise to {}" unless they
//     are converted explicitly.
//   * The recovery file comes back off disk, so the reader treats it as
//     untrusted: a version it does not know, or a field of the wrong shape,
//     is refused rather than half-restored.
//   * Only the metadata DELTA is carried — the saved values are already
//     durable, so shadow-copying them protects nothing.

const SAVED_PROJECT: ProjectResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Kanaal Noord',
  project_number: 'P-1',
  client: 'Waterwegen',
  site_label: null,
  description: null,
  tags: ['dredging'],
  default_horizontal_epsg: 31370,
  default_vertical_epsg: 5710,
  phase: null,
  status: 'active',
  archived_at: null,
  created_at: '2026-08-02T09:00:00Z',
  updated_at: '2026-08-02T09:00:00Z',
  view_state: {},
}

/** One anchor's ghost workspace with every collection field populated. */
function ghost(): BulkAnchorGhost {
  return {
    kind: 'cpt',
    suggestions: [
      {
        depth_top_m: 0,
        depth_base_m: 2.5,
        suggested_lithology: 'ZAND',
        suggested_nad_class: 7,
        mean_qc_mpa: 12.3,
        dr_pct: 61,
        confidence: 'high',
        source: 'segmenter',
        suggested_admixtures: [],
        parent_formation_id: null,
        spans_boundary: false,
      },
    ],
    surfaceElevationM: 4.2,
    accepted: new Set([0, 3]),
    rejected: new Set([1]),
    edits: new Map([
      [2, { depth_base_m: 5.75, suggested_lithology: 'KLEI' }],
      // The internal cross-merge marker: "never persisted to the server".
      [4, { depth_top_m: 6, _propagateOnly: true }],
    ]),
    contactIdsByAcceptedIdx: new Map([[0, ['c-1', 'c-2'] as readonly string[]]]),
  }
}

/** Inputs standing for a session with all six at-risk items populated. */
function inputs(overrides: Partial<RecoverySnapshotInputs> = {}): RecoverySnapshotInputs {
  return {
    filePath: 'C:/projects/kanaal.strix',
    project: { ...SAVED_PROJECT, name: 'Kanaal Noord (rev B)', tags: ['dredging', 'quay'] },
    saved: SAVED_PROJECT,
    currentLumping: { schema_version: 1, applied_at: '2026-08-02T11:00:00Z', map: { A: 'B' } },
    lumpingRevision: 7,
    ghostsByAnchor: new Map([['anchor-1', ghost()]]),
    manifestCptIds: new Set(['cpt-1']),
    manifestBoreholeIds: new Set(['bh-1']),
    manifestFormationIds: new Set(),
    manifestSectionIds: new Set(['sec-1']),
    sessionImportCptIds: new Set(['cpt-1']),
    sessionImportBoreholeIds: new Set(),
    sessionImportFormationIds: new Set(),
    sessionImportSectionIds: new Set(),
    sessionImportContactIds: new Set(['ct-9']),
    hasUnsavedMutations: true,
    ...overrides,
  }
}

/** Encode → write to disk → read back → decode, exactly as the app does. */
function roundTrip(source: RecoverySnapshotInputs = inputs()) {
  const written = JSON.stringify(buildRecoverySnapshot(source))
  return parseRecoverySnapshot(JSON.parse(written))
}

describe('recovery snapshot round trip', () => {
  it('carries the ghost workspace back with its accepted / rejected / edits intact', () => {
    const parsed = roundTrip()
    expect(parsed).not.toBeNull()

    const ghosts = ghostsFromSnapshot(parsed!)
    const restored = ghosts.get('anchor-1')
    expect(restored).toBeDefined()
    expect(restored!.kind).toBe('cpt')
    expect(restored!.surfaceElevationM).toBe(4.2)
    expect(Array.from(restored!.accepted)).toEqual([0, 3])
    expect(Array.from(restored!.rejected)).toEqual([1])
    expect(restored!.edits.get(2)).toEqual({ depth_base_m: 5.75, suggested_lithology: 'KLEI' })
    expect(Array.from(restored!.contactIdsByAcceptedIdx!.get(0)!)).toEqual(['c-1', 'c-2'])
    // The suggestions themselves are re-derivable, but they must still
    // arrive intact — the edits are indexed against them.
    expect(restored!.suggestions[0].suggested_lithology).toBe('ZAND')
  })

  it('strips the internal propagate-only marker instead of persisting it', () => {
    const parsed = roundTrip()
    const restored = ghostsFromSnapshot(parsed!).get('anchor-1')!
    expect(restored.edits.get(4)).toEqual({ depth_top_m: 6 })
    expect(Object.prototype.hasOwnProperty.call(restored.edits.get(4)!, '_propagateOnly')).toBe(
      false,
    )
  })

  it('carries only the metadata fields that differ from the last save', () => {
    const parsed = roundTrip()
    expect(parsed!.metadataDraftPatch).toEqual({
      name: 'Kanaal Noord (rev B)',
      tags: ['dredging', 'quay'],
    })
  })

  it('carries the lumping map with the revision that reconciliation compares', () => {
    const parsed = roundTrip()
    expect(parsed!.lumping.revision).toBe(7)
    expect(parsed!.lumping.current?.map).toEqual({ A: 'B' })
  })

  it('carries the manifests, the session-import sets and the dirty boolean', () => {
    const parsed = roundTrip()
    expect(parsed!.manifests).toEqual({
      cpt: ['cpt-1'],
      borehole: ['bh-1'],
      formation: [],
      section: ['sec-1'],
    })
    expect(parsed!.sessionImports.cpt).toEqual(['cpt-1'])
    expect(parsed!.sessionImports.contact).toEqual(['ct-9'])
    expect(parsed!.hasUnsavedMutations).toBe(true)
    expect(parsed!.filePath).toBe('C:/projects/kanaal.strix')
    expect(parsed!.snapshot_version).toBe(RECOVERY_SNAPSHOT_VERSION)
  })

  it('keeps an empty session clean rather than inventing entries', () => {
    const parsed = roundTrip(
      inputs({
        project: SAVED_PROJECT,
        ghostsByAnchor: new Map(),
        currentLumping: null,
        lumpingRevision: null,
        hasUnsavedMutations: false,
      }),
    )
    expect(parsed!.metadataDraftPatch).toEqual({})
    expect(parsed!.ghosts).toEqual([])
    expect(parsed!.lumping).toEqual({ current: null, revision: null })
  })
})

describe('parseRecoverySnapshot refuses what it cannot trust', () => {
  it('refuses a payload with no version', () => {
    expect(parseRecoverySnapshot({ ghosts: [] })).toBeNull()
  })

  it('refuses a payload written by a newer snapshot version', () => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as Record<
      string,
      unknown
    >
    raw.snapshot_version = 2
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  it('refuses a non-object payload', () => {
    expect(parseRecoverySnapshot(null)).toBeNull()
    expect(parseRecoverySnapshot('{}')).toBeNull()
    expect(parseRecoverySnapshot([])).toBeNull()
  })

  it('refuses a ghost whose accepted indices are not numbers', () => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      ghosts: [string, { accepted: unknown }][]
    }
    raw.ghosts[0][1].accepted = ['0']
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  // The suggestion rows ride through as opaque DTOs, but their two depths are
  // GEOMETRY the overlay draws with: an unchecked one comes back as a NaN
  // band on screen rather than as a caught error, which is the failure the
  // codec's refuse-don't-repair stance exists to prevent.
  it.each([
    ['NaN', Number.NaN],
    ['a string', '2.5'],
    ['null', null],
  ])('refuses a ghost whose suggestion depth is %s', (_label, badDepth) => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      ghosts: [string, { suggestions: Record<string, unknown>[] }][]
    }
    // JSON.stringify already turns NaN into null; assign after the round trip
    // so the value under test is the one that reaches the parser.
    raw.ghosts[0][1].suggestions[0].depth_base_m = badDepth
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  it('refuses a ghost whose suggestion is missing a depth entirely', () => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      ghosts: [string, { suggestions: Record<string, unknown>[] }][]
    }
    delete raw.ghosts[0][1].suggestions[0].depth_top_m
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  it('still passes an unknown suggestion field through — the DTO is not re-encoded here', () => {
    // The depths are the only fields checked; a suggestion field this build
    // does not know must not cost the whole recovery file, because the
    // segmenter's DTO grows independently of the codec.
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      ghosts: [string, { suggestions: Record<string, unknown>[] }][]
    }
    raw.ghosts[0][1].suggestions[0].some_future_field = { nested: true }
    const parsed = parseRecoverySnapshot(raw)
    expect(parsed).not.toBeNull()
    expect(
      (parsed!.ghosts[0][1].suggestions[0] as unknown as Record<string, unknown>)
        .some_future_field,
    ).toEqual({ nested: true })
  })

  it('refuses a manifest that is not a list of ids', () => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      manifests: Record<string, unknown>
    }
    raw.manifests.cpt = 'cpt-1'
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  it('refuses a metadata patch field of the wrong type', () => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      metadataDraftPatch: Record<string, unknown>
    }
    raw.metadataDraftPatch.name = 42
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  it('refuses a lumping map whose entries are not strings', () => {
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      lumping: { current: { map: Record<string, unknown> } }
    }
    raw.lumping.current.map.A = 3
    expect(parseRecoverySnapshot(raw)).toBeNull()
  })

  it('drops a metadata field the app no longer has rather than the whole snapshot', () => {
    // A recovery file written by an older build can carry a field this
    // build removed. The other five at-risk items are still worth
    // restoring, so the unknown key is skipped, not fatal.
    const raw = JSON.parse(JSON.stringify(buildRecoverySnapshot(inputs()))) as {
      metadataDraftPatch: Record<string, unknown>
    }
    raw.metadataDraftPatch.retired_field = 'gone'
    const parsed = parseRecoverySnapshot(raw)
    expect(parsed).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(parsed!.metadataDraftPatch, 'retired_field')).toBe(
      false,
    )
    expect(parsed!.metadataDraftPatch.name).toBe('Kanaal Noord (rev B)')
  })
})
