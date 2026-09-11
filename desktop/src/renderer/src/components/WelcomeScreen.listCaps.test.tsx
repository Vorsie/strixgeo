// Owner 2026-09-11: "recent project should max out on 4 suggestions plz, same
// for restored, so a max of 8." The main process keeps a longer recent list
// for the File menu; the start screen shows only the first four of each.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WelcomeScreen from './WelcomeScreen'

vi.mock('../utils/log', () => ({
  log: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const recent = Array.from({ length: 6 }, (_, i) => ({
  path: `C:/projects/site-${i}.strix`,
  name: `Site ${i}`,
  lastOpened: `2026-05-1${i}T10:00:00Z`,
}))
const recovery = Array.from({ length: 6 }, (_, i) => ({
  projectId: `1111111${i}-1111-4111-8111-111111111111`,
  projectName: `Crash ${i}`,
  filePath: `C:/userData/recovery/${i}.recovery.json`,
  writtenAt: new Date(2026, 7, 2, 14, i).toISOString(),
  appVersion: '0.1.0',
  sizeBytes: 512,
  declined: false,
}))
const payload = {
  snapshot_version: 1,
  filePath: 'C:/projects/crash.strix',
  lumping: { current: null, revision: null },
  ghosts: [],
  metadataDraftPatch: {},
  manifests: { cpt: [], borehole: [], formation: [], section: [] },
  sessionImports: { cpt: [], borehole: [], formation: [], section: [], contact: [] },
  hasUnsavedMutations: false,
}

beforeEach(() => {
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    getRecentProjects: vi.fn().mockResolvedValue(recent),
    listRecovery: vi.fn().mockResolvedValue(recovery),
    readRecovery: vi.fn().mockResolvedValue(payload),
    deleteRecovery: vi.fn().mockResolvedValue(undefined),
    removeRecentProject: vi.fn().mockResolvedValue(undefined),
    getSampleProjectStatus: vi.fn().mockResolvedValue({ available: false }),
  }
})
afterEach(cleanup)

describe('WelcomeScreen — the start screen lists at most four of each', () => {
  it('shows four recent projects when the store holds six', async () => {
    render(<WelcomeScreen onCreateProject={vi.fn()} onOpenProject={vi.fn()} onOpenRecent={vi.fn()} />)
    await screen.findByText('Site 0')
    expect(screen.queryAllByTestId(/^welcome-recent-entry-/)).toHaveLength(4)
    expect(screen.queryByText('Site 4')).toBeNull()
  })

  it('shows four recovered items when six crashed sessions are on disk', async () => {
    render(<WelcomeScreen onCreateProject={vi.fn()} onOpenProject={vi.fn()} onOpenRecent={vi.fn()} />)
    await waitFor(() => expect(screen.queryAllByTestId(/^welcome-recovery-entry-/).length).toBeGreaterThan(0))
    expect(screen.queryAllByTestId(/^welcome-recovery-entry-/)).toHaveLength(4)
  })
})
