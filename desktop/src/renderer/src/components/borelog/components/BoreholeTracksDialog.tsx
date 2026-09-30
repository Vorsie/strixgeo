/**
 * The borehole's Tracks panel (owner 2026-09-29: "can i manually add tracks?"
 * -> "i want to add columns on the borehole itself" -> "i want to be able to
 * add or change any track").
 *
 * Two views in one modal:
 *
 * * the LIST — every track with its kind, provenance badge (DOV / Manual /
 *   Edited by hand, the raw ``source`` token as tooltip), interval count and
 *   whether the cross-sections draw it; "Add track" behind a kind picker;
 *   Edit / Delete per track;
 * * the EDITOR — ``TrackIntervalEditor`` on a new or an existing track, Save /
 *   back. Save is disabled while the mirror of the backend rules reports an
 *   error; a 422 from the backend is shown too.
 *
 * Deleting a whole track is IRREVERSIBLE here, so it goes through a
 * ``ConfirmDialog`` (Cancel default-focused, the button reads "Delete track").
 * Adding and editing are undoable (``useBoreholeTrackEdits``).
 *
 * Owner dogfeed 2026-09-30:
 *
 * * "a per borehole button to reset to dov defaults": **Reset to DOV** for the
 *   whole borehole, plus **Reset** on every track with a DOV origin. It throws
 *   away hand edits on DOV tracks and has NO undo, so it is confirmed first
 *   (Cancel default-focused, "Reset to DOV"), the text naming how many edited
 *   tracks lose their edits. "No DOV XML in the cache" (409) is a NOTICE, not
 *   an error: nothing is wrong, there is only nothing to go back to;
 * * "copy another track as template": **Start from** next to Add track
 *   pre-fills the new track from an existing one (``rowsFromTemplate``); the
 *   new track is still a manual one;
 * * the interval editor shows the borehole's other tracks beside the rows
 *   (``TrackIntervalEditor`` reference pane).
 */
import { useMemo, useState } from 'react'

import type { BoreholeDetailResponse, TrackIntervalBody } from '../../../api/client'
import { RESET_NO_DOV_SOURCE_CODE } from '../../../api/clients/borehole'
import { apiErrorDetail } from '../../../api/clients/shared'
import type { BoreholeTrackEditing } from '../../../hooks/useBoreholeTrackEdits'
import { useFormalStratigraphyCatalog } from '../../../hooks/useFormalStratigraphyCatalog'
import { useT } from '../../../i18n/translate'
import {
  TRACK_KINDS,
  listBoreholeTracks,
  newRowAfter,
  rowsFromIntervals,
  rowsFromTemplate,
  rowsToIntervals,
  validateTrackRows,
  type BoreholeTrackSummary,
  type TrackBadge,
  type TrackEditorRow,
} from '../../../utils/boreholeTracks'
import { allowedTokens, codelistOptions, type CodelistField } from '../../../utils/dovTrackCodelists'
import { log } from '../../../utils/log'
import Button from '../../ui/Button'
import ConfirmDialog from '../../ui/ConfirmDialog'
import Modal from '../../ui/Modal'
import ResetToDovConfirm from './ResetToDovConfirm'
import TrackIntervalEditor, { type ReferenceTrack } from './TrackIntervalEditor'
import { trackBadgeLabel, trackKindLabel, trackLabel } from './trackLabels'

interface Props {
  open: boolean
  borehole: BoreholeDetailResponse
  editing: BoreholeTrackEditing
  onClose: () => void
}

interface EditorState {
  trackId: string | null
  kind: string
  rows: TrackEditorRow[]
  /** The intervals as loaded (the undo target); ``null`` for a new track. */
  original: TrackIntervalBody[] | null
  /** Intervals whose tokens stay allowed outside the DOV list: the loaded
   *  track, or the template a new track was started from (a DOV alias such as
   *  ZF round-trips instead of blocking the copy). */
  tokenSource: readonly TrackIntervalBody[]
}

export { trackKindLabel }

const BADGE_CLASS: Record<TrackBadge, string> = {
  dov: 'border-border-subtle text-text-secondary',
  manual: 'border-blue-400 text-blue-700 dark:text-blue-300',
  edited: 'border-amber-400 text-amber-700 dark:text-amber-300',
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : ''
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A pending Reset to DOV: the whole borehole (``track = null``) or one track. */
interface PendingReset {
  track: BoreholeTrackSummary | null
}

/**
 * Tracks panel of one borehole.
 *
 * @returns The modal (and, while confirming a delete, the confirmation).
 */
export default function BoreholeTracksDialog({ open, borehole, editing, onClose }: Props): JSX.Element {
  const t = useT()
  const tracks = useMemo(() => listBoreholeTracks(borehole), [borehole])
  const { units: formalUnits } = useFormalStratigraphyCatalog()
  const [newKind, setNewKind] = useState<string>(TRACK_KINDS[0])
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BoreholeTrackSummary | null>(null)
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const presentFieldLogKinds = useMemo(
    () => new Set(tracks.filter(tr => tr.family === 'field_log').map(tr => tr.kind)),
    [tracks],
  )

  const verdict = useMemo(() => {
    if (editor === null) return { errors: [], warnings: [] }
    return validateTrackRows(editor.kind, editor.rows, {
      totalDepthM: borehole.total_depth_m,
      allowed: (field: CodelistField) =>
        allowedTokens(editor.kind, field, { formalUnits, original: editor.tokenSource }),
    })
  }, [editor, borehole.total_depth_m, formalUnits])

  const options = (field: CodelistField) =>
    editor === null ? null : codelistOptions(editor.kind, field, { formalUnits })

  // The reference pane: every track but the one being edited.
  const references: ReferenceTrack[] = useMemo(
    () =>
      editor === null
        ? []
        : tracks
            .filter(tr => tr.trackId !== editor.trackId)
            .map(tr => ({ trackId: tr.trackId, label: trackLabel(t, tr), intervals: tr.intervals })),
    [editor, tracks, t],
  )

  const dovTracks = tracks.filter(tr => tr.badge !== 'manual')

  const startNew = () => {
    setServerError(null)
    setNotice(null)
    const template = tracks.find(tr => tr.trackId === templateId)
    const rows = template ? rowsFromTemplate(newKind, template) : []
    setEditor({
      trackId: null,
      kind: newKind,
      rows: rows.length > 0 ? rows : [newRowAfter([])],
      original: null,
      tokenSource: template?.intervals ?? [],
    })
  }
  const startEdit = (track: BoreholeTrackSummary) => {
    setServerError(null)
    setNotice(null)
    setEditor({
      trackId: track.trackId,
      kind: track.kind,
      rows: rowsFromIntervals(track.intervals),
      original: track.intervals,
      tokenSource: track.intervals,
    })
  }

  const save = async () => {
    if (editor === null || verdict.errors.length > 0) return
    setBusy(true)
    setServerError(null)
    try {
      await editing.saveTrack(borehole.id, {
        trackId: editor.trackId,
        kind: editor.kind,
        intervals: rowsToIntervals(editor.kind, editor.rows),
        before: editor.original,
      })
      setEditor(null)
    } catch (err) {
      log.warn('borehole', `track save refused for ${borehole.id}`, err)
      setServerError(t('tracks.editor.serverRefused', { reason: errorReason(err) }))
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (pendingDelete === null) return
    setBusy(true)
    setServerError(null)
    try {
      await editing.deleteTrack(borehole.id, pendingDelete.trackId)
    } catch (err) {
      log.warn('borehole', `track delete refused for ${borehole.id}`, err)
      setServerError(t('tracks.delete.failed', { reason: errorReason(err) }))
    } finally {
      setBusy(false)
      setPendingDelete(null)
    }
  }

  const confirmReset = async () => {
    if (pendingReset === null) return
    const trackId = pendingReset.track?.trackId ?? null
    setBusy(true)
    setServerError(null)
    setNotice(null)
    try {
      const outcome = await editing.resetToDov(borehole.id, trackId)
      setNotice(t('tracks.reset.done', { n: outcome.tracks.length }))
    } catch (err) {
      if (apiErrorDetail(err)?.code === RESET_NO_DOV_SOURCE_CODE) {
        // Nothing is wrong: the cache holds no DOV XML for this borehole.
        log.info('borehole', `reset to DOV: no cached DOV XML for ${borehole.id}`)
        setNotice(t('tracks.reset.noSource'))
      } else {
        log.warn('borehole', `reset to DOV refused for ${borehole.id}`, err)
        setServerError(t('tracks.reset.failed', { reason: errorReason(err) }))
      }
    } finally {
      setBusy(false)
      setPendingReset(null)
    }
  }

  const badgeTitle = (track: BoreholeTrackSummary): string => {
    const date = formatDate(track.editedAt)
    if (track.badge === 'manual') return t('tracks.badge.manualHint', { date })
    if (track.badge === 'edited') return t('tracks.badge.editedHint', { date })
    return t('tracks.badge.dovHint')
  }

  const list = (
    <>
      <p className="mb-3 text-xs text-text-secondary">{t('tracks.intro')}</p>
      {tracks.length === 0 ? (
        <p className="mb-3 text-xs italic text-text-muted">{t('tracks.empty')}</p>
      ) : (
        <table className="mb-3 w-full text-xs">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 font-normal">{t('tracks.col.kind')}</th>
              <th className="py-1 font-normal">{t('tracks.col.source')}</th>
              <th className="py-1 font-normal">{t('tracks.col.intervals')}</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {tracks.map(track => (
              <tr key={track.trackId} className="border-t border-border-subtle">
                <td className="py-1 pr-2 text-text-primary" title={track.kind}>
                  {trackKindLabel(t, track.kind)}
                </td>
                <td className="py-1 pr-2">
                  <span
                    title={badgeTitle(track)}
                    className={`inline-block rounded border px-1.5 text-[10px] ${BADGE_CLASS[track.badge]}`}
                  >
                    {trackBadgeLabel(t, track)}
                  </span>
                </td>
                <td className="py-1 pr-2 tabular-nums">{track.intervalCount}</td>
                <td className="py-1 pr-2 text-[10px]">
                  <span
                    className={track.drawnInSections ? 'text-text-secondary' : 'text-text-muted line-through'}
                    title={track.drawnInSections ? t('tracks.drawnHint') : t('tracks.notDrawnHint')}
                  >
                    {t('tracks.drawn')}
                  </span>
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(track)}>
                    {t('tracks.edit')}
                  </Button>
                  {track.badge !== 'manual' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingReset({ track })}
                      title={t('tracks.reset.trackHint')}
                    >
                      {t('tracks.reset.track')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setPendingDelete(track)}>
                    {t('tracks.delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('tracks.kindPicker')}
          value={newKind}
          onChange={e => setNewKind(e.target.value)}
          className="h-7 px-1 rounded border border-border-subtle bg-surface-card text-xs text-text-primary"
        >
          {TRACK_KINDS.map(kind => {
            const taken = presentFieldLogKinds.has(kind)
            return (
              <option key={kind} value={kind} disabled={taken} title={taken ? t('tracks.kindExists') : kind}>
                {trackKindLabel(t, kind)}
              </option>
            )
          })}
        </select>
        <label className="flex items-center gap-1 text-xs text-text-secondary" title={t('tracks.template.hint')}>
          {t('tracks.template.label')}
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="h-7 max-w-[16rem] px-1 rounded border border-border-subtle bg-surface-card text-xs text-text-primary"
          >
            <option value="">{t('tracks.template.empty')}</option>
            {tracks.map(tr => (
              <option key={tr.trackId} value={tr.trackId}>
                {t('tracks.template.option', {
                  kind: trackKindLabel(t, tr.kind),
                  source: trackBadgeLabel(t, tr),
                  n: tr.intervalCount,
                })}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="primary"
          onClick={startNew}
          disabled={presentFieldLogKinds.has(newKind)}
          title={presentFieldLogKinds.has(newKind) ? t('tracks.kindExists') : undefined}
        >
          {t('tracks.addTrack')}
        </Button>
        <span className="flex-1" />
        {dovTracks.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPendingReset({ track: null })}
            title={t('tracks.reset.buttonHint')}
          >
            {t('tracks.reset.button')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t('tracks.close')}
        </Button>
      </div>
    </>
  )

  const editorView = editor && (
    <>
      <TrackIntervalEditor
        kind={editor.kind}
        rows={editor.rows}
        onRowsChange={rows => setEditor({ ...editor, rows })}
        verdict={verdict}
        options={options}
        references={references}
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditor(null)} disabled={busy}>
          {t('tracks.editor.back')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void save()}
          disabled={busy || verdict.errors.length > 0}
        >
          {busy ? t('tracks.editor.saving') : t('tracks.editor.save')}
        </Button>
      </div>
    </>
  )

  const titleId = 'borehole-tracks-title'
  const kindName = editor ? trackKindLabel(t, editor.kind) : ''
  return (
    <>
      <Modal
        open={open && pendingDelete === null && pendingReset === null}
        onCancel={editor ? () => setEditor(null) : onClose}
        labelledBy={titleId}
        busy={busy}
        cardClassName="w-[min(64rem,95vw)] max-h-[85vh] overflow-auto"
        testid="borehole-tracks-dialog"
      >
        <div className="p-5">
          <h2 id={titleId} className="mb-2 text-sm font-semibold text-text-primary">
            {editor === null
              ? t('tracks.title', { name: borehole.name })
              : editor.trackId === null
                ? t('tracks.editor.titleNew', { kind: kindName })
                : t('tracks.editor.titleEdit', { kind: kindName })}
          </h2>
          {serverError && (
            <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
              {serverError}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mb-2 rounded border border-border-subtle px-2 py-1 text-xs text-text-secondary"
            >
              {notice}
            </p>
          )}
          {editor === null ? list : editorView}
        </div>
      </Modal>
      <ConfirmDialog
        open={open && pendingDelete !== null}
        labelledBy="borehole-track-delete-title"
        title={t('tracks.delete.title')}
        body={
          pendingDelete && (
            <>
              <p>
                {t('tracks.delete.body', {
                  kind: trackKindLabel(t, pendingDelete.kind),
                  n: pendingDelete.intervalCount,
                  name: borehole.name,
                })}
              </p>
              {/* A DOV bbox re-import re-attaches an interpretation whose
                  permkey is gone, so a deleted DOV observation track comes
                  back that way; field logs of an existing borehole are not
                  re-imported, so the sentence is not offered for them. */}
              {pendingDelete.badge !== 'manual' && pendingDelete.family === 'observation' && (
                <p className="mt-1">{t('tracks.delete.bodyDov')}</p>
              )}
            </>
          )
        }
        confirm={{
          label: t('tracks.delete.confirm'),
          variant: 'danger',
          onClick: () => void confirmDelete(),
          testid: 'borehole-track-delete-confirm',
        }}
        onCancel={() => setPendingDelete(null)}
        busy={busy}
      />
      <ResetToDovConfirm
        pending={open ? pendingReset : null}
        dovTracks={dovTracks}
        boreholeName={borehole.name}
        busy={busy}
        onConfirm={() => void confirmReset()}
        onCancel={() => setPendingReset(null)}
      />
    </>
  )
}
