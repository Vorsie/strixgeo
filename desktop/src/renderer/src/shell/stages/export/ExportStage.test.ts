// Behavioural net for the Export stage-spine badge (the "101 counts the wrong
// kind" bug class — a stage badge must count its OWN readiness signal, not a
// raw entity count leaking in from the shell).
//
// Since the Export hub (installer #35) the badge counts RUNNABLE EXPORT FAMILIES:
//   * Plaxis 3D            — the stratigraphic model
//   * litho fence          — the litho model
//   * geotech fence        — the geotech model
//   * litho section exports — a section + the litho model
//   * geotech section exports — a section + the geotech model
// So no model at all → badge null, even with many sections (the guard against a
// section / investigation count leaking into the badge).

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ShellContext', () => ({ useShell: vi.fn() }))

import { useShell } from '../../ShellContext'
import ExportStage from './ExportStage'

const mockUseShell = useShell as unknown as ReturnType<typeof vi.fn>

interface Models {
  geo?: boolean
  litho?: boolean
  geotech?: boolean
}

/** Point the mocked shell at a given section count + per-level model presence. */
function setShell(sectionCount: number, models: Models): void {
  mockUseShell.mockReturnValue({
    sections: { sections: Array.from({ length: sectionCount }, () => ({})) },
    geoModel: {
      activeGeologicalModel: models.geo ? { id: 'G1' } : null,
      activeLithoModel: models.litho ? { id: 'L1' } : null,
      activeGeotechModel: models.geotech ? { id: 'T1' } : null,
    },
  })
}

/** Render the stage's summary hook and return the badge. */
function badge(): string | null {
  const { result } = renderHook(() => ExportStage.useStageSummary!())
  return result.current.badge
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Export stage badge — runnable-family count', () => {
  it('ES1: no model → badge null even when sections exist (no entity-count leak)', () => {
    setShell(3, {})
    expect(badge()).toBeNull()
  })

  it('ES2: stratigraphic model + no sections → Plaxis 3D only → "1"', () => {
    setShell(0, { geo: true })
    expect(badge()).toBe('1')
  })

  it('ES3: litho model + no sections → fence only → "1"', () => {
    setShell(0, { litho: true })
    expect(badge()).toBe('1')
  })

  it('ES4: all three models + sections → every family → "5"', () => {
    setShell(2, { geo: true, litho: true, geotech: true })
    // Plaxis 3D + litho fence + geotech fence + litho section + geotech section.
    expect(badge()).toBe('5')
  })

  it('ES5: nothing → badge null', () => {
    setShell(0, {})
    expect(badge()).toBeNull()
  })

  it('ES6: the label is stable and the intent is neutral', () => {
    setShell(1, { geo: true })
    const { result } = renderHook(() => ExportStage.useStageSummary!())
    expect(result.current.label).toBe('Exports')
    expect(result.current.badgeIntent).toBe('neutral')
  })
})
