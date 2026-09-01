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

/** One recovery descriptor as ``listRecovery`` returns it. */
const RECOVERY_DESCRIPTOR = {
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Kanaal Noord',
  filePath: 'C:/userData/recovery/1111.recovery.json',
  writtenAt: new Date(2026, 7, 2, 14, 32).toISOString(),
  appVersion: '0.1.0',
  sizeBytes: 512,
  declined: false,
}

/** A minimal valid payload — only ``filePath`` matters to the welcome screen. */
function makeRecoveryPayload(filePath: string | null): unknown {
  return {
    snapshot_version: 1,
    filePath,
    lumping: { current: null, revision: null },
    ghosts: [],
    metadataDraftPatch: {},
    manifests: { cpt: [], borehole: [], formation: [], section: [] },
    sessionImports: { cpt: [], borehole: [], formation: [], section: [], contact: [] },
    hasUnsavedMutations: false,
  }
}

beforeEach(() => {
  // Minimal ``window.electron`` stub — only the methods the welcome
  // screen reaches for. Override per-test by re-assigning before the
  // render call. The recovery pair defaults to "nothing crashed", which
  // is the state every pre-existing test in this file assumes.
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    getRecentProjects: vi.fn().mockResolvedValue(RECENT_FIXTURE),
    listRecovery: vi.fn().mockResolvedValue([]),
    readRecovery: vi.fn().mockResolvedValue(null),
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
    const onOpen = vi.fn().mockResolvedValue({ outcome: 'opened' as const })
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
    const onOpen = vi.fn().mockResolvedValue({ outcome: 'failed' as const })
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
    const onOpen = vi.fn().mockResolvedValue({ outcome: 'cancelled' as const })
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
    const onOpenRecent = vi.fn().mockResolvedValue({ outcome: 'opened' })
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
    const onOpenRecent = vi.fn().mockResolvedValue({ outcome: 'failed' })
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

  it("names the moved file when onOpenRecent reports 'missing'", async () => {
    // Owner, 2026-08-17: "if user moved it you get a toast, file not found,
    // did you change it's location". The old catch-all blamed corruption or
    // the API for a file that had simply been moved — the wrong diagnosis,
    // pointing the user at the wrong fix.
    const onOpenRecent = vi.fn().mockResolvedValue({ outcome: 'missing' })
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={onOpenRecent}
      />,
    )
    const row = await screen.findByText('Site A')
    fireEvent.click(row)
    const alert = await screen.findByRole('alert')
    // The message must carry the three things the user needs: which project,
    // where the file was expected, and the move question.
    expect(alert.textContent).toMatch(/Couldn't find the file for "Site A"/)
    expect(alert.textContent).toContain('C:/projects/site-A.gmproj')
    expect(alert.textContent).toMatch(/move or rename/i)
    // And it must NOT blame corruption — that is the other failure's banner.
    expect(alert.textContent).not.toMatch(/corrupt/i)
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

  // -------------------------------------------------------------------------
  // Recovered work (docs/design/autosave-recovery.md §4). A recovery file
  // present at launch means the previous session never reached a clean exit,
  // so the start screen surfaces it the way Word surfaces a recovered
  // document — quietly, next to the recent list, not as an alarm.
  // -------------------------------------------------------------------------

  function installRecovery(
    descriptors: unknown[],
    payload: unknown = makeRecoveryPayload('C:/projects/kanaal-noord.strix'),
  ): void {
    const electron = window.electron as unknown as Record<string, unknown>
    electron.listRecovery = vi.fn().mockResolvedValue(descriptors)
    electron.readRecovery = vi.fn().mockResolvedValue(payload)
  }

  it('shows the recovered-work section only when a recovery file exists', async () => {
    installRecovery([RECOVERY_DESCRIPTOR])
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    expect(await screen.findByText(/Recovered work/i)).toBeInTheDocument()
    expect(screen.getByText('Kanaal Noord')).toBeInTheDocument()
  })

  it('lists a copy the user already opened without restoring, and says so', async () => {
    // Declining preserves the copy (owner decision 2026-08-03) precisely so it
    // can be offered again, so the start screen must not treat ``declined`` as
    // "already dealt with" and filter it out. But it must not present it as
    // fresh crash debris either: a second sighting of an entry the user
    // deliberately passed on reads as "the crash happened again" unless the
    // row says otherwise.
    installRecovery([{ ...RECOVERY_DESCRIPTOR, declined: true }])
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    expect(await screen.findByText(/Recovered work/i)).toBeInTheDocument()
    const entry = screen.getByTestId(`welcome-recovery-entry-${RECOVERY_DESCRIPTOR.projectId}`)
    expect(entry).toBeEnabled()
    expect(entry).toHaveTextContent(/chose not to restore/i)
  })

  it('says nothing of the sort for an ordinary crash copy', async () => {
    // The default wording has to stay the crash wording — the declined line is
    // an exception, and an exception that shows up everywhere is just noise.
    installRecovery([RECOVERY_DESCRIPTOR])
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    await screen.findByText(/Recovered work/i)
    const entry = screen.getByTestId(`welcome-recovery-entry-${RECOVERY_DESCRIPTOR.projectId}`)
    expect(entry).not.toHaveTextContent(/chose not to restore/i)
  })

  it('hides the recovered-work section when the previous session exited cleanly', async () => {
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    await screen.findByText('Site A')
    expect(screen.queryByText(/Recovered work/i)).not.toBeInTheDocument()
  })

  it('routes a recovered entry through the normal open path, using the project file it names', async () => {
    // Opening the project is what makes the restore prompt appear — the
    // welcome screen never restores anything itself.
    installRecovery([RECOVERY_DESCRIPTOR])
    const onOpenRecent = vi.fn().mockResolvedValue({ outcome: 'opened' })
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={onOpenRecent}
      />,
    )
    fireEvent.click(await screen.findByText('Kanaal Noord'))
    await waitFor(() =>
      expect(onOpenRecent).toHaveBeenCalledWith('C:/projects/kanaal-noord.strix'),
    )
  })

  it('disables a recovered entry whose project file is unknown, and says what to do', async () => {
    installRecovery([RECOVERY_DESCRIPTOR], makeRecoveryPayload(null))
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    await screen.findByText('Kanaal Noord')
    const entry = screen.getByTestId(`welcome-recovery-entry-${RECOVERY_DESCRIPTOR.projectId}`)
    expect(entry).toBeDisabled()
    expect(entry.textContent).toMatch(/open the project file to restore/i)
  })

  it('shows how old the recovered work is', async () => {
    installRecovery([RECOVERY_DESCRIPTOR])
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    const entry = await screen.findByTestId(
      `welcome-recovery-entry-${RECOVERY_DESCRIPTOR.projectId}`,
    )
    expect(entry.textContent).toMatch(/14:32/)
  })

  it('survives a recovery IPC that is unavailable or failing', async () => {
    // A broken recovery channel must cost the recovered-work section, never
    // the create / open buttons the user actually needs.
    const electron = window.electron as unknown as Record<string, unknown>
    electron.listRecovery = vi.fn().mockRejectedValue(new Error('IPC down'))
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
    expect(screen.queryByText(/Recovered work/i)).not.toBeInTheDocument()
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

  // Regression anchors for debt #115 sub-item 4 — focus rings.
  it('FR1 — dismiss button on the error banner has focus-visible ring classes (debt #115)', async () => {
    const onOpen = vi.fn().mockResolvedValue({ outcome: 'failed' as const })
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={onOpen}
        onOpenRecent={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open project from file/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    const dismiss = screen.getByRole('button', { name: /Dismiss/i })
    expect(dismiss.className).toContain('focus-visible:ring-2')
    expect(dismiss.className).toContain('focus-visible:ring-accent')
  })

  it('FR2 — recent-project entry buttons have focus-visible ring classes (debt #115)', async () => {
    render(
      <WelcomeScreen
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecent={vi.fn()}
      />,
    )
    // Wait for the recent list to render.
    await screen.findByText('Site A')
    const recentBtn = screen.getByTestId(`welcome-recent-entry-${RECENT_FIXTURE[0].path}`)
    expect(recentBtn.className).toContain('focus-visible:ring-2')
    expect(recentBtn.className).toContain('focus-visible:ring-accent')
  })
})
