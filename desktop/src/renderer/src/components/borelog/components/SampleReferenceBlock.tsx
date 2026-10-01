/**
 * The "Samples (DOV)" block of the track editor's reference pane (owner
 * 2026-10-01: "i also want the psd's of monster to be visible in the right
 * hand pane").
 *
 * Lists the borehole's samples by depth interval and sample number. Per
 * grain-size test it draws the mini PSD chart (the same chart the section
 * view's sample hover card draws) and prints the fraction shares read from the
 * curve (``psdFractionShares``); a share whose boundary the curve does not
 * reach is printed as "?" with a tooltip, never guessed. The other lab results
 * on the sample follow as one short line each (``sampleLabLines``).
 *
 * A sample whose depth interval overlaps the focused editor row is marked the
 * same way the other reference intervals are (``referenceOverlapsRow``), so
 * the scroll-into-view of the pane reaches it too (``data-overlaps``).
 */
import type { GrainSizeResponse, SampleResponse } from '../../../api/client'
import type { MessageKey } from '../../../i18n/locales/en'
import { useT } from '../../../i18n/translate'
import { referenceOverlapsRow, type TrackEditorRow } from '../../../utils/boreholeTracks'
import { psdCurvePoints, psdFractionShares } from '../../../utils/psdCurve'
import { formatLabNumber, sampleLabLines } from '../../../utils/sampleLabLines'
import PsdMiniChart from '../../sections/PsdMiniChart'

interface Props {
  samples: readonly SampleResponse[]
  /** The focused editor row; ``undefined`` = nothing focused. */
  active: TrackEditorRow | undefined
}

/** Mini chart size in the pane (px): fits the 24rem pane minus its padding. */
const CHART_WIDTH = 300
const CHART_HEIGHT = 72

/** The fraction names, in print order; each is also the raw zone token. */
type FractionName = 'clay' | 'silt' | 'fines' | 'sand' | 'gravel'

/**
 * The fractions one curve prints: clay + silt when the curve reaches 2 um,
 * else the fines (< 63 um) as one share; then sand and gravel.
 */
function printedFractions(test: GrainSizeResponse): { name: FractionName; pct: number | null }[] {
  const shares = psdFractionShares(psdCurvePoints(test))
  const fine: { name: FractionName; pct: number | null }[] =
    shares.clay !== null && shares.silt !== null
      ? [
          { name: 'clay', pct: shares.clay },
          { name: 'silt', pct: shares.silt },
        ]
      : [{ name: 'fines', pct: shares.fines }]
  return [...fine, { name: 'sand', pct: shares.sand }, { name: 'gravel', pct: shares.gravel }]
}

/**
 * Samples block of the reference pane.
 *
 * @returns The block, with an explicit line when the borehole has no sample.
 */
export default function SampleReferenceBlock({ samples, active }: Props): JSX.Element {
  const t = useT()
  const ordered = [...samples].sort(
    (a, b) => a.depth_top_m - b.depth_top_m || a.depth_base_m - b.depth_base_m,
  )
  const titleId = 'track-reference-samples-title'
  return (
    <section aria-labelledby={titleId} className="mb-3">
      <h4 id={titleId} className="mb-0.5 text-xs font-semibold text-text-secondary">
        {t('tracks.samples.title')}
      </h4>
      {ordered.length === 0 ? (
        <p className="italic text-text-muted">{t('tracks.samples.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordered.map(sample => {
            const overlaps =
              active !== undefined
              && referenceOverlapsRow({ top_m: sample.depth_top_m, base_m: sample.depth_base_m }, active)
            const lines = sampleLabLines(sample)
            const tests = sample.grain_sizes.filter(g => psdCurvePoints(g).length > 0)
            return (
              <li
                key={sample.id}
                data-overlaps={overlaps ? 'true' : 'false'}
                className={[
                  'rounded px-1 py-0.5',
                  overlaps ? 'bg-amber-100 text-text-primary dark:bg-amber-900/40' : 'text-text-secondary',
                ].join(' ')}
              >
                <div className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-text-muted">
                    {sample.depth_top_m}–{sample.depth_base_m}
                  </span>
                  <span className="font-medium" title={sample.description || undefined}>
                    {sample.sample_number !== null
                      ? t('tracks.samples.label', { n: sample.sample_number })
                      : t('tracks.samples.noNumber')}
                  </span>
                </div>
                {tests.map(test => (
                  <div key={test.id} className="mt-0.5">
                    <div title={test.method ?? undefined}>
                      {test.method !== null
                        ? t('tracks.samples.grainSize', { method: test.method })
                        : t('tracks.samples.grainSizeNoMethod')}
                    </div>
                    <div className="text-text-muted" style={{ width: CHART_WIDTH }}>
                      <PsdMiniChart
                        curves={[{ id: test.id, points: psdCurvePoints(test) }]}
                        width={CHART_WIDTH}
                        height={CHART_HEIGHT}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-2" title={t('tracks.samples.fractionHint')}>
                      {printedFractions(test).map(f => (
                        <span
                          key={f.name}
                          className="tabular-nums"
                          title={f.pct === null ? `${f.name}: ${t('tracks.samples.fractionUnknown')}` : f.name}
                        >
                          {t(`tracks.samples.fraction.${f.name}` as MessageKey)} {formatLabNumber(f.pct)}
                          {f.pct === null ? '' : ' %'}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {lines.map((line, i) => (
                  <div key={i} title={line.title}>
                    {t(line.key, line.params)}
                  </div>
                ))}
                {tests.length === 0 && lines.length === 0 && (
                  <div className="italic text-text-muted">{t('tracks.samples.noLab')}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
