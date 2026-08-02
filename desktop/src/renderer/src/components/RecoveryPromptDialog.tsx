// The prompt shown over a just-opened project that still has a recovery file.
//
// COPY DISCIPLINE (docs/design/autosave-recovery.md §1). A crash in Strix
// destroys no interpretation: every gesture — contact drag, correlation,
// litho accept, subdivide, import — is an awaited HTTP call landing in a
// PostgreSQL container whose lifecycle is independent of Electron's. So this
// dialog never says "recover your project"; the project was never at risk.
// It restores UNSAVED WORK: the session delta of six items that only ever
// lived in renderer memory.
//
// Three choices, per the design's §6 Q3 (owner approved):
//
//   * Restore unsaved work — apply the snapshot; the file STAYS, because the
//     restored state is at risk all over again and the scheduler keeps it
//     fresh from here on.
//   * Open without restoring — this dialog itself deletes nothing, and it is
//     the safe answer to an accidental Enter, so it holds default focus. But
//     the WORDING must not imply the copy is safe: a crash-reopened project
//     is at risk from the moment it mounts (the localStorage session sets
//     survive, and DB staged != saved re-seeds the dirty state), so the
//     scheduler overwrites the declined file about two seconds after the
//     open — while this dialog may still be up — and every decided exit
//     deletes it. The copy therefore promises exactly that and nothing more.
//     Whether a DECLINED file SHOULD survive is an owner decision (see the
//     note in ``useRecoveryOffer``), not one to settle in the wording.
//   * Discard unsaved work — deletes the file. Irreversible, so docs/ux.md
//     applies: destructive styling, the button names the action, and it is
//     NOT the default-focused control.
//
// Presentational only: every decision is the caller's, exactly like
// UnsavedChangesDialog, whose itemised-loss structure this mirrors.

import ConfirmDialog from './ui/ConfirmDialog'
import { formatRecoveryAge } from '../utils/recoveryAge'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'

interface Props {
  open: boolean
  /** Name of the project the recovery file belongs to. */
  projectName: string
  /** The validated payload — drives the itemised "what comes back" list. */
  snapshot: RecoverySnapshotV1
  /** ISO-8601 write time from the recovery descriptor; null when unknown. */
  writtenAt: string | null
  /** Apply the snapshot and close. The recovery file is KEPT. */
  onRestore: () => void
  /** Close and leave the file alone — Esc and the backdrop land here too. */
  onOpenWithoutRestoring: () => void
  /** Delete the recovery file and close. Irreversible. */
  onDiscard: () => void
  /** Disables every action while the restore is in flight. */
  busy?: boolean
}

/**
 * Render the snapshot's session imports as one plain-English phrase.
 *
 * Same shape as ``UnsavedChangesDialog.describeImports`` — only the kinds
 * actually present appear, so the engineer never reads a row of zeroes.
 *
 * @param snapshot - The validated recovery payload.
 * @returns The phrase, or null when nothing was imported this session.
 */
function describeImports(snapshot: RecoverySnapshotV1): string | null {
  const imports = snapshot.sessionImports
  const parts: string[] = []
  const add = (ids: readonly string[], one: string, many: string): void => {
    if (ids.length > 0) parts.push(`${ids.length} ${ids.length === 1 ? one : many}`)
  }
  add(imports.cpt, 'CPT', 'CPTs')
  add(imports.borehole, 'borehole', 'boreholes')
  add(imports.formation, 'formation', 'formations')
  add(imports.section, 'section', 'sections')
  add(imports.contact, 'geological contact', 'geological contacts')
  if (parts.length === 0) return null
  const last = parts[parts.length - 1]
  const head = parts.slice(0, -1)
  const listed = head.length === 0 ? last : `${head.join(', ')} and ${last}`
  return `${listed} imported this session.`
}

/**
 * The bullet list of what Restore brings back.
 *
 * Only the items the snapshot actually carries are listed. The manifest sets
 * are deliberately absent: the design calls them "unreconstructed, not lost"
 * — restoring them is bookkeeping the engineer never sees, and naming it
 * would only dilute the four things they do recognise.
 *
 * @param snapshot - The validated recovery payload.
 * @returns One string per restorable item, in the order they matter.
 */
function restoreBullets(snapshot: RecoverySnapshotV1): string[] {
  const bullets: string[] = []

  const columns = snapshot.ghosts.length
  if (columns > 0) {
    bullets.push(
      `Litho suggestion triage on ${columns} ${columns === 1 ? 'column' : 'columns'} — the layers you accepted, rejected, edited and split.`,
    )
  }

  const imports = describeImports(snapshot)
  if (imports !== null) bullets.push(imports)

  if (Object.keys(snapshot.metadataDraftPatch).length > 0) {
    bullets.push('Unsaved edits in the project metadata editor.')
  }

  const lumping = snapshot.lumping.current
  if (lumping !== null) {
    const entries = Object.keys(lumping.map).length
    bullets.push(
      `The stratigraphy lumping map (${entries} ${entries === 1 ? 'grouping' : 'groupings'}), applied ${formatRecoveryAge(lumping.applied_at)}.`,
    )
  }

  if (snapshot.hasUnsavedMutations) {
    // Item 6 of §2, and the nastiest of the six: without this bit the project
    // reopens looking clean, and a later Discard silently reverts the
    // database to the file — destroying pre-crash work the crash never
    // touched. Worth its own line so the engineer knows why it matters.
    bullets.push(
      'The unsaved-changes marker, so a later Discard cannot silently revert work made before the crash.',
    )
  }

  return bullets
}

/**
 * Restore / open-without / discard prompt for a project with a recovery file.
 *
 * @param props - See {@link Props}.
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function RecoveryPromptDialog({
  open,
  projectName,
  snapshot,
  writtenAt,
  onRestore,
  onOpenWithoutRestoring,
  onDiscard,
  busy = false,
}: Props): JSX.Element {
  const bullets = restoreBullets(snapshot)
  const age = writtenAt === null ? null : formatRecoveryAge(writtenAt)

  return (
    <ConfirmDialog
      open={open}
      labelledBy="recovery-prompt-title"
      testid="recovery-prompt-dialog"
      // Esc and the backdrop are the SAFE choice: they leave the file in
      // place, so a dismissal by reflex costs nothing.
      onCancel={onOpenWithoutRestoring}
      busy={busy}
      cancelLabel="Open without restoring"
      cancelTestid="recovery-open-without-restoring"
      cardClassName="w-[30rem]"
      title={
        <>
          Restore unsaved work in <span className="font-bold">{projectName}</span>?
        </>
      }
      body={
        <>
          <p>
            <span className="font-semibold text-text-primary">
              {projectName} itself is intact.
            </span>{' '}
            Everything you interpreted was saved to the database as you worked. What the
            last session did not finish writing is a copy of your in-progress work
            {age === null ? '' : `, from ${age}`}
            {bullets.length > 0 ? ':' : '.'}
          </p>
          {bullets.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {bullets.map(bullet => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            Open without restoring keeps the project as it is; this recovered copy will
            be replaced by this session&rsquo;s own unsaved work, so restore it here if
            you want it. Discarding deletes it now and cannot be undone.
          </p>
        </>
      }
      secondary={{
        label: 'Discard unsaved work',
        onClick: onDiscard,
        variant: 'danger',
        testid: 'recovery-discard',
      }}
      confirm={{
        label: 'Restore unsaved work',
        onClick: onRestore,
        variant: 'primary',
        testid: 'recovery-restore',
      }}
    />
  )
}
