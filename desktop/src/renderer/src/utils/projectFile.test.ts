// Tests for the sole gatekeeper that decides whether an on-disk .strix
// (formerly .gmproj) project file is safe to open. The contract these tests
// pin, in the file's own vocabulary:
//
//   * A well-formed version-3 file parses and hands back every field the
//     open flow relies on (project block + the data/decision arrays).
//   * The on-disk format is version 3. The desktop deliberately writes 3 even
//     though the backend bundle is version 4 — so a file claiming version 4
//     (or any version other than 3) must be REJECTED down the "may be
//     corrupt / re-save from a current build" path, never silently opened.
//   * Structural garbage (non-JSON, a JSON array/number/null, an empty file)
//     is rejected rather than throwing.
//   * A file missing any required top-level key is rejected.
//   * Additive keys that landed after the version-3 floor are tolerated when
//     absent (backfilled to their empty shape) — the repo's additive-compat
//     rule — but rejected when present with the wrong type.
//   * The project id is the file's anchor; pulling it back out fails loudly
//     when it is not a string.

import { describe, expect, it } from 'vitest'

import {
  PROJECT_FILE_FORMAT_VERSION,
  buildProjectFile,
  defaultProjectFileName,
  parseProjectFile,
  projectIdFromFile,
  projectResponseFromFile,
  serialiseProjectFile,
} from './projectFile'
import type { ProjectFileV3, StratigraphyLumping } from './projectFile'
import type { ProjectBundleResponse } from '../api/client'

// A minimal, well-formed version-3 file: the exact shape the open flow
// expects to read back off disk. Every required array is present; the
// additive arrays are present too so this stands in for a file saved by a
// current build.
function makeWellFormedV3(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format_version: 3,
    project: { id: 'proj-uuid-123', name: 'Antwerp quay 7' },
    cpts: [{ id: 'cpt-1' }],
    boreholes: [{ id: 'bh-1' }],
    geological_formations: [{ id: 'fm-1' }],
    geological_models: [{ id: 'gm-1', contacts: [] }],
    cross_sections: [{ id: 'cs-1' }],
    investigation_reviews: [{ id: 'rev-1' }],
    litho_contact_correlation_edges: [{ id: 'edge-1' }],
    bodies: [{ id: 'body-1' }],
    formation_absences: [{ id: 'absence-1' }],
    body_boundary_shapes: [{ id: 'shape-1' }],
    body_boundary_nodes: [{ id: 'node-1' }],
    body_geometry_facts: [{ id: 'fact-1' }],
    stratigraphy_lumping: null,
    ...overrides,
  }
}

// The six keys whose absence must make the type guard reject the file.
// (The additive keys are covered separately — they tolerate absence.)
const REQUIRED_ARRAY_KEYS = [
  'cpts',
  'boreholes',
  'geological_formations',
  'geological_models',
  'cross_sections',
  'investigation_reviews',
] as const

describe('parseProjectFile — happy path', () => {
  it('parses a well-formed version-3 file and rounds every field back to the caller', () => {
    const raw = JSON.stringify(makeWellFormedV3())
    const parsed = parseProjectFile(raw)

    expect(parsed).not.toBeNull()
    // Fields the open flow reads back verbatim.
    expect(parsed?.format_version).toBe(3)
    expect(parsed?.project).toEqual({ id: 'proj-uuid-123', name: 'Antwerp quay 7' })
    expect(parsed?.cpts).toEqual([{ id: 'cpt-1' }])
    expect(parsed?.boreholes).toEqual([{ id: 'bh-1' }])
    expect(parsed?.geological_formations).toEqual([{ id: 'fm-1' }])
    expect(parsed?.geological_models).toEqual([{ id: 'gm-1', contacts: [] }])
    expect(parsed?.cross_sections).toEqual([{ id: 'cs-1' }])
    expect(parsed?.investigation_reviews).toEqual([{ id: 'rev-1' }])
    expect(parsed?.litho_contact_correlation_edges).toEqual([{ id: 'edge-1' }])
    expect(parsed?.bodies).toEqual([{ id: 'body-1' }])
    expect(parsed?.formation_absences).toEqual([{ id: 'absence-1' }])
    expect(parsed?.body_boundary_shapes).toEqual([{ id: 'shape-1' }])
    expect(parsed?.body_boundary_nodes).toEqual([{ id: 'node-1' }])
    expect(parsed?.body_geometry_facts).toEqual([{ id: 'fact-1' }])
    expect(parsed?.stratigraphy_lumping).toBeNull()
  })

  it('carries the geometric body-identity facts from the bundle into the file', () => {
    // Owner ruling 2026-08-12: "every same litho that is connected should get
    // the same body id — how else are we going to extract qc or sample data by
    // body". Those unions are EVIDENCE, not a rebuildable cache: a file that
    // drops them reopens with every merged body split apart again, silently.
    // Asserted against the BUNDLE's value, not against the writer's own
    // output, so a writer that forgets the key cannot pass by agreeing with
    // itself.
    const facts = [
      { id: 'fact-a', model_id: 'gm-1', layer_a_id: 'layer-1', layer_b_id: 'layer-2' },
      { id: 'fact-b', model_id: 'gm-1', layer_a_id: 'layer-2', layer_b_id: 'layer-3' },
    ]
    const bundle = {
      project: { id: 'proj-uuid-facts', name: 'Facts survive' },
      cpts: [],
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
      body_geometry_facts: facts,
    } as unknown as ProjectBundleResponse

    const built = buildProjectFile(bundle, null)
    expect(built.body_geometry_facts).toEqual(facts)

    // …and back off disk unchanged, which is the half the user actually feels.
    const parsed = parseProjectFile(serialiseProjectFile(built))
    expect(parsed?.body_geometry_facts).toEqual(facts)
  })

  it('geotech tie tombstones survive the bundle → file → parse round-trip', () => {
    // The deletion memory (owner 2026-08-17: "a tie i delete stays deleted")
    // is EVIDENCE, exactly like the geometry facts above: a save/open loop
    // that drops it resurrects every tie the engineer deleted, on the next
    // press, silently. Audit P1-1 (2026-08-18) found precisely this hole —
    // the backend carried the tombstones and the desktop dropped them at
    // every surface. Asserted against the BUNDLE's value, not the writer's
    // own output.
    const stones = [
      { id: 'ts-a', model_id: 'gm-1', section_id: 's-1', a_x: 1, a_y: 2, a_z: 3, b_x: 4, b_y: 5, b_z: 6 },
    ]
    const bundle = {
      project: { id: 'proj-uuid-stones', name: 'Tombstones survive' },
      cpts: [],
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
      geotech_tie_tombstones: stones,
    } as unknown as ProjectBundleResponse

    const built = buildProjectFile(bundle, null)
    expect(built.geotech_tie_tombstones).toEqual(stones)
    const parsed = parseProjectFile(serialiseProjectFile(built))
    expect(parsed?.geotech_tie_tombstones).toEqual(stones)
  })

  it('body separations survive the bundle → file → parse round-trip', () => {
    // Debt #278 R5: the "Separate" rulings ("these two are NOT the same body")
    // are EVIDENCE, exactly like the geometry facts + tombstones above — a
    // save/open loop that drops them re-merges every body the engineer split,
    // silently, on the next resolve. The desktop writer is a whitelist, so the
    // key has to be named at every surface or it is lost. Asserted against the
    // BUNDLE's value, not the writer's own output.
    const seps = [
      { id: 'sep-a', model_id: 'gm-1', layer_a_id: 'layer-1', layer_b_id: 'layer-2' },
      { id: 'sep-b', model_id: 'gm-1', layer_a_id: 'layer-3', layer_b_id: 'layer-4' },
    ]
    const bundle = {
      project: { id: 'proj-uuid-seps', name: 'Separations survive' },
      cpts: [],
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
      body_separations: seps,
    } as unknown as ProjectBundleResponse

    const built = buildProjectFile(bundle, null)
    expect(built.body_separations).toEqual(seps)
    const parsed = parseProjectFile(serialiseProjectFile(built))
    expect(parsed?.body_separations).toEqual(seps)
  })

  it('body unions survive the bundle → file → parse round-trip', () => {
    // Debt #278 (the "Join with…" verb, owner ruling 2026-08-31): the must-link
    // "these two ARE the same body" unions are EVIDENCE, exactly like the geometry
    // facts + separations above — a save/open loop that drops them re-splits every
    // body the engineer joined, silently, on the next resolve. The desktop writer
    // is a whitelist, so the key has to be named at every surface or it is lost.
    // Asserted against the BUNDLE's value, not the writer's own output.
    const unions = [
      { id: 'union-a', model_id: 'gm-1', layer_a_id: 'layer-1', layer_b_id: 'layer-2' },
      { id: 'union-b', model_id: 'gm-1', layer_a_id: 'layer-3', layer_b_id: 'layer-4' },
    ]
    const bundle = {
      project: { id: 'proj-uuid-unions', name: 'Unions survive' },
      cpts: [],
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
      body_unions: unions,
    } as unknown as ProjectBundleResponse

    const built = buildProjectFile(bundle, null)
    expect(built.body_unions).toEqual(unions)
    const parsed = parseProjectFile(serialiseProjectFile(built))
    expect(parsed?.body_unions).toEqual(unions)
  })

  it('round-trips through serialise → parse without losing a field', () => {
    // What buildProjectFile writes must be exactly what parseProjectFile
    // reads back — the save/open loop the user's anchor depends on.
    const bundle: ProjectBundleResponse = {
      project: { id: 'proj-uuid-xyz', name: 'Round trip' },
      cpts: [{ id: 'cpt-a' }],
      boreholes: [{ id: 'bh-a' }],
      geological_formations: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
      litho_contact_correlation_edges: [],
      bodies: [],
      formation_absences: [],
      body_boundary_shapes: [],
      body_boundary_nodes: [],
    } as unknown as ProjectBundleResponse

    const lumping: StratigraphyLumping = {
      schema_version: 1,
      applied_at: '2026-07-13T00:00:00Z',
      map: { klei: 'Boom Clay' },
    }

    const built = buildProjectFile(bundle, lumping)
    const parsed = parseProjectFile(serialiseProjectFile(built))

    expect(parsed).toEqual(built)
    expect(parsed?.format_version).toBe(PROJECT_FILE_FORMAT_VERSION)
    expect(parsed?.stratigraphy_lumping).toEqual(lumping)
  })

  it('accepts a stratigraphy_lumping object whose schema_version is 1', () => {
    const raw = JSON.stringify(
      makeWellFormedV3({
        stratigraphy_lumping: {
          schema_version: 1,
          applied_at: '2026-05-17T12:00:00Z',
          map: { z: 'Sand' },
        },
      }),
    )
    const parsed = parseProjectFile(raw)
    expect(parsed?.stratigraphy_lumping).toEqual({
      schema_version: 1,
      applied_at: '2026-05-17T12:00:00Z',
      map: { z: 'Sand' },
    })
  })
})

describe('parseProjectFile — format_version guards', () => {
  it('rejects a version-4 file (the backend bundle version is never written to disk)', () => {
    // The critical guard: the on-disk format is 3. A file that claims 4 is
    // the backend bundle shape leaking to disk and must NOT open — it goes
    // down the "may be corrupt" path so the user re-saves from a current build.
    const raw = JSON.stringify(makeWellFormedV3({ format_version: 4 }))
    expect(parseProjectFile(raw)).toBeNull()
  })

  it('rejects a missing format_version', () => {
    const file = makeWellFormedV3()
    delete file.format_version
    expect(parseProjectFile(JSON.stringify(file))).toBeNull()
  })

  it('rejects absurd / pre-3 / non-numeric versions', () => {
    for (const version of [0, 1, 2, 5, 99, -3, 3.5, '3', null, true]) {
      const raw = JSON.stringify(makeWellFormedV3({ format_version: version }))
      expect(parseProjectFile(raw)).toBeNull()
    }
  })

  it('requires format_version to be the number 3, not the string "3"', () => {
    // JSON round-trips the string as a string; the guard uses strict equality.
    const raw = JSON.stringify(makeWellFormedV3({ format_version: '3' }))
    expect(parseProjectFile(raw)).toBeNull()
  })
})

describe('parseProjectFile — structural garbage', () => {
  it('returns null (does not throw) on non-JSON text', () => {
    expect(parseProjectFile('this is not json {')).toBeNull()
    expect(parseProjectFile('<xml>nope</xml>')).toBeNull()
  })

  it('returns null on an empty string', () => {
    expect(parseProjectFile('')).toBeNull()
  })

  it('returns null on whitespace-only content', () => {
    expect(parseProjectFile('   \n\t  ')).toBeNull()
  })

  it('rejects JSON that is valid but not an object (array / number / string / null / bool)', () => {
    // Each of these is valid JSON yet cannot be a project file.
    expect(parseProjectFile('[]')).toBeNull()
    expect(parseProjectFile('[1,2,3]')).toBeNull()
    expect(parseProjectFile('42')).toBeNull()
    expect(parseProjectFile('"a string"')).toBeNull()
    expect(parseProjectFile('null')).toBeNull()
    expect(parseProjectFile('true')).toBeNull()
  })

  it('rejects an empty JSON object', () => {
    expect(parseProjectFile('{}')).toBeNull()
  })
})

describe('parseProjectFile — missing required top-level keys', () => {
  it('rejects a file missing the project block', () => {
    const file = makeWellFormedV3()
    delete file.project
    expect(parseProjectFile(JSON.stringify(file))).toBeNull()
  })

  it('rejects a file whose project block is null', () => {
    const raw = JSON.stringify(makeWellFormedV3({ project: null }))
    expect(parseProjectFile(raw)).toBeNull()
  })

  it('rejects a file whose project block is a non-object primitive', () => {
    for (const bad of ['a string', 42, true]) {
      const raw = JSON.stringify(makeWellFormedV3({ project: bad }))
      expect(parseProjectFile(raw)).toBeNull()
    }
  })

  it('rejects a file whose project block is an ARRAY', () => {
    // A corrupt file must be rejected AT the gatekeeper ("may be corrupt"
    // dialog), not one layer later: `typeof [] === 'object'` is true in JS,
    // so without an explicit Array.isArray check an array-shaped project
    // block used to slip through and only blow up in projectIdFromFile.
    const raw = JSON.stringify(makeWellFormedV3({ project: ['array'] }))
    expect(parseProjectFile(raw)).toBeNull()
  })

  it('rejects a file missing any one of the six required data/decision arrays', () => {
    for (const key of REQUIRED_ARRAY_KEYS) {
      const file = makeWellFormedV3()
      delete file[key]
      expect(parseProjectFile(JSON.stringify(file))).toBeNull()
    }
  })

  it('rejects a file where a required array is present but the wrong type', () => {
    for (const key of REQUIRED_ARRAY_KEYS) {
      // A single object instead of an array is the most likely corruption.
      const raw = JSON.stringify(makeWellFormedV3({ [key]: { not: 'an array' } }))
      expect(parseProjectFile(raw)).toBeNull()
    }
  })
})

describe('parseProjectFile — additive keys tolerate absence, reject wrong type', () => {
  const ADDITIVE_ARRAY_KEYS = [
    'litho_contact_correlation_edges',
    'bodies',
    'formation_absences',
    'body_boundary_shapes',
    'body_boundary_nodes',
    // Additive too: a file written before the facts shipped simply has none,
    // and must still open — with the merges absent rather than the file
    // rejected.
    'body_geometry_facts',
    // Deleted-tie tombstones (owner 2026-08-17: "a tie i delete stays
    // deleted"). Same evidence class as the facts: a file without them
    // reopens with every deletion forgotten, and the next derivation
    // resurrects the deleted ties.
    'geotech_tie_tombstones',
    // Body separations (debt #278 R5): "these two are NOT the same body".
    // Additive — a file written before the verb shipped simply has none, and
    // must open with the split forgotten rather than be rejected.
    'body_separations',
    // Body unions (debt #278): "these two ARE the same body" (the Join verb).
    // Additive — a file written before the verb shipped simply has none, and
    // must open with the join forgotten rather than be rejected.
    'body_unions',
  ] as const

  it('backfills each absent additive array to [] so downstream array consumers never see undefined', () => {
    for (const key of ADDITIVE_ARRAY_KEYS) {
      const file = makeWellFormedV3()
      delete file[key]
      const parsed = parseProjectFile(JSON.stringify(file))
      expect(parsed).not.toBeNull()
      expect(parsed?.[key as keyof ProjectFileV3]).toEqual([])
    }
  })

  it('backfills absent stratigraphy_lumping to null', () => {
    const file = makeWellFormedV3()
    delete file.stratigraphy_lumping
    const parsed = parseProjectFile(JSON.stringify(file))
    expect(parsed).not.toBeNull()
    expect(parsed?.stratigraphy_lumping).toBeNull()
  })

  it('tolerates a file missing every additive key at once (an older but valid v3 file)', () => {
    const file = makeWellFormedV3()
    for (const key of [...ADDITIVE_ARRAY_KEYS, 'stratigraphy_lumping']) {
      delete file[key]
    }
    const parsed = parseProjectFile(JSON.stringify(file))
    expect(parsed).not.toBeNull()
    for (const key of ADDITIVE_ARRAY_KEYS) {
      expect(parsed?.[key as keyof ProjectFileV3]).toEqual([])
    }
    expect(parsed?.stratigraphy_lumping).toBeNull()
  })

  it('rejects a file where an additive array is present but the wrong type', () => {
    for (const key of ADDITIVE_ARRAY_KEYS) {
      const raw = JSON.stringify(makeWellFormedV3({ [key]: { not: 'array' } }))
      expect(parseProjectFile(raw)).toBeNull()
    }
  })

  it('rejects a stratigraphy_lumping whose schema_version is not 1', () => {
    // Only schema_version === 1 is a known shape; anything else is unreadable.
    const raw = JSON.stringify(
      makeWellFormedV3({
        stratigraphy_lumping: { schema_version: 2, applied_at: 'x', map: {} },
      }),
    )
    expect(parseProjectFile(raw)).toBeNull()
  })

  it('rejects a stratigraphy_lumping that is a non-null primitive', () => {
    for (const bad of ['a string', 42, true, ['array']]) {
      const raw = JSON.stringify(makeWellFormedV3({ stratigraphy_lumping: bad }))
      expect(parseProjectFile(raw)).toBeNull()
    }
  })
})

describe('parseProjectFile — unknown / extra keys (additive-tolerance)', () => {
  it('tolerates unknown extra top-level keys and passes them through', () => {
    // The repo rule is additive-compat: an unknown key written by a future
    // build must not stop an older reader from opening the file. Pin that the
    // extra key survives on the parsed object rather than being stripped.
    const raw = JSON.stringify(
      makeWellFormedV3({ some_future_field: { hello: 'world' }, another: [1, 2] }),
    )
    const parsed = parseProjectFile(raw)
    expect(parsed).not.toBeNull()
    expect((parsed as unknown as Record<string, unknown>).some_future_field).toEqual({
      hello: 'world',
    })
    expect((parsed as unknown as Record<string, unknown>).another).toEqual([1, 2])
  })
})

describe('parseProjectFile — mutation of the parsed object', () => {
  it('backfilled arrays are real arrays on the returned object (safe for consumers)', () => {
    // NOTE: parseProjectFile mutates the freshly-JSON.parsed candidate in place
    // when backfilling absent additive keys, rather than returning a copy. This
    // is harmless because the candidate is created fresh inside the function
    // (no shared reference escapes), but pinning it documents the current
    // behaviour so a future "return a clone" refactor is a conscious choice.
    const file = makeWellFormedV3()
    delete file.bodies
    const parsed = parseProjectFile(JSON.stringify(file))
    expect(Array.isArray(parsed?.bodies)).toBe(true)
  })
})

describe('projectIdFromFile', () => {
  it('returns the string id from the project block', () => {
    const parsed = parseProjectFile(JSON.stringify(makeWellFormedV3()))
    expect(projectIdFromFile(parsed as ProjectFileV3)).toBe('proj-uuid-123')
  })

  it('throws when project.id is missing or not a string', () => {
    for (const badId of [undefined, 42, null, ['a'], { nested: 'obj' }]) {
      const project: Record<string, unknown> = { name: 'no id' }
      if (badId !== undefined) project.id = badId
      const parsed = parseProjectFile(JSON.stringify(makeWellFormedV3({ project })))
      // The file itself is valid (project is an object); only the id lookup fails.
      expect(parsed).not.toBeNull()
      expect(() => projectIdFromFile(parsed as ProjectFileV3)).toThrow(/string id/)
    }
  })
})

describe('projectResponseFromFile', () => {
  it('returns the project block verbatim as a partial ProjectResponse', () => {
    const parsed = parseProjectFile(JSON.stringify(makeWellFormedV3()))
    expect(projectResponseFromFile(parsed as ProjectFileV3)).toEqual({
      id: 'proj-uuid-123',
      name: 'Antwerp quay 7',
    })
  })
})

describe('defaultProjectFileName', () => {
  it('appends the .strix extension to a clean project name', () => {
    expect(defaultProjectFileName('Antwerp')).toBe('Antwerp.strix')
  })

  it('replaces Windows-forbidden filename characters with underscores', () => {
    expect(defaultProjectFileName('a/b:c*d?')).toBe('a_b_c_d_.strix')
  })

  it('falls back to "project" when the name reduces to empty', () => {
    expect(defaultProjectFileName('   ')).toBe('project.strix')
    expect(defaultProjectFileName('')).toBe('project.strix')
  })
})
