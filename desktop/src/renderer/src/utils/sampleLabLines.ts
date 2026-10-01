/**
 * The compact lab lines the track editor's reference pane prints under a
 * sample (owner 2026-10-01, on a real DOV borehole: "this is too verbose,
 * also make a combined sieve + hydrometer graph").
 *
 * At most three short lines, each a list of parts joined with " · ":
 *
 *   1. the fraction shares, read from the sample's COMBINED grain-size curve
 *      (``mergeGrainSizeCurves``): "clay 12 % · silt 43 % · sand 40 % ·
 *      gravel 5 %", or "fines < 63 µm 2 % · sand 96 % · gravel 2 %" when the
 *      curve does not reach 2 um;
 *   2. the classification: "ASTM SW-SM, Well-graded sand with silt · BGGG
 *      grofzand" (only the parts present);
 *   3. the scalars under SHORT labels (``labParameterShortLabels``): "w 16.8 %
 *      · CaCO₃ 1.8 % · org. 0.1 % · ρ 2.1 t/m³ · ρs 2.65 t/m³ · wL 35 % ...".
 *
 * The raw DOV parameter token never prints inline: it is the part's tooltip.
 * Measured numbers keep the precision the lab reported (2.65 stays 2.65);
 * only the shares, which are READ from the curve, round to one decimal.
 *
 * Pure: no React, no DOM.
 */
import type { SampleResponse } from '../api/clients/borehole'
import type { MessageKey } from '../i18n/locales/en'
import { stripDovDoubledTail } from './labTestLabels'
import { LAB_SCALAR_RANK, LAB_SYMBOLS, labParameterRole } from './labParameterShortLabels'
import { mergeGrainSizeCurves, psdFractionShares } from './psdCurve'

/** A part's label: a language-free symbol, or an i18n key when language-bound. */
export type LabLabel = { text: string } | { key: MessageKey }

/** One "label value" chunk of a compact line. */
export interface LabPart {
  label: LabLabel
  /** The value with its unit; ``''`` for a label-only part (non-plastic). */
  value: string
  /** Raw upstream tokens (DOV parameter, method, fraction name) as tooltip. */
  title?: string
  /** A fraction share the combined curve does not reach (printed "?"). */
  unknown?: boolean
}

/** The three compact lines of one sample; an empty list = no line. */
export interface SampleLabSummary {
  shares: LabPart[]
  classification: LabPart[]
  scalars: LabPart[]
}

/**
 * Format a share read from the curve: at most one decimal, no trailing
 * ``.0``; a missing value prints as ``?``.
 *
 * @param value - The number, or ``null`` when it is not known.
 * @returns The display string.
 */
export function formatLabNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '?'
  return String(Number(value.toFixed(1)))
}

/**
 * Format a MEASURED number with the precision the lab reported.
 *
 * ``toPrecision(12)`` only scrubs binary float noise (35 - 20.1); it never
 * rounds away a reported digit.
 */
function formatMeasured(value: number): string {
  return String(Number(value.toPrecision(12)))
}

/** ``value`` + `` unit`` when the unit is known. */
function withUnit(value: string, unit: string | null): string {
  return unit ? `${value} ${unit}` : value
}

/** A scalar part with its print rank. */
interface RankedPart {
  rank: number
  part: LabPart
}

/** Percentage part of a typed family, or nothing when not reported. */
function pctPart(
  symbol: string,
  rank: number,
  pct: number | null,
  method: string | null,
): RankedPart | null {
  if (pct === null || !Number.isFinite(pct)) return null
  return { rank, part: { label: { text: symbol }, value: `${formatMeasured(pct)} %`, title: method ?? undefined } }
}

/** The fraction names a share line prints; each is also the raw zone token. */
type FractionName = 'clay' | 'silt' | 'fines' | 'sand' | 'gravel'

/** The share line, read from the combined grain-size curve. */
function shareParts(sample: SampleResponse): LabPart[] {
  const points = mergeGrainSizeCurves(sample.grain_sizes)
  if (points.length === 0) return []
  const shares = psdFractionShares(points)
  // Clay + silt only when the combined curve reaches 2 um; else the fines
  // (< 63 um) as one share, the one fine number a sieve curve still tells.
  const fine: { name: FractionName; pct: number | null }[] =
    shares.clay !== null && shares.silt !== null
      ? [
          { name: 'clay', pct: shares.clay },
          { name: 'silt', pct: shares.silt },
        ]
      : [{ name: 'fines', pct: shares.fines }]
  const all: { name: FractionName; pct: number | null }[] = [
    ...fine,
    { name: 'sand', pct: shares.sand },
    { name: 'gravel', pct: shares.gravel },
  ]
  return all.map(f => ({
    label: { key: `tracks.samples.fraction.${f.name}` as MessageKey },
    value: f.pct === null ? '?' : `${formatLabNumber(f.pct)} %`,
    title: f.name,
    unknown: f.pct === null,
  }))
}

/** One classification row: its value and the raw DOV token. */
interface ClassificationRow {
  value: string
  raw: string
}

/**
 * The compact lines of one sample.
 *
 * @param sample - The sample as the borehole detail carries it.
 * @returns Shares, classification and scalar parts; a line with nothing to
 *          say is an empty list.
 */
export function sampleLabSummary(sample: SampleResponse): SampleLabSummary {
  const scalars: RankedPart[] = []
  const push = (p: RankedPart | null): void => {
    if (p) scalars.push(p)
  }
  for (const w of sample.water_content_tests) {
    push(pctPart(LAB_SYMBOLS.waterContent, LAB_SCALAR_RANK.waterContent, w.content_pct, w.method))
  }
  for (const c of sample.caco3_content_tests) {
    push(pctPart(LAB_SYMBOLS.caco3, LAB_SCALAR_RANK.caco3, c.content_pct, c.method))
  }
  for (const o of sample.organic_content_tests) {
    // Matter and carbon are different quantities: each keeps its own symbol.
    push(pctPart(LAB_SYMBOLS.organicMatter, LAB_SCALAR_RANK.organicMatter, o.matter_pct, o.method))
    push(pctPart(LAB_SYMBOLS.organicCarbon, LAB_SCALAR_RANK.organicCarbon, o.carbon_pct, o.method))
  }
  for (const att of sample.atterberg_limits_tests) {
    if (att.non_plastic === true) {
      scalars.push({
        rank: LAB_SCALAR_RANK.atterberg,
        part: { label: { key: 'tracks.samples.nonPlastic' }, value: '', title: att.method ?? undefined },
      })
      continue
    }
    push(pctPart(LAB_SYMBOLS.liquidLimit, LAB_SCALAR_RANK.atterberg, att.liquid_limit_pct, att.method))
    push(pctPart(LAB_SYMBOLS.plasticLimit, LAB_SCALAR_RANK.atterberg, att.plastic_limit_pct, att.method))
    // No plasticity index is invented from one limit.
    if (att.liquid_limit_pct !== null && att.plastic_limit_pct !== null) {
      push(
        pctPart(
          LAB_SYMBOLS.plasticityIndex,
          LAB_SCALAR_RANK.atterberg,
          att.liquid_limit_pct - att.plastic_limit_pct,
          att.method,
        ),
      )
    }
  }

  let astmCode: ClassificationRow | null = null
  let astmName: ClassificationRow | null = null
  const bggg: LabPart[] = []
  for (const s of sample.scalar_lab_tests) {
    const value =
      s.value_numeric !== null ? withUnit(formatMeasured(s.value_numeric), s.unit) : (s.value_text ?? '').trim()
    if (value === '') continue
    const role = labParameterRole(stripDovDoubledTail(s.parameter))
    if (role.kind === 'astmCode') {
      astmCode ??= { value, raw: s.parameter }
    } else if (role.kind === 'astmName') {
      astmName ??= { value, raw: s.parameter }
    } else if (role.kind === 'bggg') {
      bggg.push({ label: { text: 'BGGG' }, value, title: s.parameter })
    } else {
      scalars.push({ rank: role.rank, part: { label: { text: role.symbol }, value, title: s.parameter } })
    }
  }
  const classification: LabPart[] = []
  const astm = [astmCode, astmName].filter((x): x is ClassificationRow => x !== null)
  if (astm.length > 0) {
    classification.push({
      label: { text: 'ASTM' },
      value: astm.map(x => x.value).join(', '),
      title: astm.map(x => x.raw).join('\n'),
    })
  }
  classification.push(...bggg)

  // Stable sort: equal ranks keep the order the lab reported them in.
  scalars.sort((a, b) => a.rank - b.rank)
  return { shares: shareParts(sample), classification, scalars: scalars.map(s => s.part) }
}

/**
 * The first words of a DOV grain-size method: the text before the first
 * " op " / " met " / " volgens " qualifier, comma or parenthesis
 * ("Zeving op massa met grootte <= 2mm (fijnkorrelig)" -> "Zeving").
 */
function shortMethod(raw: string): string {
  return raw.split(/\s+(?:op|met|volgens)\s+|\s*[(,]/)[0].trim() || raw.trim()
}

/**
 * The title of a sample's ONE grain-size chart: its methods joined with
 * " + " (owner 2026-10-01: "make a combined sieve + hydrometer graph").
 *
 * @param tests - The grain-size tests drawn in the chart.
 * @returns ``text`` (short methods, deduplicated) + ``title`` (the raw
 *          method tokens), or ``null`` when no test names a method.
 */
export function grainSizeMethodsTitle(
  tests: readonly { method: string | null }[],
): { text: string; title: string } | null {
  const raws = [...new Set(tests.map(t => t.method?.trim() ?? '').filter(m => m !== ''))]
  if (raws.length === 0) return null
  const shorts = [...new Set(raws.map(shortMethod))]
  return { text: shorts.join(' + '), title: raws.join(' + ') }
}
