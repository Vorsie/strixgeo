/**
 * The confirmation of a Reset to DOV (owner 2026-09-30: "there needs to be a
 * per borehole button to reset to dov defaults").
 *
 * The reset throws away every hand edit on the DOV tracks it rewrites and has
 * no undo, so it is an irreversible action by docs/ux.md: Cancel is
 * default-focused, the button names the action ("Reset to DOV"), and the text
 * says how many tracks edited by hand lose their edits. Manual tracks are never
 * touched, and the text says that too.
 */
import { useT } from '../../../i18n/translate'
import type { BoreholeTrackSummary } from '../../../utils/boreholeTracks'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { trackKindLabel } from './trackLabels'

interface Props {
  /** The pending reset: ``null`` = closed; ``{ track: null }`` = the whole
   *  borehole; ``{ track }`` = that one track. */
  pending: { track: BoreholeTrackSummary | null } | null
  /** The borehole's tracks with a DOV origin (the whole-borehole scope). */
  dovTracks: readonly BoreholeTrackSummary[]
  boreholeName: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * How many tracks of the reset's scope carry hand edits.
 *
 * @param pending - The pending reset (``track: null`` = every DOV track).
 * @param dovTracks - The borehole's DOV-origin tracks.
 * @returns The number of "Edited by hand" tracks the reset rewrites.
 */
export function editedTracksInScope(
  pending: { track: BoreholeTrackSummary | null },
  dovTracks: readonly BoreholeTrackSummary[],
): number {
  const scope = pending.track ? [pending.track] : dovTracks
  return scope.filter(tr => tr.badge === 'edited').length
}

/**
 * Reset-to-DOV confirmation dialog.
 *
 * @returns The dialog (closed while ``pending`` is null).
 */
export default function ResetToDovConfirm({
  pending,
  dovTracks,
  boreholeName,
  busy,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const t = useT()
  const edited = pending === null ? 0 : editedTracksInScope(pending, dovTracks)
  const editsText =
    edited === 0
      ? t('tracks.reset.editsNone')
      : edited === 1
        ? t('tracks.reset.editsOne')
        : t('tracks.reset.editsMany', { n: edited })
  return (
    <ConfirmDialog
      open={pending !== null}
      labelledBy="borehole-track-reset-title"
      title={t('tracks.reset.title')}
      body={
        pending && (
          <>
            <p>
              {pending.track === null
                ? t('tracks.reset.bodyAll', { name: boreholeName })
                : t('tracks.reset.bodyTrack', {
                    kind: trackKindLabel(t, pending.track.kind),
                    name: boreholeName,
                  })}
            </p>
            <p className="mt-1">{editsText}</p>
            <p className="mt-1">{t('tracks.reset.noUndo')}</p>
          </>
        )
      }
      confirm={{
        label: t('tracks.reset.confirm'),
        variant: 'danger',
        onClick: onConfirm,
        testid: 'borehole-track-reset-confirm',
      }}
      onCancel={onCancel}
      busy={busy}
    />
  )
}
