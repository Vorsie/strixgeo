// Behavioural net for the Export stage-spine badge (the "101 counts the wrong
// kind" bug class — a stage badge must count its OWN readiness signal, not a
// raw entity count leaking in from the shell).
//
// The Export badge counts RUNNABLE EXPORT TARGETS (0..2 today): DXF needs an
// active model + ≥1 section; Plaxis 3D needs an active model. So:
//   - no model → nothing runnable → badge null, even with many sections
//     (the guard against a section/investigation count leaking into the badge).
//   - model + no sections → Plaxis only → "1".
//   - model + sections → both → "2".

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ShellContext', () => ({ useShell: vi.fn() }))

import { useShell } from '../../ShellContext'
import ExportStage from './ExportStage'

const mockUseShell = useShell as unknown as ReturnType<typeof vi.fn>

/** Point the mocked shell at a given section count + model presence. */
function setShell(sectionCount: number, hasModel: boolean): void {
  mockUseShell.mockReturnValue({
    sections: { sections: Array.from({ length: sectionCount }, () => ({})) },
    geoModel: { activeGeologicalModel: hasModel ? { id: 'M1' } : null },
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

describe('Export stage badge — runnable-target count', () => {
  it('ES1: no model → badge null even when sections exist (no entity-count leak)', () => {
    setShell(3, false)
    expect(badge()).toBeNull()
  })

  it('ES2: model + no sections → Plaxis only → "1"', () => {
    setShell(0, true)
    expect(badge()).toBe('1')
  })

  it('ES3: model + sections → DXF + Plaxis → "2"', () => {
    setShell(2, true)
    expect(badge()).toBe('2')
  })

  it('ES4: nothing → badge null', () => {
    setShell(0, false)
    expect(badge()).toBeNull()
  })

  it('ES5: the label is stable and the intent is neutral', () => {
    setShell(1, true)
    const { result } = renderHook(() => ExportStage.useStageSummary!())
    expect(result.current.label).toBe('Exports')
    expect(result.current.badgeIntent).toBe('neutral')
  })
})
