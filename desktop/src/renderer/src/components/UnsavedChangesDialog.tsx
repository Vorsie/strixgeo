// Save / Discard / Cancel prompt shown when the user closes a project that
// still holds unsaved session work.
//
// Three-button shape (Word / Pages / VS Code convention): Save (commit +
// proceed), Discard (drop + proceed), Cancel (do nothing, default focus).
// Thin wrapper over the generic ConfirmDialog (#165): Discard is the
// secondary action, Save the primary confirm.
//
// The body copy is load-bearing. Discard is NOT "your typed values are
// lost" — ``handleUnsavedDiscard`` replace-restores the entire project in
// the database from the last-saved .gmproj, so an afternoon of correlating,
// dragging boundaries and accepting suggestions reverts with it, and the
// dialog opens for any session work in any stage (not just the metadata
// editor). This is the most destructive gesture in the app; the copy has to
// name what it takes so the engineer can choose with the facts. It is also
// irreversible, so docs/ux.md applies: Cancel holds default focus and both
// action buttons name their action.

import ConfirmDialog from './ui/ConfirmDialog'
import type { UnsavedWorkSummary } from '../utils/unsavedWorkSummary'

interface Props {
  open: boolean
  projectName: string
  /** What this session would lose — drives the concrete body copy. */
  summary: UnsavedWorkSummary
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
  // Disables every action while a save is in flight so we can't
  // double-fire the editor's submit() during a slow API.
  busy?: boolean
}

/**
 * Render the session's imports as one plain-English phrase, e.g.
 * "3 CPTs, 1 borehole and 2 sections imported this session".
 *
 * Only the kinds that were actually imported appear, so the engineer never
 * reads a row of zeroes. Returns null when nothing was imported, in which
 * case the caller drops the bullet entirely.
 */
function describeImports(summary: UnsavedWorkSummary): string | null {
  const parts: string[] = []
  const add = (count: number, one: string, many: string): void => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`)
  }
  add(summary.importedCpts, 'CPT', 'CPTs')
  add(summary.importedBoreholes, 'borehole', 'boreholes')
  add(summary.importedFormations, 'formation', 'formations')
  add(summary.importedSections, 'section', 'sections')
  add(summary.importedContacts, 'geological contact', 'geological contacts')
  if (parts.length === 0) return null
  const last = parts[parts.length - 1]
  const head = parts.slice(0, -1)
  const listed = head.length === 0 ? last : `${head.join(', ')} and ${last}`
  return `${listed} imported this session.`
}

/**
 * The bullet list of everything Discard takes.
 *
 * Imports carry real counts (the session-import id sets are tracked per
 * kind). Interpretation edits do NOT — the two-stage save model only keeps a
 * boolean "something was mutated" flag, so the bullet says the work is
 * uncounted rather than showing a number we do not have.
 */
function lossBullets(summary: UnsavedWorkSummary): string[] {
  const bullets: string[] = []
  const imports = describeImports(summary)
  if (imports !== null) bullets.push(imports)
  if (summary.hasInterpretationEdits) {
    bullets.push(
      'Correlations, boundary moves, accepted suggestions and deletions made this session, in any stage — these are not counted here.',
    )
  }
  if (summary.hasMetadataEdits) bullets.push('Unsaved edits in the project metadata editor.')
  return bullets
}

export default function UnsavedChangesDialog({
  open,
  projectName,
  summary,
  onSave,
  onDiscard,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const bullets = lossBullets(summary)

  // A never-saved project has no .gmproj to restore from, so Discard cannot
  // "revert" anything — it deletes the session's creates instead. Promising a
  // revert there would be the same class of lie the old copy told.
  //
  // The lead never opens on the metadata editor. That framing is what made
  // the old copy read as "your typing is at stake" to an engineer who had
  // spent the afternoon correlating; the editor now appears only in its own
  // bullet, and only when it actually holds a draft.
  const lead = summary.hasSavedSnapshot
    ? 'Discard reverts the whole project — in the database, across every stage — to its last saved state.'
    : 'This project has never been saved to a file, so Discard has no saved state to go back to.'
  const follow = summary.hasSavedSnapshot
    ? 'Everything done since the last File → Save is lost'
    : 'It removes everything this session added to the project'

  return (
    <ConfirmDialog
      open={open}
      labelledBy="unsaved-changes-title"
      testid="unsaved-changes-dialog"
      onCancel={onCancel}
      busy={busy}
      cancelTestid="unsaved-cancel"
      cardClassName="w-[28rem]"
      title={
        <>
          Save changes to <span className="font-bold">{projectName}</span>?
        </>
      }
      body={
        <>
          <p>
            <span className="font-semibold text-text-primary">{lead}</span>{' '}
            {`${follow}${bullets.length > 0 ? ':' : '.'}`}
          </p>
          {bullets.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {bullets.map(bullet => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            Discarding cannot be undone. Cancel keeps the project open so you can save.
          </p>
        </>
      }
      secondary={{
        label: 'Discard all changes',
        onClick: onDiscard,
        variant: 'ghost',
        testid: 'unsaved-discard-and-close',
      }}
      confirm={{
        label: 'Save',
        onClick: onSave,
        variant: 'primary',
        testid: 'unsaved-save-and-close',
      }}
    />
  )
}
