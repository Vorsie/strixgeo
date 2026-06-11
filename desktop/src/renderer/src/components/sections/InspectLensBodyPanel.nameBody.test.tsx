// Regression for audit #3: NameBodyResponse field is ``body_id`` on the
// backend, but the client interface read ``lens_id`` — so onLensNamed fired
// with ``undefined``. This pins that the callback receives the real id.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    geology: {
      listFormationAbsences: vi.fn().mockResolvedValue([]),
      getLensBoundary: vi.fn(),
      saveLensBoundary: vi.fn().mockResolvedValue({}),
      nameLensBody: vi.fn(),
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
  existingLensName: '',
  existingLensId: null,
  onLensNamed: vi.fn(),
  onOfferCompanion: vi.fn(),
  onAbsenceUpdated: vi.fn(),
  onClose: vi.fn(),
}

beforeEach(() => {
  // Backend returns body_id, NOT lens_id (audit #3).
  geo.nameLensBody.mockResolvedValue({ body_id: 'BODY-REAL', was_created: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InspectLensBodyPanel — name-body callback (audit #3)', () => {
  it('passes the real body_id to onLensNamed, not undefined', async () => {
    const onLensNamed = vi.fn()
    render(<InspectLensBodyPanel {...baseProps} target={target} onLensNamed={onLensNamed} />)

    fireEvent.change(screen.getByPlaceholderText(/Boom Klei lens/i), {
      target: { value: 'My lens' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onLensNamed).toHaveBeenCalled())
    expect(onLensNamed).toHaveBeenCalledWith('BODY-REAL', true)
  })
})
