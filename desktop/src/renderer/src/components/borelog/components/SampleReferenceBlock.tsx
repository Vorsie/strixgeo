/**
 * The "Samples (DOV)" block of the track editor's reference pane (owner
 * 2026-10-01: "i also want the psd's of monster to be visible in the right
 * hand pane"; same day, on a real DOV borehole: "this is too verbose, also
 * make a combined sieve + hydrometer graph").
 *
 * Lists the borehole's samples by depth interval and sample number. Per
 * sample ONE mini PSD chart (the same chart the section view's sample hover
 * card draws), drawn from the COMBINED curve of the sample's grain-size tests
 * (``mergeGrainSizeCurves``) and titled with their methods joined. Under it
 * at most three compact lines (``sampleLabSummary``): the fraction shares
 * read from the combined curve, the classification, the scalars under short
 * labels. A share the combined curve does not reach prints "?" with a
 * tooltip, never guessed; the raw DOV tokens are tooltips, never inline.
 *
 * A sample whose depth interval overlaps the focused editor row is marked the
 * same way the other reference intervals are (``referenceOverlapsRow``), so
 * the scroll-into-view of the pane reaches it too (``data-overlaps``).
 */
import type { SampleResponse } from '../../../api/client'
import { useT, type Translator } from '../../../i18n/translate'
import { referenceOverlapsRow, type TrackEditorRow } from '../../../utils/boreholeTracks'
import { mergeGrainSizeCurves, psdCurvePoints } from '../../../utils/psdCurve'
import { grainSizeMethodsTitle, sampleLabSummary, type LabPart } from '../../../utils/sampleLabLines'
import PsdMiniChart from '../../sections/PsdMiniChart'

interface Props {
  samples: readonly SampleResponse[]
  /** The focused editor row; ``undefined`` = nothing focused. */
  active: TrackEditorRow | undefined
}

/** Mini chart size in the pane (px): fits the 24rem pane minus its padding. */
const CHART_WIDTH = 300
const CHART_HEIGHT = 72

/** One part as printed: "label value" (a label-only part prints its label). */
function partText(part: LabPart, t: Translator): string {
  const label = 'text' in part.label ? part.label.text : t(part.label.key)
  return part.value === '' ? label : `${label} ${part.value}`
}

/** One compact line: its parts joined with " · ", each with its tooltip. */
function LabLine({ parts, title }: { parts: readonly LabPart[]; title?: string }): JSX.Element | null {
  const t = useT()
  if (parts.length === 0) return null
  return (
    <div data-testid="sample-lab-line" title={title}>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <span
            className="tabular-nums"
            title={part.unknown ? `${part.title ?? ''}: ${t('tracks.samples.fractionUnknown')}` : part.title}
          >
            {partText(part, t)}
          </span>
        </span>
      ))}
    </div>
  )
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
            const summary = sampleLabSummary(sample)
            const curve = mergeGrainSizeCurves(sample.grain_sizes)
            const methods = grainSizeMethodsTitle(
              sample.grain_sizes.filter(g => psdCurvePoints(g).length > 0),
            )
            const hasLab =
              curve.length > 0
              || summary.shares.length + summary.classification.length + summary.scalars.length > 0
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
                {curve.length > 0 && (
                  <div className="mt-0.5">
                    <div title={methods?.title}>{methods?.text ?? t('tracks.samples.grainSizeNoMethod')}</div>
                    <div className="text-text-muted" style={{ width: CHART_WIDTH }}>
                      <PsdMiniChart
                        curves={[{ id: sample.id, points: curve }]}
                        width={CHART_WIDTH}
                        height={CHART_HEIGHT}
                      />
                    </div>
                  </div>
                )}
                <LabLine parts={summary.shares} title={t('tracks.samples.fractionHint')} />
                <LabLine parts={summary.classification} />
                <LabLine parts={summary.scalars} />
                {!hasLab && <div className="italic text-text-muted">{t('tracks.samples.noLab')}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
