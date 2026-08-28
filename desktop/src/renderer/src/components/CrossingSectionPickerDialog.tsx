// Section picker for the surface-crossings banner (dogfeed 2026-05-30).
//
// Opens when the user clicks a crossing issue and the offending
// contacts live on anchors that fall inside MORE THAN ONE
// cross-section's projection buffer.  Lets the engineer pick which
// section to navigate to.  When only one section contains the
// offending anchors the caller bypasses the dialog and dispatches
// directly — the dialog never opens for the unambiguous case.
//
// Behaviour mirrors LithoGeoSnapDialog: Esc + Cancel both dismiss
// without picking; the primary action is default-focused.

import { useEffect, useRef, useState } from 'react'

import type { CrossSectionResponse } from '../api/client'
import Button from './ui/Button'
import Modal from './ui/Modal'
import { useT } from '../i18n/translate'

interface Props {
  /** Truthy → render the dialog. */
  open: boolean
  /** Candidate sections — pre-filtered by ``resolveCandidateCrossingSections``
   *  to those whose buffer contains at least one offending anchor.
   *  Rendered in the input order. */
  candidates: readonly CrossSectionResponse[]
  /** Picked section → navigate + pan + amber-pulse. */
  onPick: (sectionId: string) => void
  /** Dismiss without picking. Fired by Esc, Cancel, and backdrop click. */
  onCancel: () => void
}

export default function CrossingSectionPickerDialog({
  open,
  candidates,
  onPick,
  onCancel,
}: Props): JSX.Element | null {
  const t = useT()
  const [selectedId, setSelectedId] = useState<string | null>(
    candidates.length > 0 ? candidates[0].id : null,
  )
  useEffect(() => {
    if (!open) return
    setSelectedId(candidates.length > 0 ? candidates[0].id : null)
  }, [open, candidates])

  const goBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) goBtnRef.current?.focus()
  }, [open])

  if (!open) return null
  if (candidates.length === 0) return null
  if (selectedId === null) return null

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="crossing-section-picker-title"
      cardClassName="w-[28rem]"
      testid="crossing-section-picker-dialog"
    >
      <div className="p-5">
        <h2
          id="crossing-section-picker-title"
          className="text-sm font-semibold text-text-primary mb-1"
        >
          {t('dialog.crossingPickerTitle')}
        </h2>
        <p className="text-xs text-text-secondary mb-3">
          {t('dialog.crossingPickerBodyPre')}{' '}
          <span className="font-semibold">{candidates.length}</span>{' '}
          {t('dialog.crossingPickerBodyPost')}
        </p>

        <fieldset className="mb-4 space-y-1.5 max-h-60 overflow-y-auto">
          <legend className="sr-only">{t('dialog.crossingPickerBlurb')}</legend>
          {candidates.map(s => {
            const checked = selectedId === s.id
            return (
              <label
                key={s.id}
                className="flex items-baseline gap-2 text-xs text-text-primary cursor-pointer"
              >
                <input
                  type="radio"
                  name="crossing-section-picker"
                  data-testid={`crossing-section-candidate-${s.id}`}
                  checked={checked}
                  onChange={() => setSelectedId(s.id)}
                />
                <span className="font-semibold">{s.name}</span>
                {s.description && (
                  <span className="text-text-secondary truncate">
                    {s.description}
                  </span>
                )}
              </label>
            )
          })}
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            data-testid="crossing-section-picker-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            ref={goBtnRef}
            variant="primary"
            size="md"
            onClick={() => onPick(selectedId)}
            data-testid="crossing-section-picker-go"
          >
            {t('dialog.crossingPickerOpen')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
