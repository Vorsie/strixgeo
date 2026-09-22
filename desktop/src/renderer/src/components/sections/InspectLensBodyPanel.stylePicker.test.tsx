// Focused test for the lens boundary render-style picker (#163f Slice 2).
//
//   SP1  the three style buttons render when the body has a lens row, with the
//        stored style pre-selected (from getBodyBoundary).
//   SP2  clicking a style PUTs saveBodyBoundary with that style + the existing
//        control nodes preserved.
//   SP3  no style section when the body has no lens row (existingLensId null).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    geology: {
      listFormationAbsences: vi.fn().mockResolvedValue([]),
      getBodyBoundary: vi.fn(),
      saveBodyBoundary: vi.fn().mockResolvedValue({}),
    },
  },
}))

import { api } from '../../api/client'
import InspectLensBodyPanel from './InspectLensBodyPanel'

const geo = api.geology as unknown as Record<string, ReturnType<typeof vi.fn>>

const target = { projectId: 'p1', modelId: 'm1', formationId: 'f1', bodyOrdinal: 0 }
const baseProps = {
  formations: [],
  presentInvestigationIds: [],
  investigationLabels: new Map<string, string>(),
  existingLensName: 'Lens 1',
  onLensNamed: vi.fn(),
  onOfferCompanion: vi.fn(),
  onAbsenceUpdated: vi.fn(),
  onClose: vi.fn(),
}

beforeEach(() => {
  geo.getBodyBoundary.mockResolvedValue({
    body_id: 'L1',
    content_key: 'a|b|c',
    render_style: 'straight',
    primary_section_id: 's1',
    upper_nodes: [{ along_m: 10, elevation_m: 5 }],
    lower_nodes: [],
  })
  geo.saveBodyBoundary.mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InspectLensBodyPanel — boundary style picker (#163f)', () => {
  it('SP1 — renders the three style buttons with the stored style preselected', async () => {
    render(<InspectLensBodyPanel target={target} existingLensId="L1" {...baseProps} />)
    expect(await screen.findByTestId('inspect-lens-style-straight')).toBeTruthy()
    expect(screen.getByTestId('inspect-lens-style-blocky')).toBeTruthy()
    expect(screen.getByTestId('inspect-lens-style-rounded')).toBeTruthy()
  })

  it('SP2 — clicking a style PUTs saveBodyBoundary preserving the nodes', async () => {
    render(<InspectLensBodyPanel target={target} existingLensId="L1" {...baseProps} />)
    fireEvent.click(await screen.findByTestId('inspect-lens-style-blocky'))
    await waitFor(() => expect(geo.saveBodyBoundary).toHaveBeenCalledTimes(1))
    const [pid, mid, lensId, body] = geo.saveBodyBoundary.mock.calls[0]
    expect([pid, mid, lensId]).toEqual(['p1', 'm1', 'L1'])
    expect(body.render_style).toBe('blocky')
    // The previously-stored upper node is preserved (not wiped to []).
    expect(body.upper_nodes).toEqual([{ along_m: 10, elevation_m: 5 }])
  })

  it('SP3 — no style section when the body has no lens row', () => {
    render(<InspectLensBodyPanel target={target} existingLensId={null} {...baseProps} />)
    expect(screen.queryByTestId('inspect-lens-style')).toBeNull()
  })
})
