/**
 * What the "NAD characteristic values" block shows (owner ruling 2026-09-05).
 *
 * *"add to unit statistics that NAD values phi'-c'-cu and dry and wet density
 * are also available"* — a per-body block, SEPARATE from the per-unit
 * statistics, reading the NAD table row for the body's packing class. It is a
 * table read, never a derivation: five values with units, a dash where the
 * table has one, a provenance line naming the norm, and the standing caveat.
 *
 * NP1  a classified body shows the five values with their units
 * NP2  a granular class shows a dash for cu (the table carries none)
 * NP3  a cohesive class shows cu with its unit
 * NP4  the provenance names the norm table + the class; the caveat is present
 * NP5  an unclassified body renders nothing
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import UnitNadParameters from './UnitNadParameters'
import type { NadCharacteristicValues } from '../../../api/clients/geology.types'

const GRANULAR: NadCharacteristicValues = {
  gamma_unsat_kn_m3: 17,
  gamma_sat_kn_m3: 19,
  phi_deg: 30,
  c_kpa: 0,
  cu_kpa: null,
}
const COHESIVE: NadCharacteristicValues = {
  gamma_unsat_kn_m3: 16,
  gamma_sat_kn_m3: 16,
  phi_deg: 20,
  c_kpa: 2,
  cu_kpa: 20,
}

afterEach(cleanup)

describe('UnitNadParameters', () => {
  it('NP1 — a classified body shows the five values with units', () => {
    render(<UnitNadParameters nadClass={6} parameters={GRANULAR} />)
    expect(screen.getByTestId('unit-nad-parameters')).toBeTruthy()
    expect(screen.getByTestId('nad-param-gamma-dry').textContent).toContain('17')
    expect(screen.getByTestId('nad-param-gamma-dry').textContent).toContain('kN/m³')
    expect(screen.getByTestId('nad-param-gamma-wet').textContent).toContain('19')
    expect(screen.getByTestId('nad-param-phi').textContent).toContain('30')
    expect(screen.getByTestId('nad-param-phi').textContent).toContain('°')
    expect(screen.getByTestId('nad-param-c').textContent).toContain('0')
    expect(screen.getByTestId('nad-param-c').textContent).toContain('kPa')
  })

  it('NP2 — a granular class shows a dash for cu', () => {
    render(<UnitNadParameters nadClass={6} parameters={GRANULAR} />)
    expect(screen.getByTestId('nad-param-cu').textContent).toContain('—')
    expect(screen.getByTestId('nad-param-cu').textContent).not.toContain('kPa')
  })

  it('NP3 — a cohesive class shows cu with its unit', () => {
    render(<UnitNadParameters nadClass={21} parameters={COHESIVE} />)
    expect(screen.getByTestId('nad-param-cu').textContent).toContain('20')
    expect(screen.getByTestId('nad-param-cu').textContent).toContain('kPa')
  })

  it('NP4 — provenance names the norm table + class, and the caveat is present', () => {
    render(<UnitNadParameters nadClass={6} parameters={GRANULAR} />)
    const prov = screen.getByTestId('nad-param-provenance').textContent ?? ''
    expect(prov).toContain('NBN EN 1997-1 ANB Tabel 2.1')
    expect(prov).toContain('6')
    // The class name (English default locale in tests).
    expect(prov).toContain('SAND, medium dense')
    expect(screen.getByTestId('nad-param-caveat')).toBeTruthy()
  })

  it('NP5 — an unclassified body renders nothing', () => {
    const { container } = render(<UnitNadParameters nadClass={null} parameters={null} />)
    expect(screen.queryByTestId('unit-nad-parameters')).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})
