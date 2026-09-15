// Finding A (installer #40): a bed-level (bodempeil) edit must NOT mark the
// Sections (Profielen) stage stale — the section view is cut LIVE from the
// live overrides, so it never needs a rebuild. Only the three BUILT models
// (Stratigraphy surfaces, Litho solids, Geotech solids) go stale.
//
// Owner, verbatim: "when i edit the bottom level, i get stale markers on
// profielen, stratigrafie and litho. Shouldn't those be on stratigrafie, litho
// and geotech?"
//
// The Sections badge borrowed ``geoModel.staleSurfaceCount`` — the SAME count
// the Stratigraphy stage reads — so a bed edit (which stales the geological
// surfaces) lit the Sections badge amber too. This pins the fix: the Sections
// badge never reflects surface staleness.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the descriptor import from pulling the heavy canvas/toolbar/inspector
// (Leaflet + SectionPanel) into jsdom — the summary hook is all this tests.
vi.mock('./SectionsCanvas', () => ({ default: () => null }))
vi.mock('./SectionsToolbar', () => ({ default: () => null }))
vi.mock('./SectionsInspector', () => ({ default: () => null }))
vi.mock('../../ShellContext', () => ({ useShell: vi.fn() }))

import { useShell } from '../../ShellContext'
import SectionsStage from './SectionsStage'

const mockUseShell = useShell as unknown as ReturnType<typeof vi.fn>

/** Point the mocked shell at a section count + a surface-stale count. */
function setShell(visibleSectionCount: number, staleSurfaceCount: number): void {
  mockUseShell.mockReturnValue({
    sections: {
      visibleSections: Array.from({ length: visibleSectionCount }, () => ({})),
    },
    geoModel: { staleSurfaceCount },
  })
}

function summary(): { badge: string | null; badgeIntent?: string } {
  const { result } = renderHook(() => SectionsStage.useStageSummary!())
  return result.current
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Sections stage badge — a bed edit does not stale the sections', () => {
  it('SS-A1: a bed edit staled the surfaces but the Sections badge stays neutral', () => {
    // A bed edit flips every geological surface stale → staleSurfaceCount > 0.
    setShell(3, 2)
    const s = summary()
    expect(s.badgeIntent).not.toBe('amber')
    // The badge is the plain section count, never a "stale" mark.
    expect(s.badge).toBe('3')
  })

  it('SS-A2: no staleness → the plain section count, neutral', () => {
    setShell(3, 0)
    const s = summary()
    expect(s.badgeIntent).not.toBe('amber')
    expect(s.badge).toBe('3')
  })
})
