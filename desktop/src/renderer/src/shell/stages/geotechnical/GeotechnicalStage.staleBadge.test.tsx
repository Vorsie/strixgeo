// Finding A (installer #40): a bed-level (bodempeil) edit must mark the
// Geotechnical stage stale — its 3-D voxel solids embed the bed at Build time,
// so a later bed change stales them (docs/design/bed-override-and-ground-clip
// §Ruling 4). The badge never read the flag, so Geotech was the one BUILT model
// that did NOT go amber after a bed edit.
//
// Owner, verbatim: "Shouldn't those be on stratigrafie, litho and geotech?"

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the descriptor import from pulling the heavy 3-D canvas (Cesium) into
// jsdom — the summary hook is all this tests.
vi.mock('./GeotechnicalCanvas', () => ({ default: () => null }))
vi.mock('./GeotechnicalInspector', () => ({ default: () => null }))
vi.mock('./GeotechnicalToolbar', () => ({ default: () => null }))
vi.mock('../../ShellContext', () => ({ useShell: vi.fn() }))

import { useShell } from '../../ShellContext'
import GeotechnicalStage from './GeotechnicalStage'

const mockUseShell = useShell as unknown as ReturnType<typeof vi.fn>

function setShell(hasStaleGeotechSolid: boolean): void {
  mockUseShell.mockReturnValue({
    geoModel: { hasStaleGeotechSolid },
  })
}

function summary(): { badge: string | null; badgeIntent?: string } {
  const { result } = renderHook(() => GeotechnicalStage.useStageSummary!())
  return result.current
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Geotechnical stage badge — a bed edit stales the geotech solids', () => {
  it('GT-A1: stale geotech solids → an amber "!" badge (mirrors the Litho stage)', () => {
    setShell(true)
    const s = summary()
    expect(s.badgeIntent).toBe('amber')
    expect(s.badge).toBe('!')
  })

  it('GT-A2: no stale solids → no stale badge', () => {
    setShell(false)
    const s = summary()
    expect(s.badgeIntent).not.toBe('amber')
    expect(s.badge).not.toBe('!')
  })
})
