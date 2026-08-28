/**
 * Generic confirmation dialog (#165).
 *
 * Collapses the four hand-rolled confirms — ``DeleteContactConfirmDialog``,
 * ``UnsavedChangesDialog``, ``ReCorrelateConfirmDialog`` and
 * ``CopyCompositionConfirmDialog`` — which each re-derived the same shape:
 * a {@link Modal} + a ``cancelRef`` focus-on-open effect (so an accidental
 * Enter never triggers the destructive action) + a hand-styled Cancel button
 * (the plain-``<button>`` workaround from before {@link Button} forwarded refs).
 *
 * Button order follows ``docs/ux.md`` "Reversible vs irreversible": Cancel is
 * leftmost and default-focused; the destructive / primary ``confirm`` action is
 * rightmost; an optional ``secondary`` action sits between them (e.g. "Skip",
 * "Discard").
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import Button from './Button'
import Modal from './Modal'
import { useT } from '../../i18n/translate'

/** One action button in a {@link ConfirmDialog} (besides Cancel). */
export interface ConfirmDialogAction {
  /** Button label. */
  label: ReactNode
  /** Fired when the button is clicked. */
  onClick: () => void
  /** Button variant. Defaults: ``confirm`` → ``primary``, ``secondary`` →
   *  ``secondary``. Pass ``danger`` for destructive confirms. */
  variant?: 'primary' | 'danger' | 'secondary' | 'ghost'
  /** ``data-testid`` for the button. */
  testid?: string
}

interface Props {
  /** Truthy = render. The caller owns the open lifecycle. */
  open: boolean
  /** Title content (rendered inside the labelled ``<h2>``). */
  title: ReactNode
  /** Optional body content below the title. */
  body?: ReactNode
  /** The primary / destructive action (rightmost button). */
  confirm: ConfirmDialogAction
  /** Optional middle action (e.g. "Skip", "Discard"). */
  secondary?: ConfirmDialogAction
  /** Cancel button label. Defaults to the translated ``common.cancel``. */
  cancelLabel?: ReactNode
  /** ``data-testid`` for the Cancel button. */
  cancelTestid?: string
  /** Fired on Cancel / Esc / backdrop click. */
  onCancel: () => void
  /** While busy, every button is disabled and Esc / backdrop are no-ops. */
  busy?: boolean
  /** ``aria-labelledby`` id — also set as the ``<h2>`` id. */
  labelledBy: string
  /** Optional ``data-testid`` on the title ``<h2>``. */
  titleTestid?: string
  /** Inner card width class (passed to Modal). Defaults to Modal's ``w-96``. */
  cardClassName?: string
  /** Optional ``data-testid`` on the Modal card. */
  testid?: string
}

/**
 * Modal confirmation with a default-focused Cancel and one or two action
 * buttons.
 *
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  secondary,
  cancelLabel,
  cancelTestid,
  onCancel,
  busy = false,
  labelledBy,
  titleTestid,
  cardClassName,
  testid,
}: Props): JSX.Element {
  const t = useT()
  // Default focus on Cancel — an accidental Enter must NOT trigger the
  // destructive action (docs/ux.md "Reversible vs irreversible").
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy={labelledBy}
      busy={busy}
      cardClassName={cardClassName}
      testid={testid}
    >
      <div className="p-5">
        <h2
          id={labelledBy}
          data-testid={titleTestid}
          className="mb-1 text-sm font-semibold text-text-primary"
        >
          {title}
        </h2>
        {body && <div className="mb-4 text-xs text-text-secondary">{body}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
            data-testid={cancelTestid}
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
          {secondary && (
            <Button
              variant={secondary.variant ?? 'secondary'}
              size="md"
              onClick={secondary.onClick}
              disabled={busy}
              data-testid={secondary.testid}
            >
              {secondary.label}
            </Button>
          )}
          <Button
            variant={confirm.variant ?? 'primary'}
            size="md"
            onClick={confirm.onClick}
            disabled={busy}
            data-testid={confirm.testid}
          >
            {confirm.label}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
