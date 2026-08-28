// Confirmation dialog shown when the user clicks "Auto-correlate" and
// source='auto' edges already exist.
//
// Three choices (per CLAUDE.md "Reversible vs irreversible"):
//   1. Cancel (default focus — accidental Enter must not change the model)
//   2. Skip — keep existing auto edges and do nothing
//   3. Re-correlate — delete auto edges then rerun the algorithm
//
// Manual edges are NEVER deleted; the dialog body makes this explicit.
// Thin wrapper over the generic ConfirmDialog (#165): Skip is the
// secondary action, Re-correlate the destructive confirm.

import ConfirmDialog from './ui/ConfirmDialog'
import { useT } from '../i18n/translate'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** Number of existing source='auto' edges shown in the body. */
  existingAutoEdgeCount: number
  /** Fired when the user clicks Cancel (or Esc). */
  onCancel: () => void
  /** Fired when the user clicks "Skip — keep existing". */
  onSkip: () => void
  /** Fired when the user clicks "Re-correlate — delete auto edges and rerun". */
  onReCorrelate: () => void
  /** When true, all buttons are disabled (async action in flight). */
  busy?: boolean
}

export default function ReCorrelateConfirmDialog({
  open,
  existingAutoEdgeCount,
  onCancel,
  onSkip,
  onReCorrelate,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  const isOne = existingAutoEdgeCount === 1
  return (
    <ConfirmDialog
      open={open}
      labelledBy="re-correlate-confirm-title"
      testid="re-correlate-confirm-dialog"
      cardClassName="w-[28rem]"
      onCancel={onCancel}
      busy={busy}
      cancelTestid="re-correlate-cancel"
      title={t('dialog.reCorrelateTitle')}
      body={
        <>
          <p className="mb-1">
            {t(isOne ? 'dialog.reCorrelateBodyPreOne' : 'dialog.reCorrelateBodyPreMany')}{' '}
            <span className="font-semibold">{existingAutoEdgeCount}</span>{' '}
            {t(isOne ? 'dialog.reCorrelateBodyPostOne' : 'dialog.reCorrelateBodyPostMany')}
          </p>
          <p>{t('dialog.reCorrelateNote')}</p>
        </>
      }
      secondary={{
        label: t('dialog.reCorrelateSkip'),
        onClick: onSkip,
        variant: 'secondary',
        testid: 're-correlate-skip',
      }}
      confirm={{
        label: t('dialog.reCorrelateRerun'),
        onClick: onReCorrelate,
        variant: 'danger',
        testid: 're-correlate-rerun',
      }}
    />
  )
}
