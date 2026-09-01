import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock, RotateCcw } from 'lucide-react'
import Button from './ui/Button'
import { formatRecoveryAge } from '../utils/recoveryAge'
import { parseRecoverySnapshot } from '../utils/recoverySnapshot'
import { log } from '../utils/log'

interface RecentEntry {
  path: string
  name: string
  lastOpened: string
}

/**
 * One project with unsaved work left behind by a session that never reached
 * a clean exit (docs/design/autosave-recovery.md §4).
 *
 * The start screen only ROUTES: clicking an entry opens the project through
 * the ordinary recent-open path, and the restore prompt then appears over the
 * opened project. Nothing is restored from here, because restoring needs the
 * project's live state to reconcile the lumping map against.
 */
interface RecoveredEntry {
  projectId: string
  projectName: string
  /** ISO write time of the recovery file — drives the age line. */
  writtenAt: string
  /**
   * The ``.strix`` the crashed session was editing, out of the snapshot
   * payload. Null when the project was never saved to a file, or when the
   * payload is unreadable — either way there is nothing to click.
   */
  filePath: string | null
  /**
   * True when the user already answered "Open without restoring" for this
   * copy. Still a live offer — declining preserves it on purpose — but a
   * second sighting of a row you deliberately passed on reads as "it crashed
   * again" unless the row says which one it is.
   */
  declined: boolean
}

interface Props {
  // Caller decides what metadata to gather. Today the welcome screen
  // collects only the name; richer fields live in the project-metadata
  // editor that opens after creation.
  onCreateProject: (name: string) => Promise<void> | void
  // File-picker driven open. Returns a tri-state outcome so the
  // welcome screen can show its "couldn't open" banner only when the
  // open actually failed (not when the user simply cancelled the
  // dialog). ``message`` is the SPECIFIC decode reason when a file failed to
  // open (damaged / truncated / newer container); absent → show the default
  // banner.
  onOpenProject: () => Promise<{
    outcome: 'opened' | 'cancelled' | 'failed'
    message?: string
  }>
  // Click handler for a recent-projects entry. Receives the file path
  // and answers what happened, because the two failures need different
  // banners: 'missing' = the .strix is no longer at its saved location
  // (moved/renamed — owner 2026-08-17: "did you change it's location"),
  // 'failed' = the file is there but could not be opened. The entry is
  // kept in the list either way — the user may put the file back.
  // ``message`` carries the specific decode reason on a 'failed' outcome.
  onOpenRecent: (path: string) => Promise<{
    outcome: 'opened' | 'missing' | 'failed'
    message?: string
  }>
}

export default function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onOpenRecent,
}: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [recovered, setRecovered] = useState<RecoveredEntry[]>([])
  const [openError, setOpenError] = useState<string | null>(null)

  const refreshRecent = useCallback(() => {
    window.electron
      .getRecentProjects()
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [])

  // Load the recent list on mount. Fire-and-forget; an empty list just
  // hides the section. Errors here aren't worth surfacing to the user —
  // the New + Open buttons are always available.
  useEffect(() => {
    refreshRecent()
  }, [refreshRecent])

  // Recovery files left behind by a session that never reached a clean exit.
  // Read once on mount: the set cannot change while the welcome screen is up
  // (nothing is open, so nothing is writing recovery files).
  //
  // Wrapped in try/catch rather than ``.catch``: a preload without the
  // recovery channel throws SYNCHRONOUSLY on the call, and a start screen
  // that cannot start is a far worse failure than a missing banner.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const descriptors = await window.electron.listRecovery()
        // The descriptor knows the RECOVERY file's path; the project's
        // ``.strix`` lives inside the payload, so each entry costs one read.
        // Bounded by the store's own file cap, and in practice zero or one.
        const entries = await Promise.all(
          descriptors.map(async descriptor => {
            let filePath: string | null = null
            try {
              const snapshot = parseRecoverySnapshot(
                await window.electron.readRecovery(descriptor.projectId),
              )
              filePath = snapshot?.filePath ?? null
            } catch (err) {
              log.warn('recovery', `could not read ${descriptor.projectId}'s payload`, err)
            }
            return {
              projectId: descriptor.projectId,
              projectName: descriptor.projectName,
              writtenAt: descriptor.writtenAt,
              filePath,
              declined: descriptor.declined === true,
            }
          }),
        )
        if (!cancelled) setRecovered(entries)
      } catch (err) {
        // No recovered-work section, but New + Open still work.
        log.warn('recovery', 'could not list recovery files', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onCreateProject(trimmed)
    } finally {
      setBusy(false)
    }
  }

  async function handleOpen(): Promise<void> {
    if (busy) return
    setBusy(true)
    setOpenError(null)
    try {
      const { outcome, message } = await onOpenProject()
      if (outcome === 'failed') {
        // A specific decode reason (corruption / truncation / newer version)
        // wins over the generic banner — the RAM-corruption-mid-save case must
        // read LOUD and name the problem, not blame the API.
        setOpenError(
          message ??
            "Couldn't open the selected project file. The file may be corrupt, or the API isn't reachable.",
        )
        refreshRecent()
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleRecent(path: string): Promise<void> {
    if (busy) return
    setBusy(true)
    setOpenError(null)
    try {
      const { outcome, message } = await onOpenRecent(path)
      if (outcome !== 'opened') {
        const entry = recent.find(r => r.path === path)
        const name = entry ? `"${entry.name}"` : 'the project'
        setOpenError(
          outcome === 'missing'
            ? `Couldn't find the file for ${name} at ${path}. Did you move or rename it? ` +
                'Put it back, or open it from its new location with "Open project from file".'
            : // A specific decode reason wins over the generic corrupt/API banner.
              (message ??
                `Couldn't open ${name}. The file may be corrupt, or the API isn't reachable.`),
        )
        refreshRecent()
      }
    } finally {
      setBusy(false)
    }
  }

  // Clicking recovered work is just an open — the restore prompt belongs to
  // the opened project, where the lumping map can be reconciled against the
  // database. Reusing ``handleRecent`` also inherits its failure banner.
  async function handleRecovered(entry: RecoveredEntry): Promise<void> {
    if (entry.filePath === null) return
    await handleRecent(entry.filePath)
  }

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void handleCreate()
  }

  return (
    <div
      className="flex items-center justify-center h-screen bg-surface-app"
      data-testid="welcome-screen"
    >
      <div className="flex flex-col gap-3 max-w-[800px]">
        {openError !== null && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1">{openError}</div>
            <button
              onClick={() => setOpenError(null)}
              className="text-amber-700 hover:text-amber-900 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex gap-6">
        {/* Create / Open column */}
        <div className="bg-surface-page border border-border-subtle rounded-lg shadow-sm p-8 w-96">
          <h1 className="text-lg font-semibold text-text-primary mb-1">Ground Model</h1>
          <p className="text-sm text-text-secondary mb-6">
            Open an existing project file or create a new one to start importing
            and analysing data.
          </p>

          <label
            htmlFor="welcome-project-name"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            Project name
          </label>
          <input
            autoFocus
            id="welcome-project-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. GEO-22/040 Brugge"
            disabled={busy}
            data-testid="welcome-project-name-input"
            className="w-full border border-border-default rounded px-3 py-1.5 text-sm text-text-primary bg-surface-page placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent mb-4 disabled:bg-surface-card"
          />

          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || busy}
            data-testid="welcome-new-project-button"
          >
            Create project…
          </Button>

          {/* Visual divider between the two entry points. */}
          <div className="flex items-center gap-2 my-3 text-[10px] text-text-muted">
            <span className="flex-1 border-t border-border-subtle" />
            <span>or</span>
            <span className="flex-1 border-t border-border-subtle" />
          </div>

          <Button
            variant="secondary"
            size="md"
            className="w-full"
            onClick={() => void handleOpen()}
            disabled={busy}
            data-testid="welcome-open-button"
          >
            Open project from file…
          </Button>
        </div>

        {/* Right column: recovered work above recent projects. Both cards
            hide when empty — a first-launch user should see neither an empty
            placeholder nor a recovery banner. */}
        {(recovered.length > 0 || recent.length > 0) && (
        <div className="flex flex-col gap-3 w-80">
        {/* Recovered work. Deliberately QUIET — same card, same muted
            heading as the recent list, no amber alert styling. The user has
            just had a crash; the start screen's job is to offer the work
            back, not to editorialise about it. The copy says "unsaved work"
            because the project itself was never at risk
            (docs/design/autosave-recovery.md §1). */}
        {recovered.length > 0 && (
          <div className="bg-surface-page border border-border-subtle rounded-lg shadow-sm p-6 flex flex-col">
            <div className="flex items-center gap-1.5 mb-3">
              <RotateCcw size={13} className="text-text-muted" />
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Recovered work
              </h2>
            </div>
            <p className="text-[11px] text-text-muted mb-2">
              These projects closed with unsaved work. Open one to restore it.
            </p>
            <ul className="flex flex-col gap-1 -mx-2">
              {recovered.map(entry => (
                <li key={entry.projectId}>
                  <button
                    onClick={() => void handleRecovered(entry)}
                    disabled={busy || entry.filePath === null}
                    title={entry.filePath ?? undefined}
                    data-testid={`welcome-recovery-entry-${entry.projectId}`}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-card disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    <div className="text-sm text-text-primary truncate">
                      {entry.projectName || 'Untitled project'}
                    </div>
                    <div className="text-[10px] text-text-muted truncate">
                      {entry.filePath === null
                        ? 'Open the project file to restore'
                        : `from ${formatRecoveryAge(entry.writtenAt)}`}
                    </div>
                    {/* A copy the user already passed on. Quiet and secondary
                        — it changes what the row MEANS (this is not a new
                        crash) without turning the row into a warning. */}
                    {entry.declined && (
                      <div className="text-[10px] text-text-muted truncate italic">
                        You chose not to restore this earlier
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent projects. Hidden when there are no recent entries —
            first-launch users shouldn't see an empty placeholder hugging
            the create card. */}
        {recent.length > 0 && (
          <div className="bg-surface-page border border-border-subtle rounded-lg shadow-sm p-6 flex flex-col">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={13} className="text-text-muted" />
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Recent projects
              </h2>
            </div>
            <ul className="flex flex-col gap-1 overflow-y-auto max-h-80 -mx-2">
              {recent.map(entry => (
                <li key={entry.path}>
                  <button
                    onClick={() => void handleRecent(entry.path)}
                    disabled={busy}
                    title={entry.path}
                    data-testid={`welcome-recent-entry-${entry.path}`}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-card disabled:opacity-50 disabled:cursor-not-allowed group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    <div className="text-sm text-text-primary truncate">{entry.name}</div>
                    <div className="text-[10px] text-text-muted truncate font-mono">
                      {entry.path}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
        )}
        </div>
      </div>
    </div>
  )
}
