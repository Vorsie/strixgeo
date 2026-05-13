import type { SampleResponse } from '../../api/client'

/** Glyph metadata for a single lab-test family — symbol + display
 * label + colour. Shared by ``SamplesTrack`` (per-sample chip row)
 * and ``Legend`` (borehole-level "which families are present" section)
 * so the icon vocabulary stays single-source. */
export interface LabTestIcon {
  /** Single-character SVG glyph (also valid in HTML). */
  symbol: string
  label: string
  /** Hex string for SVG ``fill`` / CSS ``color``. */
  color: string
  /** Predicate over a single sample row. */
  hasOn: (sample: SampleResponse) => boolean
  /** Per-sample label override (e.g. counter for the catch-all
   *  ``"N other"``). Falls back to the static ``label``. */
  perSampleLabel?: (sample: SampleResponse) => string
}

/**
 * Ordered list of lab-test family glyphs. Order matches DOV's pdf
 * report so the visual reading is consistent. The catch-all
 * ``scalar_lab_tests`` family lands last with a star.
 *
 * Adding a new typed family: append one entry here AND the matching
 * detail-panel section in ``LabTestPanel`` — the borelog icons +
 * legend pick up the entry automatically.
 */
export const LAB_TEST_ICONS: ReadonlyArray<LabTestIcon> = [
  {
    symbol: '▣',
    label: 'grain size',
    color: '#8b6f47',
    hasOn: s => s.grain_sizes.length > 0,
  },
  {
    symbol: '▲',
    label: 'Atterberg',
    color: '#1f5077',
    hasOn: s => s.atterberg_limits_tests.length > 0,
  },
  {
    symbol: '◆',
    label: 'CaCO₃',
    color: '#d4a373',
    hasOn: s => s.caco3_content_tests.length > 0,
  },
  {
    symbol: '●',
    label: 'organic',
    color: '#2d6a3e',
    hasOn: s => s.organic_content_tests.length > 0,
  },
  {
    symbol: '◯',
    label: 'water',
    color: '#1e88e5',
    hasOn: s => s.water_content_tests.length > 0,
  },
  {
    symbol: '★',
    label: 'other',
    color: '#a855f7',
    hasOn: s => s.scalar_lab_tests.length > 0,
    perSampleLabel: s => `${s.scalar_lab_tests.length} other`,
  },
]
