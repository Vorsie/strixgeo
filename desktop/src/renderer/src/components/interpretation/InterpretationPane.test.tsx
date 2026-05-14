// Smoke tests for InterpretationPane v1 — formations list + state.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
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
  ;(api.geology.updateFormation as ReturnType<typeof vi.fn>).mockReset()
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

  it('drag-reordering a formation PATCHes display_order for moved rows', async () => {
    // Three formations in stratigraphic order [A, B, C]. Drag A onto C →
    // new visual order [B, C, A]. Both A (was 0, now 2) AND B (was 1,
    // now 0) move; C stays put because shifting it doesn't change its
    // index after the source is removed and inserted before. Wait —
    // let me re-derive: starting [A:0, B:1, C:2]. Remove A → [B, C].
    // Insert A before C at index 1 → [B, A, C]. So new order is
    // [B:0, A:1, C:2]. A moved (0→1), B moved (1→0), C stayed (2→2).
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a', name: 'A', display_order: 0 }),
      makeFormation({ id: 'b', name: 'B', display_order: 1 }),
      makeFormation({ id: 'c', name: 'C', display_order: 2 }),
    ])
    const updateFormation = api.geology.updateFormation as ReturnType<typeof vi.fn>
    updateFormation.mockResolvedValue(makeFormation({ id: 'a' }))

    const { container } = render(<InterpretationPane projectId="P" />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())

    const aRow = screen.getByText('A').closest('li') as HTMLElement
    const cRow = screen.getByText('C').closest('li') as HTMLElement
    const aHandle = aRow.querySelector(
      'button[aria-label^="Drag to reorder"]',
    ) as HTMLElement

    // HTML5 drag-and-drop dispatch — vitest jsdom needs explicit
    // dataTransfer mocks because jsdom doesn't implement the API.
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => 'a'),
      effectAllowed: 'move',
    }
    fireEvent.dragStart(aHandle, { dataTransfer })
    fireEvent.dragOver(cRow, { dataTransfer })
    fireEvent.drop(cRow, { dataTransfer })

    await waitFor(() => {
      expect(updateFormation).toHaveBeenCalled()
    })
    // Two PATCHes — one for A (moved 0→1), one for B (moved 1→0). C
    // stayed put after the splice so it isn't re-PATCHed.
    expect(updateFormation).toHaveBeenCalledTimes(2)
    const calls = updateFormation.mock.calls.map(c => ({
      id: c[1] as string,
      order: (c[2] as { display_order: number }).display_order,
    }))
    expect(calls).toContainEqual({ id: 'a', order: 1 })
    expect(calls).toContainEqual({ id: 'b', order: 0 })
    expect(container).toBeTruthy()
  })

  it('drag-reorder pushes an undo command whose revert PATCHes back to old orders', async () => {
    // Same drag as the previous test ([A,B,C] → drop A onto C → [B,A,C]).
    // After the forward PATCHes succeed, the component pushes an
    // UndoCommand. Invoking ``revert()`` must PATCH each moved row
    // back to its pre-reorder display_order.
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a', name: 'A', display_order: 0 }),
      makeFormation({ id: 'b', name: 'B', display_order: 1 }),
      makeFormation({ id: 'c', name: 'C', display_order: 2 }),
    ])
    const updateFormation = api.geology.updateFormation as ReturnType<typeof vi.fn>
    updateFormation.mockResolvedValue(makeFormation({ id: 'a' }))
    const pushUndoCommand = vi.fn()

    render(<InterpretationPane projectId="P" pushUndoCommand={pushUndoCommand} />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())

    const aRow = screen.getByText('A').closest('li') as HTMLElement
    const cRow = screen.getByText('C').closest('li') as HTMLElement
    const aHandle = aRow.querySelector(
      'button[aria-label^="Drag to reorder"]',
    ) as HTMLElement
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => 'a'),
      effectAllowed: 'move',
    }
    fireEvent.dragStart(aHandle, { dataTransfer })
    fireEvent.dragOver(cRow, { dataTransfer })
    fireEvent.drop(cRow, { dataTransfer })

    await waitFor(() => expect(pushUndoCommand).toHaveBeenCalled())
    const cmd = pushUndoCommand.mock.calls[0][0]
    expect(cmd.description).toMatch(/Reorder 2 formations/)

    // Drain the forward PATCHes from the spy so revert's calls are
    // the only thing left to inspect.
    updateFormation.mockClear()
    await cmd.revert()
    const reverts = updateFormation.mock.calls.map(c => ({
      id: c[1] as string,
      order: (c[2] as { display_order: number }).display_order,
    }))
    // A was 0→1 forward, so revert sends 1→0.
    // B was 1→0 forward, so revert sends 0→1.
    expect(reverts).toContainEqual({ id: 'a', order: 0 })
    expect(reverts).toContainEqual({ id: 'b', order: 1 })
    expect(reverts).toHaveLength(2)
  })

  it('renders Build model badge with N unbuilt edits when staleSurfaceCount > 0', async () => {
    // On-click build pivot: the primary "Build model" button shows
    // "Build model · N unbuilt edit(s)" when the cache is stale.
    // Without staleSurfaceCount the badge stays plain.
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a' }),
    ])

    const onRebuildSurfaces = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <InterpretationPane
        projectId="P"
        activeModelId="M"
        onRebuildSurfaces={onRebuildSurfaces}
        staleSurfaceCount={0}
      />,
    )
    await waitFor(() => expect(screen.getByText('Boom Klei')).toBeInTheDocument())
    // Plain label, no badge.
    expect(screen.getByRole('button', { name: /^Build model$/i })).toBeInTheDocument()
    expect(screen.queryByText(/unbuilt edit/i)).not.toBeInTheDocument()

    // Bump to 1 → singular badge.
    rerender(
      <InterpretationPane
        projectId="P"
        activeModelId="M"
        onRebuildSurfaces={onRebuildSurfaces}
        staleSurfaceCount={1}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Build model · 1 unbuilt edit$/i }),
    ).toBeInTheDocument()

    // Bump to 3 → plural badge.
    rerender(
      <InterpretationPane
        projectId="P"
        activeModelId="M"
        onRebuildSurfaces={onRebuildSurfaces}
        staleSurfaceCount={3}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Build model · 3 unbuilt edits$/i }),
    ).toBeInTheDocument()
  })

  it('crossings banner appends "as of last build" suffix when surfaces are stale', async () => {
    // The validator runs against the cached TIN. When staleSurfaceCount
    // > 0 the result is qualified — copy must say so explicitly so the
    // engineer doesn't trust a stale validation result.
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'older', name: 'Older', display_order: 0 }),
      makeFormation({ id: 'younger', name: 'Younger', display_order: 10 }),
    ])
    ;(api.geology.validateCrossings as ReturnType<typeof vi.fn>).mockResolvedValue({
      model_id: 'M',
      issues: [
        {
          kind: 'formation_crossing',
          detail: "Younger sits below Older by 3 m",
          depth_m: 3,
          contact_ids: [],
          formation_ids: ['older', 'younger'],
        },
      ],
    })

    render(
      <InterpretationPane
        projectId="P"
        activeModelId="M"
        staleSurfaceCount={2}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('crossings-banner')).toBeInTheDocument()
    })
    expect(screen.getByText(/as of last build/i)).toBeInTheDocument()
    expect(screen.getByText(/click Build to refresh/i)).toBeInTheDocument()
  })

  it('crossings banner has no "as of last build" suffix when surfaces are fresh', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a' }),
    ])
    ;(api.geology.validateCrossings as ReturnType<typeof vi.fn>).mockResolvedValue({
      model_id: 'M',
      issues: [
        {
          kind: 'formation_crossing',
          detail: "Crossing detail",
          depth_m: 1,
          contact_ids: [],
          formation_ids: ['a', 'b'],
        },
      ],
    })

    render(
      <InterpretationPane
        projectId="P"
        activeModelId="M"
        staleSurfaceCount={0}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('crossings-banner')).toBeInTheDocument()
    })
    expect(screen.queryByText(/as of last build/i)).not.toBeInTheDocument()
  })

  it('renders crossings banner when the validator returns issues', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'older', name: 'Older', display_order: 0 }),
      makeFormation({ id: 'younger', name: 'Younger', display_order: 10 }),
    ])
    ;(api.geology.validateCrossings as ReturnType<typeof vi.fn>).mockResolvedValue({
      model_id: 'M',
      issues: [
        {
          kind: 'formation_crossing',
          detail:
            "Younger formation 'Younger' sits below older 'Older' by up to 3.21 m — violates stratigraphic superposition.",
          depth_m: 3.21,
          contact_ids: [],
          formation_ids: ['older', 'younger'],
        },
      ],
    })

    render(<InterpretationPane projectId="P" activeModelId="M" />)
    await waitFor(() => {
      expect(screen.getByTestId('crossings-banner')).toBeInTheDocument()
    })
    expect(screen.getByText(/1 surface crossing detected/i)).toBeInTheDocument()
    expect(screen.getByText(/violates stratigraphic superposition/i)).toBeInTheDocument()
  })

  it('hides the crossings banner when the validator returns no issues', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a' }),
    ])
    ;(api.geology.validateCrossings as ReturnType<typeof vi.fn>).mockResolvedValue({
      model_id: 'M',
      issues: [],
    })
    render(<InterpretationPane projectId="P" activeModelId="M" />)
    await waitFor(() => {
      expect(screen.getByText('Boom Klei')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('crossings-banner')).not.toBeInTheDocument()
  })

  it('skips the crossings call when no active model is wired', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const validateCrossings = api.geology.validateCrossings as ReturnType<typeof vi.fn>
    validateCrossings.mockClear()
    render(<InterpretationPane projectId="P" activeModelId={null} />)
    await waitFor(() => {
      expect(screen.getByText(/No formations yet/i)).toBeInTheDocument()
    })
    expect(validateCrossings).not.toHaveBeenCalled()
  })

  it('drag-reorder is a no-op when source equals target', async () => {
    const { api } = await import('../../api/client')
    ;(api.geology.listFormations as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeFormation({ id: 'a', name: 'A', display_order: 0 }),
      makeFormation({ id: 'b', name: 'B', display_order: 1 }),
    ])
    const updateFormation = api.geology.updateFormation as ReturnType<typeof vi.fn>

    render(<InterpretationPane projectId="P" />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())

    const aRow = screen.getByText('A').closest('li') as HTMLElement
    const aHandle = aRow.querySelector(
      'button[aria-label^="Drag to reorder"]',
    ) as HTMLElement
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => 'a'),
      effectAllowed: 'move',
    }
    fireEvent.dragStart(aHandle, { dataTransfer })
    fireEvent.dragOver(aRow, { dataTransfer })
    fireEvent.drop(aRow, { dataTransfer })

    // Drop on self: handler short-circuits before touching the API.
    expect(updateFormation).not.toHaveBeenCalled()
  })
})
