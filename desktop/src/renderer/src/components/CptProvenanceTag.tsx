// "digitised from camz-001.pdf, p. 231" — the CPT chart's provenance tag for a
// CPT read off a PDF report (Data Integrity rule 1: a derived value carries its
// provenance, and the engineer sees it where he reads the curve). The tooltip
// carries the digitiser version and how the depth was obtained. The drilled
// stretches follow the pages ("..., blz. 235, 236, overboring 32.0 tot 32.3 m";
// owner 2026-10-04: the note was on the triage row only). Nothing for a
// GEF / DOV CPT, whose file is its provenance.

import { useT } from '../i18n/translate'
import { drilledIntervalsText, parseDrilledIntervals } from '../utils/drilledIntervals'

/** The subset of the backend's ``import_provenance`` this tag reads. */
export interface CptImportProvenance {
  source?: string
  report_file_name?: string
  pages?: number[]
  digitiser_version?: string
  depth_source?: string
  /** The drilled stretches, ``[top, base]`` in metres; empty when none. */
  drilled_intervals_m?: Array<[number, number]>
  [key: string]: unknown
}

interface Props {
  provenance: CptImportProvenance | null | undefined
}

/**
 * The provenance tag, or nothing.
 *
 * @returns The tag element, or null for a file-imported CPT.
 */
export default function CptProvenanceTag({ provenance }: Props): JSX.Element | null {
  const t = useT()
  if (!provenance || provenance.source !== 'pdf-digitised') return null
  const pages = (provenance.pages ?? []).join(', ')
  const title = [provenance.source, provenance.digitiser_version, provenance.depth_source]
    .filter(Boolean)
    .join(' · ')
  const drilled = parseDrilledIntervals(provenance.drilled_intervals_m) ?? []
  return (
    <span data-testid="cpt-provenance-tag" className="text-[10px] text-gray-400" title={title}>
      {t('chart.pdfDigitised', { file: provenance.report_file_name ?? '?', pages })}
      {drilled.length > 0 && t('chart.pdfDrilled', { list: drilledIntervalsText(drilled, t) })}
    </span>
  )
}
