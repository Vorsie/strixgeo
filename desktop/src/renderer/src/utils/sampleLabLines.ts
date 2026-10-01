/**
 * The short lab-result lines the track editor's reference pane prints under a
 * sample (owner 2026-10-01: "i also want the psd's of monster to be visible in
 * the right hand pane").
 *
 * One line per test: Atterberg limits, water content, organic content, CaCO3
 * and every row of the scalar catch-all. The typed families get a translated
 * line; a catch-all row prints its raw DOV parameter token (no translation
 * table exists for those) with the parameter group as tooltip. The grain-size
 * curve is NOT here: the pane draws it and reads its fractions itself
 * (``psdFractionShares``).
 *
 * Pure: no React, no DOM.
 */
import type { SampleResponse } from '../api/clients/borehole'
import type { MessageKey } from '../i18n/locales/en'
import type { MessageParams } from '../i18n/translate'

/** One printable result line: an i18n key + its params, and a tooltip. */
export interface SampleLabLine {
  key: MessageKey
  params: MessageParams
  /** Raw upstream token (method, parameter group) shown as tooltip. */
  title?: string
}

/**
 * Format a percentage-like number for a compact line: at most one decimal,
 * no trailing ``.0``; a missing value prints as ``?``.
 *
 * @param value - The number, or ``null`` when the lab did not report it.
 * @returns The display string.
 */
export function formatLabNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '?'
  return String(Number(value.toFixed(1)))
}

/**
 * The result lines of one sample, in a fixed family order.
 *
 * @param sample - The sample as the borehole detail carries it.
 * @returns One line per test; empty when the sample carries none of them.
 */
export function sampleLabLines(sample: SampleResponse): SampleLabLine[] {
  const lines: SampleLabLine[] = []
  for (const att of sample.atterberg_limits_tests) {
    if (att.non_plastic === true) {
      lines.push({ key: 'tracks.samples.nonPlastic', params: {}, title: att.method ?? undefined })
      continue
    }
    if (att.liquid_limit_pct === null && att.plastic_limit_pct === null) continue
    const pi =
      att.liquid_limit_pct !== null && att.plastic_limit_pct !== null
        ? att.liquid_limit_pct - att.plastic_limit_pct
        : null
    lines.push({
      key: 'tracks.samples.atterberg',
      params: {
        ll: formatLabNumber(att.liquid_limit_pct),
        pl: formatLabNumber(att.plastic_limit_pct),
        pi: formatLabNumber(pi),
      },
      title: att.method ?? undefined,
    })
  }
  for (const w of sample.water_content_tests) {
    if (w.content_pct === null) continue
    lines.push({
      key: 'tracks.samples.waterContent',
      params: { pct: formatLabNumber(w.content_pct) },
      title: w.method ?? undefined,
    })
  }
  for (const o of sample.organic_content_tests) {
    // Matter and carbon are different quantities: each gets its own label.
    if (o.matter_pct !== null) {
      lines.push({
        key: 'tracks.samples.organicMatter',
        params: { pct: formatLabNumber(o.matter_pct) },
        title: o.method ?? undefined,
      })
    }
    if (o.carbon_pct !== null) {
      lines.push({
        key: 'tracks.samples.organicCarbon',
        params: { pct: formatLabNumber(o.carbon_pct) },
        title: o.method ?? undefined,
      })
    }
  }
  for (const c of sample.caco3_content_tests) {
    if (c.content_pct === null) continue
    lines.push({
      key: 'tracks.samples.caco3',
      params: { pct: formatLabNumber(c.content_pct) },
      title: c.method ?? undefined,
    })
  }
  for (const s of sample.scalar_lab_tests) {
    const value =
      s.value_numeric !== null
        ? // Not a percentage: a density needs its second decimal, so the
          // catch-all keeps up to three instead of the percent lines' one.
          `${String(Number(s.value_numeric.toFixed(3)))}${s.unit ? ` ${s.unit}` : ''}`
        : s.value_text
    if (value === null || value === '') continue
    lines.push({
      key: 'tracks.samples.scalar',
      params: { parameter: s.parameter, value },
      title: s.parameter_group,
    })
  }
  return lines
}
