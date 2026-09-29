// "These boreholes are already in the project: replace them with this file?"
//
// Re-importing a DOV borehole XML file whose borings are already stored
// replaces their drill segments, field log and descriptions in place. There is
// no undo, so the engineer is asked per FILE, on the numbers for every boring
// the file would overwrite (a truncated export and the good one share a name).
// The borehole twin of CptRefreshConfirmDialog; a file can hold several
// borings, hence a table rather than the CPT dialog's two rows.
//
// docs/ux.md "Reversible vs irreversible": confirmation dialog, Cancel
// default-focused (ConfirmDialog does that), action-named button.

import type { BoreholeRefreshDiff } from '../api/client'
import { useT } from '../i18n/translate'
import ConfirmDialog from './ui/ConfirmDialog'

interface Props {
  /** Truthy = render. The caller owns the open lifecycle. */
  open: boolean
  /** The file being imported. */
  fileName: string
  /** One row per boring the file would overwrite. */
  diffs: BoreholeRefreshDiff[]
  /** "Replace boreholes". */
  onConfirm: () => void
  /** Cancel / Esc / backdrop: the stored boreholes stay as they are. */
  onCancel: () => void
}

/** Format a depth; ``—`` when the value is unknown. */
function depth(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} m`
}

/**
 * Confirmation for the irreversible borehole refresh-on-reimport write.
 *
 * @returns The dialog element (nothing when ``open`` is false).
 */
export default function BoreholeRefreshConfirmDialog({
  open,
  fileName,
  diffs,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const t = useT()
  return (
    <ConfirmDialog
      open={open && diffs.length > 0}
      labelledBy="borehole-refresh-confirm-title"
      testid="borehole-refresh-confirm-dialog"
      cardClassName="w-[32rem] max-w-[92vw]"
      onCancel={onCancel}
      title={t('data.boreholeRefresh.title')}
      body={
        <>
          <p className="mb-2">
            <span className="font-mono">{fileName}</span>
            {t('data.boreholeRefresh.body')}
          </p>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-text-secondary">
                  <th className="font-normal">{t('data.boreholeRefresh.borehole')}</th>
                  <th className="font-normal">{t('data.boreholeRefresh.depth')}</th>
                  <th className="font-normal">{t('data.boreholeRefresh.layers')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {diffs.map(d => (
                  <tr key={d.boreholeId} data-testid="borehole-refresh-row">
                    <td className="pr-3 font-sans">{d.name}</td>
                    <td className="pr-3">
                      {depth(d.oldTotalDepthM)} → {depth(d.newTotalDepthM)}
                    </td>
                    <td>
                      {d.oldNLithoLayers} → {d.newNLithoLayers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      }
      confirm={{
        label: t('data.boreholeRefresh.replace'),
        onClick: onConfirm,
        variant: 'danger',
        testid: 'borehole-refresh-confirm',
      }}
      cancelTestid="borehole-refresh-cancel"
    />
  )
}
