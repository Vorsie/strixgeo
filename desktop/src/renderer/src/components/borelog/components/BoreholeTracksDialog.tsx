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
 */
import { useMemo, useState } from 'react'

import type { BoreholeDetailResponse, TrackIntervalBody } from '../../../api/client'
import type { BoreholeTrackEditing } from '../../../hooks/useBoreholeTrackEdits'
import { useFormalStratigraphyCatalog } from '../../../hooks/useFormalStratigraphyCatalog'
import { useT, type Translator } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'
import {
  FIELD_LOG_TRACK_KINDS,
  TRACK_KINDS,
  listBoreholeTracks,
  newRowAfter,
  rowsFromIntervals,
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
import TrackIntervalEditor from './TrackIntervalEditor'

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
  /** The intervals as loaded (undo target + tokens allowed outside the list). */
  original: TrackIntervalBody[] | null
}

/** Translated name of a track kind (observation kinds reuse ``borelog.obs.*``). */
export function trackKindLabel(t: Translator, kind: string): string {
  if ((FIELD_LOG_TRACK_KINDS as readonly string[]).includes(kind)) {
    return t(`tracks.kind.${kind}` as MessageKey)
  }
  return t(`borelog.obs.${kind}` as MessageKey)
}

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
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const presentFieldLogKinds = useMemo(
    () => new Set(tracks.filter(tr => tr.family === 'field_log').map(tr => tr.kind)),
    [tracks],
  )

  const verdict = useMemo(() => {
    if (editor === null) return { errors: [], warnings: [] }
    return validateTrackRows(editor.kind, editor.rows, {
      totalDepthM: borehole.total_depth_m,
      allowed: (field: CodelistField) =>
        allowedTokens(editor.kind, field, { formalUnits, original: editor.original ?? [] }),
    })
  }, [editor, borehole.total_depth_m, formalUnits])

  const options = (field: CodelistField) =>
    editor === null ? null : codelistOptions(editor.kind, field, { formalUnits })

  const startNew = () => {
    setServerError(null)
    setEditor({ trackId: null, kind: newKind, rows: [newRowAfter([])], original: null })
  }
  const startEdit = (track: BoreholeTrackSummary) => {
    setServerError(null)
    setEditor({
      trackId: track.trackId,
      kind: track.kind,
      rows: rowsFromIntervals(track.intervals),
      original: track.intervals,
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
                    {t(`tracks.badge.${track.badge}` as MessageKey)}
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
        open={open && pendingDelete === null}
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
    </>
  )
}
