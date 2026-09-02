// Confirmation dialog for the Alt-drag "copy composition" gesture
// when the drop target already has an existing edit (debt #86 owner
// directive: confirm on overwrite).
//
// Thin wrapper over the generic ConfirmDialog (#165): default-focus
// Cancel + action-named "Replace" confirm. Names the source + target
// compositions so the engineer sees what they're replacing.

import type { LithoLayerSuggestion } from '../../api/client'
import { lithoDisplayName } from '../../utils/lithoLabels'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useT } from '../../i18n/translate'

interface Props {
  open: boolean
  /** The composition being copied (the dragged layer). */
  sourceLayer: LithoLayerSuggestion | null
  /** Effective composition currently sitting on the drop target. */
  targetLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

export default function CopyCompositionConfirmDialog({
  open,
  sourceLayer,
  targetLabel,
  onConfirm,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  const sourceLabel =
    sourceLayer !== null
      ? lithoDisplayName(
          sourceLayer.suggested_lithology,
          sourceLayer.suggested_admixtures ?? [],
        )
      : '?'

  return (
    <ConfirmDialog
      open={open}
      labelledBy="copy-composition-confirm-title"
      titleTestid="copy-composition-title"
      cardClassName="w-[28rem]"
      onCancel={onCancel}
      busy={busy}
      cancelTestid="copy-composition-cancel"
      title={t('sections.copyComposition.title')}
      body={
        <>
          <p className="mb-3">{t('sections.copyComposition.body')}</p>
          <div className="space-y-1 text-text-primary">
            <div>
              <span className="text-text-muted">{t('sections.copyComposition.from')}</span>{' '}
              <span className="font-semibold" data-testid="copy-composition-source">
                {sourceLabel}
              </span>
            </div>
            <div>
              <span className="text-text-muted">{t('sections.copyComposition.toCurrently')}</span>{' '}
              <span className="font-semibold" data-testid="copy-composition-target">
                {targetLabel}
              </span>
            </div>
          </div>
        </>
      }
      confirm={{
        label: t('sections.copyComposition.replace'),
        onClick: onConfirm,
        variant: 'primary',
        testid: 'copy-composition-submit',
      }}
    />
  )
}
