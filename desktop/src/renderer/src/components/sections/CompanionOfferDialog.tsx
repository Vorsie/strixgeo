/**
 * Follow-up dialog shown after a litho lens is created.
 *
 * Offers to auto-create a perpendicular companion cross-section through
 * the lens centroid (owner directive 2026-05-22, Blocker 1 fix).  The
 * user can accept (Yes → POST perpendicular-companion → refresh section
 * list → select new section + toast) or decline (No → close silently).
 *
 * Idempotency: the backend returns 200 + the existing section when a
 * companion already exists.  The dialog handles 200 and 201 the same way
 * — it always refreshes the list and selects the companion.
 */

import { useState } from 'react'

import { api } from '../../api/client'
import { log } from '../../utils/log'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useT } from '../../i18n/translate'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  open: boolean
  projectId: string
  modelId: string
  lensId: string
  /** Optional human name for the lens — shown in the dialog copy. */
  lensName: string | null
  /** Called after a companion is successfully created (or already existed). */
  onSectionCreated: (sectionId: string) => void
  /** Called when the dialog is dismissed without creating. */
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Offer to auto-create a perpendicular companion section for a new lens.
 *
 * Parameters
 * ----------
 * open : boolean
 *     Whether the dialog is visible.
 * projectId : string
 *     Project scope.
 * modelId : string
 *     Active lithostratigraphic model id.
 * lensId : string
 *     The newly-created lens.
 * lensName : string | null
 *     Optional display name for the lens.
 * onSectionCreated : (sectionId: string) => void
 *     Fired after the companion section is committed.  The caller should
 *     refresh its section list and navigate to ``sectionId``.
 * onClose : () => void
 *     Fired when the user declines or after onSectionCreated fires.
 */
export default function CompanionOfferDialog({
  open,
  projectId,
  modelId,
  lensId,
  lensName,
  onSectionCreated,
  onClose,
}: Props): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useT()

  async function handleYes(): Promise<void> {
    setBusy(true)
    setError(null)
    log.info(
      '[CompanionOfferDialog] creating perpendicular companion for lens',
      lensId,
    )
    try {
      const companion = await api.geology.createPerpendicularCompanion(
        projectId,
        modelId,
        lensId,
      )
      log.info(
        '[CompanionOfferDialog] companion section ready:',
        companion.id,
        companion.name,
      )
      onSectionCreated(companion.id)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[CompanionOfferDialog] companion creation failed', err)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      labelledBy="companion-offer-title"
      busy={busy}
      cardClassName="w-[28rem]"
    >
      <div className="p-5 space-y-4">
        {/* Header */}
        <div>
          <h2
            id="companion-offer-title"
            className="text-sm font-semibold text-text-primary"
          >
            {t('sections.lens.companionTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {lensName
              ? t('sections.companion.lensNamedCreated', { name: lensName })
              : t('sections.companion.lensCreated')}{' '}
            {t('sections.companion.blurb')}
          </p>
        </div>

        {/* Error */}
        {error !== null && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-2.5 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('sections.lens.companionSkip')}
          </Button>
          <Button variant="primary" onClick={handleYes} disabled={busy}>
            {busy ? t('sections.busy.creating') : t('sections.companion.yesCreate')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
