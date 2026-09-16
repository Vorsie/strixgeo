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
// Three choices, per the design's §6 Q3 (owner approved). COPY SHAPE (owner
// dogfeed 2026-08-03): the first version explained the slot mechanics in
// prose and the owner could not tell what the buttons would do — so the body
// is now a three-line legend, one line per button, and the mechanics prose is
// gone. The one sentence the owner dictated verbatim: "nothing is saved to
// the file until you click Save in the app."
//
//   * Restore — apply the snapshot; the file STAYS, because the restored
//     state is at risk all over again and the scheduler keeps it fresh.
//   * Not now — PRESERVES the copy (owner decision 2026-08-03, Word-style)
//     and is the safe answer to an accidental Enter, so it holds default
//     focus: the caller moves the copy to a slot the autosave scheduler
//     never writes, so the next launch offers the same unsaved work again.
//   * Delete backup — as if the session never happened (owner ruling
//     2026-08-03, second half): the caller reverts the DATABASE to the last
//     save before the file dies, so crash-session mutations (a destructive
//     Apply, a bad delete) do not silently survive an answer that reads as
//     "throw that session away". Irreversible, so docs/ux.md applies:
//     destructive styling, the button names the action, and it is NOT the
//     default-focused control.
//
// Presentational only: every decision is the caller's, exactly like
// UnsavedChangesDialog, whose itemised-loss structure this mirrors.

import ConfirmDialog from './ui/ConfirmDialog'
import { formatRecoveryAge } from '../utils/recoveryAge'
import type { RecoverySnapshotV1 } from '../utils/recoverySnapshot'
// Module-level tMsg for the string-building helpers below (not components);
// useT drives the component so it re-renders on a live language flip.
import { t as tMsg, useT } from '../i18n/translate'

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
  add(imports.cpt, tMsg('common.cptWordOne'), tMsg('common.cptWordMany'))
  add(imports.borehole, tMsg('common.boreholeWordOne'), tMsg('common.boreholeWordMany'))
  add(imports.formation, tMsg('common.formationWordOne'), tMsg('common.formationWordMany'))
  add(imports.section, tMsg('common.sectionWordOne'), tMsg('common.sectionWordMany'))
  add(
    imports.contact,
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
      tMsg('welcome.recoveryLithoTriage', {
        count: columns,
        columnWord: columns === 1 ? tMsg('common.columnWordOne') : tMsg('common.columnWordMany'),
      }),
    )
  }

  const imports = describeImports(snapshot)
  if (imports !== null) bullets.push(imports)

  if (Object.keys(snapshot.metadataDraftPatch).length > 0) {
    bullets.push(tMsg('welcome.recoveryMetadataEdits'))
  }

  const lumping = snapshot.lumping.current
  if (lumping !== null) {
    const entries = Object.keys(lumping.map).length
    bullets.push(
      tMsg('welcome.recoveryLumpingMap', {
        count: entries,
        groupingWord:
          entries === 1 ? tMsg('common.groupingWordOne') : tMsg('common.groupingWordMany'),
      }),
    )
  }

  if (snapshot.hasUnsavedMutations) {
    // Item 6 of §2, and the nastiest of the six: without this bit the project
    // reopens looking clean, and a later Discard silently reverts the
    // database to the file — destroying pre-crash work the crash never
    // touched. Kept in the list but no longer explained in the dialog — the
    // explanation made the copy longer than the decision (owner dogfeed).
    bullets.push(tMsg('welcome.recoveryUnsavedMarker'))
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
  const t = useT()
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
      cancelLabel={t('welcome.recoveryNotNow')}
      cancelTestid="recovery-open-without-restoring"
      cardClassName="w-[30rem]"
      title={t('welcome.recoveryTitle', { name: projectName })}
      body={
        <>
          <p>
            {t('welcome.recoveryIntro', { age: age === null ? '' : ` ${age}` })}
            {bullets.length > 0 ? `: ${bullets.join(' · ')}.` : '.'}{' '}
            <span className="font-semibold text-text-primary">
              {t('welcome.recoverySavedUntouched')}
            </span>
          </p>
          {/* One line per button, in button order. This legend IS the body —
              the owner's dogfeed verdict on the prose version was "text is
              too long and it is unclear what happens". */}
          <ul className="mt-3 space-y-1.5">
            <li>
              <span className="font-semibold text-text-primary">
                {t('welcome.recoveryRestore')}
              </span>{' '}
              {t('welcome.recoveryRestoreDesc')}
            </li>
            <li>
              <span className="font-semibold text-text-primary">
                {t('welcome.recoveryNotNow')}
              </span>{' '}
              {t('welcome.recoveryNotNowDesc')}
            </li>
            <li>
              <span className="font-semibold text-text-primary">
                {t('welcome.recoveryDeleteBackup')}
              </span>{' '}
              {t('welcome.recoveryDeleteBackupDesc')}
            </li>
          </ul>
        </>
      }
      secondary={{
        label: t('welcome.recoveryDeleteBackup'),
        onClick: onDiscard,
        variant: 'danger',
        testid: 'recovery-discard',
      }}
      confirm={{
        label: t('welcome.recoveryRestore'),
        onClick: onRestore,
        variant: 'primary',
        testid: 'recovery-restore',
      }}
    />
  )
}
