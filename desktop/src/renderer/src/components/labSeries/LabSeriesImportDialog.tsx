// "Import lab tests" — one preview per picked file, then the import.
//
// Owner Q4 (2026-09-29): "ask user, to double check, there should be a sample;
// if no, default create one; overlapping depths, yes same sample". So for each
// file the backend PREVIEW (nothing written) proposes a borehole (the name
// ending with <job>-<borehole>) and a sample (depth overlap); the user sees
// the lab's identity and every finding, may change the borehole (which
// re-previews so that borehole's samples are offered) and the sample, or keeps
// the default "create a new sample". Only then is the file imported.
//
// Replacing a stored test is irreversible: a ConfirmDialog with Cancel
// focused and an action-named button (docs/ux.md), only on the 409.
//
// Owner 2026-09-30: a file whose format Strix does not read is listed (with
// "contact the StrixGeo dev team") and the dialog moves on to the next file;
// a borehole missing from the project is fetched from DOV by the preview and
// proposed, and DOV without it (or DOV not reachable) is said, naming it.

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  api,
  LabFileFormatNotRecognisedError,
  LabSeriesRefreshConfirmationRequiredError,
} from '../../api/client'
import type { LabSeriesPreviewResponse, LabSeriesRefreshDiff } from '../../api/client'
import { useT } from '../../i18n/translate'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Modal from '../ui/Modal'
import { IssueLevel } from './LabSeriesViewer'

/** What the dialog did, handed back when the last file is done. */
export interface LabSeriesImportSummary {
  imported: number
  replaced: number
  unchanged: number
  skipped: number
  failed: number
  /** Boreholes whose samples / lab tests changed (to reload their detail). */
  touchedBoreholeIds: string[]
  /** Boreholes the preview fetched from DOV into the project (a new list row). */
  dovFetched: { id: string; name: string }[]
}

interface Props {
  projectId: string
  filePaths: string[]
  /** Every borehole of the project, for the picker. */
  boreholes: { id: string; name: string }[]
  onFinished: (summary: LabSeriesImportSummary) => void
}

const CREATE = '__create__'

/** The file name at the end of a path. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A number for display ("14.50"). */
function m(v: number | null | undefined): string {
  return v == null ? '' : v.toFixed(2)
}

/**
 * Sequential preview-then-import dialog over the picked lab files.
 *
 * @returns The modal (and the refresh confirmation when asked).
 */
export default function LabSeriesImportDialog({
  projectId,
  filePaths,
  boreholes,
  onFinished,
}: Props): JSX.Element {
  const t = useT()
  const [index, setIndex] = useState(0)
  const [summary, setSummary] = useState<LabSeriesImportSummary>({
    imported: 0,
    replaced: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    touchedBoreholeIds: [],
    dovFetched: [],
  })
  // Files refused as an unknown format, as shown lines ("{file}: … dev team").
  const [rejected, setRejected] = useState<string[]>([])
  // Every file walked and the last one was refused: the list stays until Close.
  const [done, setDone] = useState<LabSeriesImportSummary | null>(null)
  // The file whose preview was refused as an unknown format (handled below).
  const [unknownFormat, setUnknownFormat] = useState<string | null>(null)
  const [preview, setPreview] = useState<LabSeriesPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [boreholeId, setBoreholeId] = useState<string>('')
  const [sampleChoice, setSampleChoice] = useState<string>(CREATE)
  const [top, setTop] = useState<string>('')
  const [base, setBase] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState<LabSeriesRefreshDiff | null>(null)

  const filePath = filePaths[index]
  const fileName = filePath ? baseName(filePath) : ''
  // The translator is a fresh function per render; read it through a ref so the
  // preview callback (an effect dependency) stays stable per file.
  const tRef = useRef(t)
  tRef.current = t

  const loadPreview = useCallback(
    async (chosenBorehole: string | null) => {
      if (!filePath) return
      setBusy(true)
      setError(null)
      try {
        const p = await api.labSeries.preview(filePath, projectId, chosenBorehole)
        const lookup = p.dov_lookup
        if (lookup?.status === 'fetched' && lookup.borehole_id) {
          const fetched = { id: lookup.borehole_id, name: lookup.borehole_name }
          setSummary(prev =>
            prev.dovFetched.some(b => b.id === fetched.id)
              ? prev
              : { ...prev, dovFetched: [...prev.dovFetched, fetched] },
          )
        }
        setPreview(p)
        setBoreholeId(p.proposed_borehole_id ?? chosenBorehole ?? '')
        setSampleChoice(p.proposed_sample_id ?? CREATE)
        setTop(m(p.create_sample_default?.depth_top_m))
        setBase(m(p.create_sample_default?.depth_base_m))
      } catch (err) {
        setPreview(null)
        if (err instanceof LabFileFormatNotRecognisedError) {
          setUnknownFormat(fileName)
          return
        }
        setError(
          tRef.current('labSeries.dialog.readFailed', {
            file: fileName,
            message: String((err as Error).message ?? err),
          }),
        )
      } finally {
        setBusy(false)
      }
    },
    [filePath, projectId, fileName],
  )

  // One automatic preview per file selection (2026-10-03 race): React.StrictMode
  // runs this effect twice in dev, and two concurrent previews of one file both
  // fetched the same missing borehole from DOV. The ref survives StrictMode's
  // simulated remount, so the second run sees the file is already previewed.
  // A borehole pick re-previews through ``loadPreview`` directly, unguarded.
  const autoPreviewedRef = useRef<string | null>(null)
  useEffect(() => {
    const selection = `${projectId}|${index}|${filePath ?? ''}`
    if (autoPreviewedRef.current === selection) return
    autoPreviewedRef.current = selection
    void loadPreview(null)
  }, [loadPreview, projectId, index, filePath])

  // An unknown format: list the file, count it failed and move on. Held in
  // state (not advanced inside loadPreview) so ``advance`` reads the summary
  // of this render.
  useEffect(() => {
    if (unknownFormat === null) return
    setUnknownFormat(null)
    const line = t('labSeries.dialog.formatNotRecognised', { file: unknownFormat })
    advance({ failed: 1 }, undefined, line)
    // reason: advance and t are fresh closures per render; the effect must fire
    // once per refused file, keyed on the refused file's name only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknownFormat])

  /** Record one file's outcome and move to the next (or finish). */
  function advance(
    delta: Partial<LabSeriesImportSummary>,
    touched?: string,
    rejectedLine?: string,
  ): void {
    if (rejectedLine) setRejected([...rejected, rejectedLine])
    const next: LabSeriesImportSummary = {
      ...summary,
      imported: summary.imported + (delta.imported ?? 0),
      replaced: summary.replaced + (delta.replaced ?? 0),
      unchanged: summary.unchanged + (delta.unchanged ?? 0),
      skipped: summary.skipped + (delta.skipped ?? 0),
      failed: summary.failed + (delta.failed ?? 0),
      touchedBoreholeIds:
        touched && !summary.touchedBoreholeIds.includes(touched)
          ? [...summary.touchedBoreholeIds, touched]
          : summary.touchedBoreholeIds,
    }
    setSummary(next)
    setPreview(null)
    setRefresh(null)
    setError(null)
    if (index + 1 < filePaths.length) setIndex(index + 1)
    // The LAST file refused: its line stays on screen until the user closes
    // the dialog (an earlier refusal was on screen while the next file ran).
    else if (rejectedLine) setDone(next)
    else onFinished(next)
  }

  const creating = sampleChoice === CREATE
  const topN = top.trim() === '' ? null : Number(top)
  const baseN = base.trim() === '' ? null : Number(base)
  const intervalOk = !creating || (topN !== null && baseN !== null && !isNaN(topN) && !isNaN(baseN) && baseN >= topN)
  const canImport = !!preview && !!boreholeId && intervalOk && !busy

  async function doImport(confirmRefresh: boolean): Promise<void> {
    if (!preview || !boreholeId) return
    setBusy(true)
    try {
      const out = await api.labSeries.import(filePath, projectId, {
        boreholeId,
        sampleId: creating ? null : sampleChoice,
        createSample: creating,
        sampleDepthTopM: creating ? topN : null,
        sampleDepthBaseM: creating ? baseN : null,
        confirmRefresh,
      })
      setBusy(false)
      if (out.unchanged) advance({ unchanged: 1 })
      else if (out.refreshed) advance({ replaced: 1 }, boreholeId)
      else advance({ imported: 1 }, boreholeId)
    } catch (err) {
      setBusy(false)
      if (err instanceof LabSeriesRefreshConfirmationRequiredError) {
        setRefresh(err.diff)
        return
      }
      setError(String((err as Error).message ?? err))
    }
  }

  const cancelAll = (): void => {
    if (done) {
      onFinished(done)
      return
    }
    const rest = filePaths.length - index
    onFinished({ ...summary, skipped: summary.skipped + rest })
  }

  const identity = preview?.identity
  const lookup = preview?.dov_lookup ?? null
  const dovRefusal =
    lookup && !boreholeId && (lookup.status === 'not_found' || lookup.status === 'unreachable')
      ? t(
          lookup.status === 'unreachable'
            ? 'labSeries.dialog.dovUnreachable'
            : 'labSeries.dialog.dovNotFound',
          { name: lookup.borehole_name },
        )
      : null
  // The picker lists the project's boreholes plus one the preview just
  // fetched from DOV (not yet in the caller's list).
  const boreholeOptions = [
    ...boreholes,
    ...(preview?.borehole_candidates ?? []).filter(c => !boreholes.some(b => b.id === c.id)),
  ]
  const boreholeHint =
    lookup?.status === 'fetched'
      ? t('labSeries.dialog.dovFetched', { name: lookup.borehole_name })
      : preview?.borehole_match === 'unique'
      ? t('labSeries.dialog.boreholeUnique')
      : preview?.borehole_match === 'ambiguous'
        ? t('labSeries.dialog.boreholeAmbiguous')
        : preview?.borehole_match === 'none'
          ? t('labSeries.dialog.boreholeNone')
          : null
  const sampleHint =
    preview?.sample_match === 'overlap'
      ? t('labSeries.dialog.sampleOverlap')
      : preview?.sample_match === 'sample_number'
        ? t('labSeries.dialog.sampleNumberMatch')
        : preview && boreholeId
          ? t('labSeries.dialog.sampleNone')
          : null

  return (
    <>
      <Modal
        open
        onCancel={cancelAll}
        busy={busy}
        labelledBy="lab-import-title"
        cardClassName="w-[40rem] max-w-[95vw]"
        testid="lab-series-import-dialog"
      >
        <div className="flex flex-col max-h-[88vh] text-xs">
          <div className="px-4 py-2 border-b border-border-subtle">
            <h2 id="lab-import-title" className="text-sm font-semibold">
              {t('labSeries.dialog.title', { file: fileName })}
            </h2>
            {filePaths.length > 1 && (
              <p className="text-text-secondary">
                {t('labSeries.dialog.progress', { i: index + 1, n: filePaths.length })}
              </p>
            )}
          </div>
          <div className="overflow-y-auto px-4 py-3 space-y-3">
            {rejected.length > 0 && (
              <section data-testid="lab-import-rejected">
                <h3 className="font-semibold mb-0.5">{t('labSeries.dialog.notImported')}</h3>
                <ul className="space-y-0.5">
                  {rejected.map((line, k) => (
                    <li key={k} className="text-status-danger">
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {busy && !preview && !done && (
              <p className="text-text-muted">{t('labSeries.dialog.loading')}</p>
            )}
            {error && <p className="text-status-danger" role="alert">{error}</p>}
            {preview && identity && !done && (
              <>
                <section>
                  <h3 className="font-semibold mb-1">
                    {preview.kind === 'triaxial'
                      ? t('labSeries.dialog.kindTriaxial')
                      : t('labSeries.dialog.kindOedometer')}
                    {preview.test_type_token ? ` ${preview.test_type_token}` : ''}
                    {' · '}
                    {t('labSeries.dialog.identity')}
                  </h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <dt className="text-text-secondary">{t('labSeries.dialog.job')}</dt>
                    <dd>{identity.job_number ?? t('labSeries.dialog.notInFile')}</dd>
                    <dt className="text-text-secondary">{t('labSeries.dialog.labBorehole')}</dt>
                    <dd>{identity.borehole_name ?? t('labSeries.dialog.notInFile')}</dd>
                    <dt className="text-text-secondary">{t('labSeries.dialog.labSample')}</dt>
                    <dd>{identity.sample_number ?? t('labSeries.dialog.notInFile')}</dd>
                    <dt className="text-text-secondary">{t('labSeries.dialog.labInterval')}</dt>
                    <dd>
                      {identity.depth_top_m != null && identity.depth_base_m != null
                        ? t('labSeries.dialog.sampleOption', { top: m(identity.depth_top_m), base: m(identity.depth_base_m) })
                        : t('labSeries.dialog.notInFile')}
                    </dd>
                    <dt className="text-text-secondary">{t('labSeries.dialog.specimens')}</dt>
                    <dd>
                      {preview.specimens.map((s, i) => (
                        <div key={i}>
                          {t('labSeries.dialog.specimenLine', {
                            label: s.label ?? '1',
                            stages: s.n_stages,
                            readings: s.n_readings,
                          })}
                        </div>
                      ))}
                    </dd>
                  </dl>
                  {preview.kind === 'triaxial' && (
                    <p className="text-text-muted mt-1">{t('labSeries.dialog.noTime')}</p>
                  )}
                </section>

                {preview.existing_test && (
                  <p className="text-status-amber" data-testid="lab-import-existing">
                    {preview.existing_test.same_content
                      ? t('labSeries.dialog.existingSame')
                      : t('labSeries.dialog.existingChanged')}
                  </p>
                )}

                <section>
                  <label className="block font-semibold mb-0.5" htmlFor="lab-import-borehole">
                    {t('labSeries.dialog.borehole')}
                  </label>
                  <select
                    id="lab-import-borehole"
                    data-testid="lab-import-borehole"
                    value={boreholeId}
                    disabled={busy}
                    onChange={e => {
                      setBoreholeId(e.target.value)
                      if (e.target.value) void loadPreview(e.target.value)
                    }}
                    className="w-full bg-surface-app border border-border-default rounded px-1 py-0.5"
                  >
                    <option value="">{t('labSeries.dialog.pickBorehole')}</option>
                    {boreholeOptions.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {boreholeHint && !dovRefusal && (
                    <p className="text-text-muted mt-0.5">{boreholeHint}</p>
                  )}
                  {dovRefusal && (
                    <p
                      className="text-status-danger mt-0.5"
                      role="alert"
                      data-testid="lab-import-dov-lookup"
                    >
                      {dovRefusal}
                    </p>
                  )}
                </section>

                {boreholeId && (
                  <fieldset>
                    <legend className="font-semibold mb-0.5">{t('labSeries.dialog.sample')}</legend>
                    {preview.samples.map(s => (
                      <label key={s.id} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="lab-import-sample"
                          data-testid={`lab-import-sample-${s.id}`}
                          checked={sampleChoice === s.id}
                          onChange={() => setSampleChoice(s.id)}
                        />
                        {s.sample_number
                          ? t('labSeries.dialog.sampleOptionNumbered', {
                              top: m(s.depth_top_m),
                              base: m(s.depth_base_m),
                              number: s.sample_number,
                            })
                          : t('labSeries.dialog.sampleOption', { top: m(s.depth_top_m), base: m(s.depth_base_m) })}
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="lab-import-sample"
                        data-testid="lab-import-create-sample"
                        checked={creating}
                        onChange={() => setSampleChoice(CREATE)}
                      />
                      {t('labSeries.dialog.createSample')}
                    </label>
                    {creating && (
                      <div className="flex items-center gap-3 mt-1 ml-5">
                        <label className="flex items-center gap-1">
                          {t('labSeries.dialog.newSampleTop')}
                          <input
                            type="number"
                            step="0.01"
                            aria-label={t('labSeries.dialog.newSampleTop')}
                            value={top}
                            onChange={e => setTop(e.target.value)}
                            className="w-20 bg-surface-app border border-border-default rounded px-1"
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          {t('labSeries.dialog.newSampleBase')}
                          <input
                            type="number"
                            step="0.01"
                            aria-label={t('labSeries.dialog.newSampleBase')}
                            value={base}
                            onChange={e => setBase(e.target.value)}
                            className="w-20 bg-surface-app border border-border-default rounded px-1"
                          />
                        </label>
                      </div>
                    )}
                    {creating && !preview.create_sample_default && (
                      <p className="text-text-muted mt-0.5">{t('labSeries.dialog.newSampleNeedsInterval')}</p>
                    )}
                    {sampleHint && <p className="text-text-muted mt-0.5">{sampleHint}</p>}
                  </fieldset>
                )}

                <section>
                  <h3 className="font-semibold mb-0.5">
                    {t('labSeries.dialog.findings', { n: preview.issues.length })}
                  </h3>
                  {preview.issues.length === 0 ? (
                    <p className="text-text-muted">{t('labSeries.dialog.noFindings')}</p>
                  ) : (
                    <ul className="space-y-0.5 max-h-40 overflow-y-auto" data-testid="lab-import-findings">
                      {preview.issues.map((i, k) => (
                        <li key={k}>
                          <IssueLevel level={i.level} /> <span className="font-mono">{i.code}</span>: {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 px-4 py-2 border-t border-border-subtle">
            {done ? (
              <Button variant="primary" onClick={cancelAll}>
                {t('labSeries.dialog.close')}
              </Button>
            ) : (
              <>
                <Button onClick={cancelAll} disabled={busy}>
                  {t('labSeries.dialog.cancel')}
                </Button>
                <Button onClick={() => advance({ skipped: 1 })} disabled={busy}>
                  {t('labSeries.dialog.skip')}
                </Button>
                <Button variant="primary" onClick={() => void doImport(false)} disabled={!canImport}>
                  {t('labSeries.dialog.import')}
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={refresh !== null}
        labelledBy="lab-refresh-title"
        testid="lab-refresh-confirm"
        title={t('labSeries.refresh.title')}
        body={
          refresh
            ? t('labSeries.refresh.body', {
                file: fileName,
                old: refresh.oldNReadings,
                new: refresh.newNReadings,
              })
            : ''
        }
        confirm={{
          label: t('labSeries.refresh.confirm'),
          variant: 'danger',
          onClick: () => {
            setRefresh(null)
            void doImport(true)
          },
        }}
        cancelLabel={t('labSeries.dialog.cancel')}
        onCancel={() => setRefresh(null)}
      />
    </>
  )
}
