// Regression anchors for PerUnitTab Phase-5 placeholder accessibility
// (debt #115 sub-item 5).
//
// AU1 — PhaseFiveHeader cells have aria-disabled="true".
// AU2 — PhaseFiveHeader cells have a descriptive aria-label including the
//        parameter name and "Phase 5".
// AU3 — PhaseFiveCell data cells have aria-disabled="true".
// AU4 — PhaseFiveCell data cells have a non-empty aria-label.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PerUnitTab from './PerUnitTab'

// PerUnitTab reads geoModel.lithoFormations from useShell(). Provide a
// minimal mock with at least one unit so the table body renders
// (otherwise PhaseFiveCell is never mounted).
vi.mock('../../../ShellContext', () => ({
  useShell: () => ({
    geoModel: {
      lithoFormations: [
        {
          id: 'unit-1',
          name: 'Dicht zand',
          parent_formation_name: 'Diest',
          nad_class: null,
          litho_main_soil_code: 'ZAND',
        },
      ],
    },
  }),
}))

afterEach(cleanup)

describe('PerUnitTab Phase-5 placeholders — ARIA accessibility (debt #115 sub-item 5)', () => {
  it('AU1 — Phase-5 column headers have aria-disabled="true"', () => {
    render(<PerUnitTab />)
    // Find all th elements that are Phase-5 headers — they carry aria-disabled.
    const disabledHeaders = document
      .querySelectorAll<HTMLTableCellElement>('th[aria-disabled="true"]')
    // There are 7 Phase-5 headers: qc̄, qc P50, qc P95, Ic̄, φ′, c′, cu, E50
    expect(disabledHeaders.length).toBeGreaterThanOrEqual(7)
  })

  it('AU2 — Phase-5 headers carry descriptive aria-label with "Phase 5"', () => {
    render(<PerUnitTab />)
    const disabledHeaders = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('th[aria-disabled="true"]'),
    )
    for (const h of disabledHeaders) {
      const label = h.getAttribute('aria-label') ?? ''
      expect(label.length).toBeGreaterThan(0)
      expect(label).toMatch(/Phase 5/i)
    }
  })

  it('AU3 — Phase-5 data cells have aria-disabled="true"', () => {
    render(<PerUnitTab />)
    const disabledCells = document.querySelectorAll<HTMLTableCellElement>(
      'td[aria-disabled="true"]',
    )
    // One row of units × 8 Phase-5 cells per row.
    expect(disabledCells.length).toBeGreaterThanOrEqual(8)
  })

  it('AU4 — Phase-5 data cells have a non-empty aria-label', () => {
    render(<PerUnitTab />)
    const disabledCells = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('td[aria-disabled="true"]'),
    )
    for (const cell of disabledCells) {
      const label = cell.getAttribute('aria-label') ?? ''
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('AU5 — regular data cells (Unit, Parent, NAD) do NOT have aria-disabled', () => {
    render(<PerUnitTab />)
    // The non-Phase-5 cells should not be aria-disabled — they carry real data.
    const row = screen.getByTestId('parameters-unit-unit-1')
    const nonDisabledCells = Array.from(row.querySelectorAll('td')).filter(
      td => !td.hasAttribute('aria-disabled'),
    )
    // Unit + Parent formation + NAD class = 3 non-disabled cells
    expect(nonDisabledCells.length).toBe(3)
  })
})
