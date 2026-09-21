import { describe, expect, it } from 'vitest'

import {
  assessEmptyBundleGuard,
  countBundleCollections,
  describeEmptyBundleFindings,
  type BundleCollectionCounts,
} from './saveBundleGuard'

// Debt #225 — "Save must never silently write a 0-edge bundle when the model
// has edges." The pure half of the guard, pinned in the ruling's own words:
// the observed failure was a fresh bundle that returned
// ``litho_contact_correlation_edges: []`` while the model actually held 481
// edges, and the save silently wrote the empty file over the user's data.

/** All-zero counts, so a test states only the collections it cares about. */
function zeroCounts(): BundleCollectionCounts {
  return {
    litho_contact_correlation_edges: 0,
    litho_layers: 0,
    formation_contacts: 0,
    bodies: 0,
    cpts: 0,
    boreholes: 0,
    geological_formations: 0,
    cross_sections: 0,
  }
}

describe('assessEmptyBundleGuard', () => {
  it('flags a 0-edge bundle when the model has edges', () => {
    // The exact observed shape: the fresh export returned no correlation
    // edges while the app knows the model holds 481.
    const fetched = zeroCounts()
    const findings = assessEmptyBundleGuard(fetched, {
      litho_contact_correlation_edges: 481,
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual({
      collection: 'litho_contact_correlation_edges',
      expected: 481,
      fetched: 0,
    })
  })

  it('lets a genuinely empty project through — 0 everywhere expects nothing', () => {
    const findings = assessEmptyBundleGuard(zeroCounts(), {
      litho_contact_correlation_edges: 0,
      litho_layers: 0,
      formation_contacts: 0,
      bodies: 0,
      cpts: 0,
      boreholes: 0,
      geological_formations: 0,
      cross_sections: 0,
    })
    expect(findings).toEqual([])
  })

  it('passes a bundle whose counts match what the app holds', () => {
    const fetched: BundleCollectionCounts = {
      ...zeroCounts(),
      litho_contact_correlation_edges: 481,
      litho_layers: 40,
      bodies: 12,
      cpts: 100,
      cross_sections: 3,
    }
    const findings = assessEmptyBundleGuard(fetched, {
      litho_contact_correlation_edges: 481,
      litho_layers: 40,
      bodies: 12,
      cpts: 100,
      cross_sections: 3,
    })
    expect(findings).toEqual([])
  })

  it('does not guard a collection whose expected count is unknown', () => {
    // Before the first open the interpretation counts are unknown; an
    // undefined expected must never abort a save — a false abort on a count
    // the app cannot reason about is worse than the transient bug.
    const findings = assessEmptyBundleGuard(zeroCounts(), {
      litho_contact_correlation_edges: undefined,
    })
    expect(findings).toEqual([])
  })

  it('flags several collections at once and keeps the stable order', () => {
    const findings = assessEmptyBundleGuard(zeroCounts(), {
      bodies: 12,
      litho_contact_correlation_edges: 481,
      cross_sections: 3,
    })
    expect(findings.map(f => f.collection)).toEqual([
      'litho_contact_correlation_edges',
      'bodies',
      'cross_sections',
    ])
  })
})

describe('countBundleCollections', () => {
  it('sums litho layers and formation contacts across every model', () => {
    const counts = countBundleCollections({
      litho_contact_correlation_edges: [{}, {}],
      bodies: [{}],
      cpts: [{}, {}, {}],
      geological_models: [
        { kind: 'geological', contacts: [{}, {}] },
        { kind: 'lithostratigraphic', litho_layers: [{}, {}, {}] },
      ],
    } as Parameters<typeof countBundleCollections>[0])
    expect(counts.litho_contact_correlation_edges).toBe(2)
    expect(counts.bodies).toBe(1)
    expect(counts.cpts).toBe(3)
    expect(counts.formation_contacts).toBe(2)
    expect(counts.litho_layers).toBe(3)
  })

  it('treats missing arrays as zero rather than throwing', () => {
    const counts = countBundleCollections({})
    expect(counts).toEqual({
      litho_contact_correlation_edges: 0,
      litho_layers: 0,
      formation_contacts: 0,
      bodies: 0,
      cpts: 0,
      boreholes: 0,
      geological_formations: 0,
      cross_sections: 0,
    })
  })
})

describe('describeEmptyBundleFindings', () => {
  it('names each collection with both counts for the warning log', () => {
    const line = describeEmptyBundleFindings([
      { collection: 'litho_contact_correlation_edges', expected: 481, fetched: 0 },
      { collection: 'bodies', expected: 12, fetched: 0 },
    ])
    expect(line).toBe(
      'litho_contact_correlation_edges expected 481 got 0, bodies expected 12 got 0',
    )
  })
})
