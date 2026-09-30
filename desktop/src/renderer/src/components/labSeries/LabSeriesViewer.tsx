// The readings viewer of one raw lab test (opened from the borehole detail's
// Lab tests list).
//
// Oedometer: settlement vs log time and the Strix-derived vertical strain
// (delta_h / h0) vs log time, per stage (all stages overlaid or one picked);
// the end-of-stage strain vs log stress beside the lab's own e vs log stress.
// The t = 0 reading of each stage is a left-edge marker; re-zero duplicates
// are skipped and counted.
// Triaxial: deviator stress, pore pressure and volume change vs axial strain,
// one line per specimen. The export has no time channel — said on screen.
// Every value the lab reported sits in its own read-only table (owner Q3:
// "you can list them but we'll be doing our own interpretations").

import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api/client'
import type { LabSeriesTest } from '../../api/client'
import { useT } from '../../i18n/translate'
import {
  endOfStageStrain,
  labELogStress,
  specimenCurve,
  stageTimeSeries,
} from '../../utils/labSeriesViewerData'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import LabSeriesChart, { type ChartSeries } from './LabSeriesChart'
import { specimenColor, stageColor } from './labSeriesColors'

interface Props {
  projectId: string
  sampleId: string
  /** The test to show (the sample may carry several). */
  testId: string
  onClose: () => void
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; test: LabSeriesTest | null }

/**
 * Modal viewer of one lab test's readings and the lab's reported values.
 *
 * @returns The modal element.
 */
export default function LabSeriesViewer({ projectId, sampleId, testId, onClose }: Props): JSX.Element {
  const t = useT()
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    api.labSeries
      .getForSample(projectId, sampleId)
      .then(tests => alive && setLoad({ state: 'ready', test: tests.find(x => x.id === testId) ?? null }))
      .catch(() => alive && setLoad({ state: 'failed' }))
    return () => {
      alive = false
    }
  }, [projectId, sampleId, testId])

  const test = load.state === 'ready' ? load.test : null
  const kind =
    test?.kind === 'triaxial' ? t('labSeries.dialog.kindTriaxial') : t('labSeries.dialog.kindOedometer')

  return (
    <Modal open onCancel={onClose} labelledBy="lab-viewer-title" cardClassName="w-[64rem] max-w-[95vw]" testid="lab-series-viewer">
      <div className="flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
          <h2 id="lab-viewer-title" className="text-sm font-semibold">
            {test
              ? t('labSeries.viewer.title', {
                  kind,
                  type: test.test_type_token ?? '',
                  sample: test.lab_sample_number ?? '?',
                })
              : kind}
          </h2>
          <Button onClick={onClose}>{t('labSeries.viewer.close')}</Button>
        </div>
        <div className="overflow-y-auto px-4 py-3 space-y-4 text-xs">
          {load.state === 'loading' && <p className="text-text-muted">{t('labSeries.viewer.loading')}</p>}
          {load.state === 'failed' && <p className="text-status-danger">{t('labSeries.viewer.failed')}</p>}
          {load.state === 'ready' && !test && <p className="text-text-muted">{t('labSeries.viewer.noData')}</p>}
          {test && (
            <>
              <p className="text-text-secondary">{t('labSeries.viewer.source', { file: test.source_file_name })}</p>
              {test.kind === 'triaxial' ? <TriaxialPanels test={test} /> : <OedometerPanels test={test} />}
              <ReportedTable test={test} />
              <Findings test={test} />
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** The four oedometer panels and the stage picker. */
function OedometerPanels({ test }: { test: LabSeriesTest }): JSX.Element {
  const t = useT()
  const stages = test.specimens[0]?.stages ?? []
  const [picked, setPicked] = useState<string>('all')
  const shown = picked === 'all' ? stages : stages.filter(s => String(s.stage_index) === picked)

  const { settlement, strain, skipped } = useMemo(() => {
    const settlementSeries: ChartSeries[] = []
    const strainSeries: ChartSeries[] = []
    let skippedCount = 0
    shown.forEach(stage => {
      const color = stageColor(stages.indexOf(stage), stages.length)
      const label = t('labSeries.viewer.stageOption', { n: stage.stage_index })
      const s = stageTimeSeries(stage, 'settlement_mm')
      const e = stageTimeSeries(stage, 'vertical_strain')
      skippedCount += s.skipped
      const id = String(stage.stage_index)
      settlementSeries.push({ id, label, color, points: s.points, leftEdgeValue: s.t0 })
      strainSeries.push({ id, label, color, points: e.points, leftEdgeValue: e.t0 })
    })
    return { settlement: settlementSeries, strain: strainSeries, skipped: skippedCount }
  }, [shown, stages, t])

  const strainStress = endOfStageStrain(test)
  const eStress = labELogStress(test)

  return (
    <section className="space-y-2">
      <label className="flex items-center gap-2">
        <span className="text-text-secondary">{t('labSeries.viewer.stage')}</span>
        <select
          data-testid="lab-viewer-stage-select"
          value={picked}
          onChange={e => setPicked(e.target.value)}
          className="bg-surface-app border border-border-default rounded px-1 py-0.5"
        >
          <option value="all">{t('labSeries.viewer.allStages')}</option>
          {stages.map(s => (
            <option key={s.stage_index} value={String(s.stage_index)}>
              {s.target_stress_kpa != null
                ? t('labSeries.viewer.stageOptionStress', { n: s.stage_index, stress: s.target_stress_kpa })
                : t('labSeries.viewer.stageOption', { n: s.stage_index })}
            </option>
          ))}
        </select>
      </label>
      <p className="text-text-muted">{t('labSeries.viewer.t0Note')}</p>
      {skipped > 0 && <p className="text-text-muted">{t('labSeries.viewer.rezeroNote', { n: skipped })}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LabSeriesChart
          testid="lab-chart-settlement"
          title={t('labSeries.viewer.settlementLogTime')}
          xLabel={t('labSeries.axis.timeMin')}
          yLabel={t('labSeries.axis.settlementMm')}
          series={settlement}
          xLog
          invertY
          emptyText={t('labSeries.viewer.noData')}
        />
        <LabSeriesChart
          testid="lab-chart-strain-time"
          title={t('labSeries.viewer.strainLogTime')}
          xLabel={t('labSeries.axis.timeMin')}
          yLabel={t('labSeries.axis.strain')}
          series={strain}
          xLog
          invertY
          emptyText={t('labSeries.viewer.noData')}
        />
        <LabSeriesChart
          testid="lab-chart-strain-stress"
          title={t('labSeries.viewer.strainLogStress')}
          xLabel={t('labSeries.axis.stressKpa')}
          yLabel={t('labSeries.axis.strain')}
          series={[
            { id: 'strain', label: t('labSeries.axis.strain'), color: specimenColor(0), points: strainStress, dots: true },
          ]}
          xLog
          invertY
          emptyText={t('labSeries.viewer.noStress')}
        />
        <LabSeriesChart
          testid="lab-chart-e-stress"
          title={t('labSeries.viewer.eLogStress')}
          xLabel={t('labSeries.axis.stressKpa')}
          yLabel={t('labSeries.axis.voidRatio')}
          series={[{ id: 'e', label: 'e', color: specimenColor(1), points: eStress, dots: true }]}
          xLog
          emptyText={t('labSeries.viewer.noData')}
        />
      </div>
    </section>
  )
}

/** The three triaxial panels, one line per specimen. */
function TriaxialPanels({ test }: { test: LabSeriesTest }): JSX.Element {
  const t = useT()
  const curves = (yKey: string): ChartSeries[] =>
    test.specimens.map((sp, i) => ({
      id: sp.specimen_label ?? String(i),
      label: t('labSeries.viewer.specimenLabel', { label: sp.specimen_label ?? String(i + 1) }),
      color: specimenColor(i),
      points: specimenCurve(sp, 'axial_strain_pct', yKey),
    }))
  const volume = curves('volume_change_cm3')
  const hasVolume = volume.some(s => s.points.length > 0)
  return (
    <section className="space-y-2">
      <p className="text-text-muted">{t('labSeries.viewer.noTime')}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LabSeriesChart
          testid="lab-chart-deviator"
          title={t('labSeries.viewer.deviatorStrain')}
          xLabel={t('labSeries.axis.axialStrainPct')}
          yLabel={t('labSeries.axis.deviatorKpa')}
          series={curves('deviator_stress_kpa')}
          emptyText={t('labSeries.viewer.noData')}
        />
        <LabSeriesChart
          testid="lab-chart-pore"
          title={t('labSeries.viewer.poreStrain')}
          xLabel={t('labSeries.axis.axialStrainPct')}
          yLabel={t('labSeries.axis.poreKpa')}
          series={curves('pore_pressure_kpa')}
          emptyText={t('labSeries.viewer.noData')}
        />
        {hasVolume ? (
          <LabSeriesChart
            testid="lab-chart-volume"
            title={t('labSeries.viewer.volumeStrain')}
            xLabel={t('labSeries.axis.axialStrainPct')}
            yLabel={t('labSeries.axis.volumeCm3')}
            series={volume}
            emptyText={t('labSeries.viewer.noData')}
          />
        ) : (
          <p className="text-text-muted self-center">{t('labSeries.viewer.noVolume')}</p>
        )}
      </div>
    </section>
  )
}

/** The lab's reported values — read-only, never used by Strix. */
function ReportedTable({ test }: { test: LabSeriesTest }): JSX.Element | null {
  const t = useT()
  if (test.lab_results.length === 0) return null
  const bySpecimen = test.kind === 'triaxial'
  return (
    <section>
      <h3 className="font-semibold text-text-primary">{t('labSeries.viewer.reportedByLab')}</h3>
      <p className="text-text-muted mb-1">{t('labSeries.viewer.reportedNote')}</p>
      <div className="overflow-x-auto max-h-64 overflow-y-auto border border-border-subtle rounded">
        <table className="w-full text-left" data-testid="lab-reported-table">
          <thead className="text-text-secondary sticky top-0 bg-surface-overlay">
            <tr>
              <th className="px-2 py-1 font-normal">
                {bySpecimen ? t('labSeries.viewer.colSpecimen') : t('labSeries.viewer.colStage')}
              </th>
              <th className="px-2 py-1 font-normal">{t('labSeries.viewer.colParameter')}</th>
              <th className="px-2 py-1 font-normal text-right">{t('labSeries.viewer.colValue')}</th>
              <th className="px-2 py-1 font-normal">{t('labSeries.viewer.colUnit')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {test.lab_results.map((r, i) => (
              <tr key={i} className="border-t border-border-subtle">
                <td className="px-2 py-0.5">{bySpecimen ? (r.specimen_label ?? '') : (r.stage_index ?? '')}</td>
                <td className="px-2 py-0.5 font-sans">{r.parameter}</td>
                <td className="px-2 py-0.5 text-right">{r.value_numeric ?? r.value_text ?? ''}</td>
                <td className="px-2 py-0.5">{r.unit ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** The parser findings frozen at import. */
function Findings({ test }: { test: LabSeriesTest }): JSX.Element | null {
  const t = useT()
  if (test.import_issues.length === 0) return null
  return (
    <section>
      <h3 className="font-semibold text-text-primary">
        {t('labSeries.viewer.findings', { n: test.import_issues.length })}
      </h3>
      <ul className="space-y-0.5">
        {test.import_issues.map((i, k) => (
          <li key={k}>
            <IssueLevel level={i.level} /> <span className="font-mono">{i.code}</span>: {i.message}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A finding's level as a word (never colour alone). */
export function IssueLevel({ level }: { level: string }): JSX.Element {
  const t = useT()
  const key =
    level === 'error' ? 'labSeries.level.error' : level === 'warning' ? 'labSeries.level.warning' : 'labSeries.level.info'
  const tone =
    level === 'error' ? 'text-status-danger' : level === 'warning' ? 'text-status-amber' : 'text-text-muted'
  return <span className={`font-semibold ${tone}`}>{t(key)}</span>
}
