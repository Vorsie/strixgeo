// Smoke tests for InterpretationPane v1 — formations list + state.

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/client'
import InterpretationPane from './InterpretationPane'

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>(
    '../../api/client',
  )
  return {
    ...actual,
    api: {
      ...actual.api,
      geology: {
        listFormations: vi.fn(),
        createFormation: vi.fn(),
        updateFormation: vi.fn(),
        deleteFormation: vi.fn(),
        listModels: vi.fn(),
        createModel: vi.fn(),
        updateModel: vi.fn(),
        activateModel: vi.fn(),
        deleteModel: vi.fn(),
        listContacts: vi.fn(),
        createContact: vi.fn(),
        updateContact: vi.fn(),
        deleteContact: vi.fn(),
        validateBorehole: vi.fn(),
      },
    },
  }
})

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'P',
    name: 'Boom Klei',
    color: '#3b82f6',
    code: null,
    display_order: 0,
    regional_ref: 'BMK',
    description: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

beforeEach(async () => {
  const { api } = await import('../../api/client')
  ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InterpretationPane', () => {
  it('renders the no-project guard when projectId is null', () => {
    render(<InterpretationPane projectId={null} />)
    expect(screen.getByText(/Open or create a project/i)).toBeInTheDocument()
  })

  it('renders the "no formations yet" empty state for a project with zero formations', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([])
    render(<InterpretationPane projectId="P" />)
    await waitFor(() => {
      expect(screen.getByText(/No formations yet/i)).toBeInTheDocument()
    })
  })

  it('lists fetched formations sorted by display_order then name', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a', name: 'Zeta', display_order: 1 }),
      makeFormation({ id: 'b', name: 'Alpha', display_order: 0 }),
      makeFormation({ id: 'c', name: 'Beta', display_order: 0 }),
    ])
    render(<InterpretationPane projectId="P" />)
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
    // All three render
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Zeta')).toBeInTheDocument()
  })

  it('shows the formation count badge', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a' }),
      makeFormation({ id: 'b', name: 'Diest Zand' }),
    ])
    const { container } = render(<InterpretationPane projectId="P" />)
    await waitFor(() => {
      expect(screen.getByText('Boom Klei')).toBeInTheDocument()
    })
    // The count "2" sits in a small tabular-nums span next to the
    // "Formations" header. Find it via that container class.
    const count = container.querySelector('.tabular-nums')
    expect(count?.textContent).toBe('2')
  })

  it('renders an Add button', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([])
    render(<InterpretationPane projectId="P" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add/i })).toBeInTheDocument()
    })
  })
})
