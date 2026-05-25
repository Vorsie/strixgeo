import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WelcomeScreen from './WelcomeScreen'

// Behaviour tests for the welcome screen's two columns:
//   * Create / Open card on the left — exercises the create + open
//     button paths and the disabled-while-busy behaviour.
//   * Recent projects column on the right — populated from a mocked
//     ``window.electron.getRecentProjects``. Hidden when the list is
//     empty so first-launch users don't see a dangling placeholder.

const RECENT_FIXTURE = [
  { path: 'C:/projects/site-A.gmproj', name: 'Site A', lastOpened: '2026-05-10T10:00:00Z' },
  { path: 'C:/projects/site-B.gmproj', name: 'Site B', lastOpened: '2026-05-10T09:00:00Z' },
]

beforeEach(() => {
  // Minimal ``window.electron`` stub — only the methods the welcome
  // screen reaches for. Override per-test by re-assigning before the
  // render call.
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    getRecentProjects: vi.fn().mockResolvedValue(RECENT_FIXTURE),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WelcomeScreen', () => {
  it('renders Create + Open buttons in the left column', async () => {
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Create project/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Open project from file/i }),
    ).toBeInTheDocument()
  })

  it('disables Create until a non-empty name is typed', () => {
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    const create = screen.getByRole('button', { name: /Create project/i })
    expect(create).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Project name/i), {
      target: { value: 'Site A' },
    })
    expect(create).not.toBeDisabled()
  })

  it('invokes onCreateProject with the trimmed name on Enter', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <WelcomeScreen
        onCreateProject={onCreate}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    const input = screen.getByLabelText(/Project name/i)
    fireEvent.change(input, { target: { value: '  Trimmed Name  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Trimmed Name'))
  })

  it('invokes onOpenProject when Open from file is clicked', async () => {
    const onOpen = vi.fn().mockResolvedValue('opened' as const)
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={onOpen}
        onOpenRecent={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open project from file/i }))
    await waitFor(() => expect(onOpen).toHaveBeenCalled())
  })

  it('shows a banner when onOpenProject returns "failed"', async () => {
    const onOpen = vi.fn().mockResolvedValue('failed' as const)
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={onOpen}
        onOpenRecent={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open project from file/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn't open the selected/),
    )
  })

  it('does not show a banner when the user cancels the dialog', async () => {
    const onOpen = vi.fn().mockResolvedValue('cancelled' as const)
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={onOpen}
        onOpenRecent={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open project from file/i }))
    await waitFor(() => expect(onOpen).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the recent projects column when entries are present', async () => {
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    // ``Recent projects`` heading + each entry's name appears.
    expect(await screen.findByText(/Recent projects/i)).toBeInTheDocument()
    expect(screen.getByText('Site A')).toBeInTheDocument()
    expect(screen.getByText('Site B')).toBeInTheDocument()
  })

  it('hides the recent column when the list is empty', async () => {
    ;(window.electron as unknown as { getRecentProjects: () => Promise<unknown[]> }).getRecentProjects =
      vi.fn().mockResolvedValue([])
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    // Confirm the create/open card is rendered, then the recent
    // heading is absent. Wait one tick for the empty resolve.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create project/i })).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Recent projects/i)).not.toBeInTheDocument()
  })

  it('invokes onOpenRecent with the entry path when a row is clicked', async () => {
    const onOpenRecent = vi.fn().mockResolvedValue(true)
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={onOpenRecent}
      />,
    )
    const row = await screen.findByText('Site A')
    fireEvent.click(row)
    await waitFor(() =>
      expect(onOpenRecent).toHaveBeenCalledWith('C:/projects/site-A.gmproj'),
    )
  })

  it('shows a banner + refreshes recent when onOpenRecent reports failure', async () => {
    const onOpenRecent = vi.fn().mockResolvedValue(false)
    // First load returns both entries; the refresh that fires after a
    // failed open returns only the remaining one (Site A removed in main).
    const getRecent = vi
      .fn<() => Promise<typeof RECENT_FIXTURE>>()
      .mockResolvedValueOnce(RECENT_FIXTURE)
      .mockResolvedValueOnce(RECENT_FIXTURE.slice(1))
    ;(window.electron as unknown as { getRecentProjects: typeof getRecent }).getRecentProjects =
      getRecent
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={onOpenRecent}
      />,
    )
    const row = await screen.findByText('Site A')
    fireEvent.click(row)
    await waitFor(() => expect(getRecent).toHaveBeenCalledTimes(2))
    expect(
      screen.getByRole('alert').textContent,
    ).toMatch(/Couldn't open "Site A"/)
    // Stale entry removed after the refresh.
    expect(screen.queryByText('Site A')).not.toBeInTheDocument()
    expect(screen.getByText('Site B')).toBeInTheDocument()
  })

  it('falls back to an empty list when getRecentProjects rejects', async () => {
    ;(window.electron as unknown as { getRecentProjects: () => Promise<unknown[]> }).getRecentProjects =
      vi.fn().mockRejectedValue(new Error('IPC down'))
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create project/i })).toBeInTheDocument(),
    )
    // No recent column, but the create/open card still renders.
    expect(screen.queryByText(/Recent projects/i)).not.toBeInTheDocument()
  })

  it('DK1 — root container uses semantic dark-mode-aware token bg-surface-app (debt #105)', () => {
    // Regression anchor: WelcomeScreen previously used bg-gray-50 (raw palette
    // token with no dark: variant). The semantic bg-surface-app resolves to
    // slate-100 in light and slate-950 in dark — both themes work without
    // extra dark: pairs.
    const { getByTestId } = render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    const root = getByTestId('welcome-screen')
    expect(root.className).toContain('bg-surface-app')
    expect(root.className).not.toContain('bg-gray-')
  })
})
