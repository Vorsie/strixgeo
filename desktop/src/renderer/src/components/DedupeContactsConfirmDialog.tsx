// Confirmation shown before "Dedupe" deletes duplicate formation contacts.
//
// Dedupe DB-deletes rows. The engineer's own picks are among them: the survivor
// rule protects a hand pick from being evicted by an auto one, but where he has
// placed two picks on the same formation at the same investigation, one of the
// two is deleted. Nothing puts it back — the backend returns the removed ids but
// no command re-creates them, and POST /contacts would refuse the insert anyway
// because the survivor still occupies the (model, anchor, formation) key.
//
// So this is irreversible in the docs/ux.md sense, and gets the full treatment:
// Cancel default-focused, an action-named confirm, and a body that says how much
// is at stake before the click rather than a count in the toast afterwards.
//
// The count comes from the contact list the caller already holds (see
// ``countDuplicateContacts``), so it is a preview of the server's decision, not
// a promise. When it is zero the dialog says so instead of inventing a number,
// and still allows the run — the loaded list can be behind the saved model, and
// a cleanup verb that refuses to check is a worse failure than a redundant run.
//
// Thin wrapper over the generic ConfirmDialog (#165), like
// ReSubdivideConfirmDialog: no secondary action, just Cancel + the destructive
// confirm.

import ConfirmDialog from './ui/ConfirmDialog'
import { useT } from '../i18n/translate'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** How many contacts the run is expected to delete. Zero = nothing found. */
  duplicateContacts: number
  /** Across how many (investigation, formation) pairs those duplicates sit. */
  duplicatePairs: number
  /** Fired when the user clicks Cancel (or Esc / backdrop). */
  onCancel: () => void
  /** Fired when the user clicks "Remove duplicates". */
  onConfirm: () => void
  /** When true, both buttons are disabled (the cleanup is in flight). */
  busy?: boolean
}

/**
 * Confirmation modal gating the Dedupe-contacts cleanup.
 *
 * Renders a {@link ConfirmDialog} with a default-focused Cancel and a single
 * destructive "Remove duplicates" confirm. The body states the expected loss,
 * which pick survives each pair, and that the deletion cannot be undone.
 *
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function DedupeContactsConfirmDialog({
  open,
  duplicateContacts,
  duplicatePairs,
  onCancel,
  onConfirm,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  const oneContact = duplicateContacts === 1
  const onePair = duplicatePairs === 1
  return (
    <ConfirmDialog
      open={open}
      labelledBy="dedupe-contacts-confirm-title"
      testid="dedupe-contacts-confirm-dialog"
      cardClassName="w-[28rem]"
      cancelTestid="dedupe-contacts-cancel"
      onCancel={onCancel}
      busy={busy}
      title={t('dialog.dedupeTitle')}
      body={
        <>
          {duplicateContacts > 0 ? (
            <p data-testid="dedupe-contacts-count">
              <span className="font-semibold">
                {t(oneContact ? 'dialog.dedupeCountOne' : 'dialog.dedupeCountMany', {
                  n: duplicateContacts,
                })}
              </span>{' '}
              {t(onePair ? 'dialog.dedupePairsOne' : 'dialog.dedupePairsMany', {
                pairs: duplicatePairs,
              })}
            </p>
          ) : (
            /* No number to quote — but the loaded list may lag the saved model,
               so the check itself still has to be reachable. */
            <p data-testid="dedupe-contacts-nothing">{t('dialog.dedupeNothing')}</p>
          )}
          {/* Which pick survives is the question the engineer actually has when he
              reads a delete count, and the answer is not obvious from the button. */}
          <p className="mt-2" data-testid="dedupe-contacts-survivor">
            {t('dialog.dedupeRule')}
          </p>
          {/* The only recovery is the project-wide one, and it is worth naming
              precisely: it rolls back everything since the last save, not just
              this cleanup, and it does nothing for a project never yet saved. */}
          <p className="mt-2 text-text-secondary">{t('dialog.dedupeUndo')}</p>
        </>
      }
      confirm={{
        label: t('dialog.dedupeConfirm'),
        onClick: onConfirm,
        variant: 'danger',
        testid: 'dedupe-contacts-confirm',
      }}
    />
  )
}
