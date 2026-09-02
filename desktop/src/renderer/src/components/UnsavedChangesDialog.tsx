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
// Module-level tMsg for the string-building helpers below (not components);
// useT drives the component so it re-renders on a live language flip.
import { t as tMsg, useT } from '../i18n/translate'
import { interpolateSlot } from '../i18n/interpolateSlot'

interface Props {
  open: boolean
  projectName: string
  /** What this session would lose — drives the concrete body copy. */
  summary: UnsavedWorkSummary
  /**
   * Why the previous Save / Discard click did not close the project, or null.
   *
   * Both outcomes deliberately KEEP THIS DIALOG OPEN (a failed save is
   * retryable; a refused revert must not fall through to deleting the
   * session's creates). An open dialog that says nothing about the click that
   * just failed is indistinguishable from a dead button, so the reason is
   * rendered here as well as toasted (audit 2026-08-02).
   */
  error?: string | null
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
  add(summary.importedCpts, tMsg('common.cptWordOne'), tMsg('common.cptWordMany'))
  add(summary.importedBoreholes, tMsg('common.boreholeWordOne'), tMsg('common.boreholeWordMany'))
  add(summary.importedFormations, tMsg('common.formationWordOne'), tMsg('common.formationWordMany'))
  add(summary.importedSections, tMsg('common.sectionWordOne'), tMsg('common.sectionWordMany'))
  add(
    summary.importedContacts,
    tMsg('common.geologicalContactWordOne'),
    tMsg('common.geologicalContactWordMany'),
  )
  if (parts.length === 0) return null
  const last = parts[parts.length - 1]
  const head = parts.slice(0, -1)
  const listed =
    head.length === 0 ? last : `${head.join(', ')} ${tMsg('common.listAnd')} ${last}`
  return tMsg('common.importedThisSession', { list: listed })
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
    bullets.push(tMsg('project.discardLossInterpretation'))
  }
  if (summary.hasMetadataEdits) bullets.push(tMsg('project.discardLossMetadata'))
  return bullets
}

export default function UnsavedChangesDialog({
  open,
  projectName,
  summary,
  error = null,
  onSave,
  onDiscard,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
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
    ? t('project.discardLeadSaved')
    : t('project.discardLeadUnsaved')
  const follow = summary.hasSavedSnapshot
    ? t('project.discardFollowSaved')
    : t('project.discardFollowUnsaved')

  return (
    <ConfirmDialog
      open={open}
      labelledBy="unsaved-changes-title"
      testid="unsaved-changes-dialog"
      onCancel={onCancel}
      busy={busy}
      cancelTestid="unsaved-cancel"
      cardClassName="w-[28rem]"
      title={interpolateSlot(t('project.unsavedTitle'), 'name', (
        <span className="font-bold">{projectName}</span>
      ))}
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
          <p className="mt-2">{t('project.discardBody')}</p>
          {error !== null && (
            <p
              role="alert"
              data-testid="unsaved-dialog-error"
              className="mt-3 rounded border border-red-500 bg-red-500/10 px-2 py-1.5 text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          )}
        </>
      }
      secondary={{
        label: t('project.discardChanges'),
        onClick: onDiscard,
        variant: 'ghost',
        testid: 'unsaved-discard-and-close',
      }}
      confirm={{
        label: t('common.save'),
        onClick: onSave,
        variant: 'primary',
        testid: 'unsaved-save-and-close',
      }}
    />
  )
}
