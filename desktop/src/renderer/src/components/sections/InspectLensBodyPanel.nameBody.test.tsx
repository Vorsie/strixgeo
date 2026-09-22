// Regression for audit #3 / debt #207: nameBody (PATCH /bodies/{body_id}) is
// the correct call; the old nameLensBody alias (POST /bodies) was removed when
// the body-extent system was retired 2026-06-06.  This pins that the callback
// receives the real id from nameBody and that existingLensId is required.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  api: {
    geology: {
      listFormationAbsences: vi.fn().mockResolvedValue([]),
      getBodyBoundary: vi.fn().mockResolvedValue({
        render_style: 'straight',
        upper_nodes: [],
        lower_nodes: [],
      }),
      saveBodyBoundary: vi.fn().mockResolvedValue({}),
      nameBody: vi.fn(),
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
  // existingLensId is the body_id resolved from the lens list (always
  // non-null after resolver runs — null only if listLenses failed).
  existingLensId: 'BODY-REAL',
  onLensNamed: vi.fn(),
  onOfferCompanion: vi.fn(),
  onAbsenceUpdated: vi.fn(),
  onClose: vi.fn(),
}

beforeEach(() => {
  // Backend returns body_id (audit #3 — was mistakenly lens_id before).
  geo.nameBody.mockResolvedValue({ body_id: 'BODY-REAL', was_created: false })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InspectLensBodyPanel — name-body callback (audit #3 / debt #207)', () => {
  it('passes the real body_id to onLensNamed via nameBody (PATCH), not the retired POST', async () => {
    const onLensNamed = vi.fn()
    render(<InspectLensBodyPanel {...baseProps} target={target} onLensNamed={onLensNamed} />)

    fireEvent.change(screen.getByPlaceholderText(/Boom Klei lens/i), {
      target: { value: 'My lens' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(onLensNamed).toHaveBeenCalled())
    expect(onLensNamed).toHaveBeenCalledWith('BODY-REAL', false)
    // nameBody is called with the existingLensId as the body_id argument.
    expect(geo.nameBody).toHaveBeenCalledWith('p1', 'm1', 'BODY-REAL', expect.objectContaining({ name: 'My lens' }))
  })

  it('shows an error when existingLensId is null (resolver not yet run)', async () => {
    render(<InspectLensBodyPanel {...baseProps} existingLensId={null} target={target} />)
    fireEvent.change(screen.getByPlaceholderText(/Boom Klei lens/i), {
      target: { value: 'My lens' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() =>
      expect(screen.getByText(/Body not yet resolved/i)).toBeInTheDocument(),
    )
    expect(geo.nameBody).not.toHaveBeenCalled()
  })
})
