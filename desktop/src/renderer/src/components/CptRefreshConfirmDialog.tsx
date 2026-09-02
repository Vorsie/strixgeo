// "This CPT is already in the project — replace its data with this file?"
//
// Re-importing a GEF whose CPT is already stored REPLACES the series and the
// header in place. There is no undo, and every contact / litho layer anchored
// on the old depths now sits against different numbers — so the engineer is
// asked per file, and asked on the NUMBERS rather than on a filename (a
// truncated download and the good original have the same name).
//
// docs/ux.md "Reversible vs irreversible": confirmation dialog, Cancel
// default-focused, action-named button ("Replace data", never "OK").

import type { CptRefreshDiff } from '../api/client'
import ConfirmDialog from './ui/ConfirmDialog'
import { useT } from '../i18n/translate'

interface Props {
  /** Truthy = render. The caller owns the open lifecycle. */
  open: boolean
  /** Name of the file being imported — the engineer picked it seconds ago. */
  fileName: string
  /** Old-vs-new numbers from the backend's refusal. */
  diff: CptRefreshDiff | null
  /** Fired when the user clicks "Replace data". */
  onConfirm: () => void
  /** Fired on Cancel / Esc / backdrop click — the stored CPT is left as it is. */
  onCancel: () => void
}

/** Format a depth for the diff table; ``—`` when the backend has no value. */
function depth(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} m`
}

/** Format a row count for the diff table; ``—`` when unknown. */
function rows(value: number | null): string {
  return value === null ? '—' : `${value}`
}

/**
 * Confirmation for the irreversible refresh-on-reimport write.
 *
 * @returns The dialog element (nothing when ``open`` is false).
 */
export default function CptRefreshConfirmDialog({
  open,
  fileName,
  diff,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const t = useT()
  return (
    <ConfirmDialog
      open={open && diff !== null}
      labelledBy="cpt-refresh-confirm-title"
      testid="cpt-refresh-confirm-dialog"
      cardClassName="w-[26rem]"
      onCancel={onCancel}
      title={
        <>
          {t('dialog.cptRefreshTitlePre')}{' '}
          <span className="font-bold">{diff?.name ?? ''}</span>
          {t('dialog.cptRefreshTitlePost')}
        </>
      }
      body={
        <>
          <p className="mb-2">
            <span className="font-mono">{fileName}</span>
            {t('dialog.cptRefreshBody')}
          </p>
          <table className="w-full text-left" data-testid="cpt-refresh-diff">
            <thead>
              <tr className="text-text-secondary">
                <th className="font-normal" />
                <th className="font-normal">{t('dialog.cptRefreshStored')}</th>
                <th className="font-normal">{t('dialog.cptRefreshThisFile')}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr>
                <td className="pr-3 font-sans">{t('common.depth')}</td>
                <td className="pr-3">{depth(diff?.oldMaxDepthM ?? null)}</td>
                <td>{depth(diff?.newMaxDepthM ?? null)}</td>
              </tr>
              <tr>
                <td className="pr-3 font-sans">{t('dialog.cptRefreshReadings')}</td>
                <td className="pr-3">{rows(diff?.oldNRows ?? null)}</td>
                <td>{rows(diff?.newNRows ?? null)}</td>
              </tr>
            </tbody>
          </table>
          {(diff?.nWarnings ?? 0) > 0 && (
            <p className="mt-2">
              {t(
                diff?.nWarnings === 1
                  ? 'dialog.cptRefreshWarningsOne'
                  : 'dialog.cptRefreshWarningsMany',
                { n: diff?.nWarnings ?? 0 },
              )}
            </p>
          )}
        </>
      }
      confirm={{
        label: t('dialog.cptRefreshReplace'),
        onClick: onConfirm,
        variant: 'danger',
        testid: 'cpt-refresh-confirm',
      }}
      cancelTestid="cpt-refresh-cancel"
    />
  )
}
