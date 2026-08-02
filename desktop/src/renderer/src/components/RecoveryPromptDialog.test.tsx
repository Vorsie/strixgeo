import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RecoveryPromptDialog from './RecoveryPromptDialog'
import { RECOVERY_SNAPSHOT_VERSION } from '../utils/recoverySnapshot'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'

// The copy discipline for this dialog comes from
// docs/design/autosave-recovery.md §1: a crash in Strix loses NO
// interpretation — every gesture is an awaited API call and Postgres outlives
// Electron. What it loses is a session delta. So the prompt restores "unsaved
// work" and must never claim to recover the project, which was never at risk.

function makeSnapshot(overrides: Partial<RecoverySnapshotV1> = {}): RecoverySnapshotV1 {
  return {
    snapshot_version: RECOVERY_SNAPSHOT_VERSION,
    filePath: 'C:/projects/site-A.strix',
    lumping: { current: null, revision: null },
    ghosts: [],
    metadataDraftPatch: {},
    manifests: { cpt: [], borehole: [], formation: [], section: [] },
    sessionImports: { cpt: [], borehole: [], formation: [], section: [], contact: [] },
    hasUnsavedMutations: false,
    ...overrides,
  }
}

/** Everything the dialog renders, flattened, for copy assertions. */
function dialogText(): string {
  return screen.getByTestId('recovery-prompt-dialog').textContent ?? ''
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof RecoveryPromptDialog>> = {},
): {
  onRestore: ReturnType<typeof vi.fn>
  onOpenWithoutRestoring: ReturnType<typeof vi.fn>
  onDiscard: ReturnType<typeof vi.fn>
} {
  const onRestore = vi.fn()
  const onOpenWithoutRestoring = vi.fn()
  const onDiscard = vi.fn()
  render(
    <RecoveryPromptDialog
      open
      projectName="Site A"
      snapshot={makeSnapshot()}
      writtenAt="2026-08-02T14:32:00Z"
      onRestore={onRestore}
      onOpenWithoutRestoring={onOpenWithoutRestoring}
      onDiscard={onDiscard}
      {...props}
    />,
  )
  return { onRestore, onOpenWithoutRestoring, onDiscard }
}

describe('RecoveryPromptDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <RecoveryPromptDialog
        open={false}
        projectName="Site A"
        snapshot={makeSnapshot()}
        writtenAt={null}
        onRestore={vi.fn()}
        onOpenWithoutRestoring={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('offers exactly three choices: restore, open without restoring, discard', () => {
    renderDialog()
    expect(screen.getByTestId('recovery-restore')).toBeInTheDocument()
    expect(screen.getByTestId('recovery-open-without-restoring')).toBeInTheDocument()
    expect(screen.getByTestId('recovery-discard')).toBeInTheDocument()
  })

  it('names the destructive action rather than saying OK', () => {
    renderDialog()
    // docs/ux.md: an irreversible action's button names the action.
    expect(screen.getByTestId('recovery-discard').textContent).toMatch(/Discard unsaved work/i)
    expect(screen.queryByRole('button', { name: /^OK$/i })).not.toBeInTheDocument()
  })

  it('gives default focus to the non-destructive choice, not to Discard', () => {
    renderDialog()
    // An accidental Enter must not throw the work away.
    expect(document.activeElement).toBe(screen.getByTestId('recovery-open-without-restoring'))
  })

  it('says it restores unsaved work — never that it recovers the project', () => {
    renderDialog()
    const text = dialogText()
    expect(text).toMatch(/unsaved work/i)
    // §1: the project itself is fine; claiming otherwise is the wrong feature
    // described in the wrong words.
    expect(text).not.toMatch(/recover your project/i)
  })

  it('says what actually happens to the copy if the user opens without restoring', () => {
    renderDialog()
    const text = dialogText()
    // A crash-reopened project is at risk from the moment it mounts (the
    // localStorage session sets survive, and staged != saved re-seeds the
    // dirty flag), so the scheduler overwrites the declined file about two
    // seconds after the open — while this dialog may still be up. The copy
    // must say that, not that declining leaves the copy safe "for now".
    expect(text).toMatch(/replaced by this session/i)
    expect(text).not.toMatch(/leaves this copy alone/i)
    // And still no promise that a restart re-offers it — every decided exit
    // deletes the file too. Promising otherwise would be worse than silence.
    expect(text).not.toMatch(/restart/i)
  })

  it('shows how old the recovery copy is', () => {
    renderDialog({ writtenAt: new Date(2026, 7, 2, 14, 32).toISOString() })
    expect(dialogText()).toMatch(/14:32/)
  })

  it('itemises what will come back: ghosts, imports, metadata draft and the lumping map', () => {
    renderDialog({
      snapshot: makeSnapshot({
        ghosts: [
          ['anchor-1', { kind: 'cpt', suggestions: [], surfaceElevationM: null, accepted: [], rejected: [], edits: [] }],
          ['anchor-2', { kind: 'borehole', suggestions: [], surfaceElevationM: null, accepted: [], rejected: [], edits: [] }],
        ],
        metadataDraftPatch: { name: 'Renamed site' },
        sessionImports: {
          cpt: ['c1', 'c2', 'c3'],
          borehole: ['b1'],
          formation: [],
          section: [],
          contact: [],
        },
        lumping: {
          current: { schema_version: 1, applied_at: '2026-08-02T11:00:00Z', map: { a: 'A' } },
          revision: 4,
        },
      }),
    })
    const text = dialogText()
    expect(text).toMatch(/2 columns/i)
    expect(text).toMatch(/3 CPTs/)
    expect(text).toMatch(/1 borehole/)
    expect(text).toMatch(/metadata/i)
    expect(text).toMatch(/stratigraphy lumping/i)
  })

  it('does not list items the snapshot does not carry', () => {
    renderDialog()
    const text = dialogText()
    // An empty snapshot must not read as a row of zeroes.
    expect(text).not.toMatch(/0 columns/)
    expect(text).not.toMatch(/stratigraphy lumping/i)
  })

  it('fires the matching handler for each of the three choices', () => {
    const { onRestore, onOpenWithoutRestoring, onDiscard } = renderDialog()
    fireEvent.click(screen.getByTestId('recovery-restore'))
    expect(onRestore).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('recovery-open-without-restoring'))
    expect(onOpenWithoutRestoring).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('recovery-discard'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('treats Escape as "open without restoring" so the file survives a dismissal', () => {
    const { onOpenWithoutRestoring, onDiscard } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenWithoutRestoring).toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })
})
