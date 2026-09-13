/**
 * Tests for {@link resolveReconciliationSections} — giving a clause-7 finding a
 * "Show me" target by matching its section line to a cross-section row.
 */

import { describe, expect, it } from 'vitest'

import { resolveReconciliationSections, type SectionLine } from './resolveReconciliationSections'
import type { GaplessBuildReport } from './types'

const SECTIONS: SectionLine[] = [
  { id: 'cs1', name: 'Cross-section 1', start_x: 76552, start_y: 177906, end_x: 76756, end_y: 177858 },
  { id: 'tie3', name: 'Tie-section 3', start_x: 76622, start_y: 177967, end_x: 76632, end_y: 177903 },
]

function reportWith(params: Record<string, unknown> | null): GaplessBuildReport {
  return {
    verdict: 'fail',
    generated_at: '2026-09-13T00:00:00Z',
    clauses: [
      {
        key: 'section-reconciliation',
        number: 7,
        title: 'The 3-D model holds the ground its sections classed',
        status: 'fail',
        entries: [{ label: 'section 1 ...', ...(params ? { params } : {}) }],
      },
    ],
  }
}

describe('resolveReconciliationSections', () => {
  it('stamps the matching cross-section id and name onto a clause-7 finding', () => {
    const report = reportWith({
      section_index: 1,
      start_x: 76622,
      start_y: 177967,
      end_x: 76632,
      end_y: 177903,
    })
    const out = resolveReconciliationSections(report, SECTIONS)!
    const entry = out.clauses[0].entries[0]
    // Tie-section 3's line — the finding is now one press away.
    expect(entry.section_id).toBe('tie3')
    expect(entry.section_name).toBe('Tie-section 3')
  })

  it('leaves a finding whose line matches no section untouched (never guesses)', () => {
    const report = reportWith({
      section_index: 9,
      start_x: 99999,
      start_y: 99999,
      end_x: 88888,
      end_y: 88888,
    })
    const out = resolveReconciliationSections(report, SECTIONS)!
    expect(out.clauses[0].entries[0].section_id).toBeUndefined()
  })

  it('leaves a finding with no params untouched', () => {
    const report = reportWith(null)
    const out = resolveReconciliationSections(report, SECTIONS)!
    expect(out.clauses[0].entries[0].section_id).toBeUndefined()
  })

  it('returns null unchanged', () => {
    expect(resolveReconciliationSections(null, SECTIONS)).toBeNull()
  })
})
