/**
 * Pins for the walker's source-map resolver (explicit vitest imports, see
 * walkerPolicy.test.ts).
 *
 * The e2e harness builds the renderer without sourcemaps, so a page error names
 * only ``assets/<chunk>-<hash>.js:line:col``. With ``E2E_SOURCEMAP=1`` the build
 * emits ``.map`` files and the report resolves the frame back to source: a
 * finding must name the SOURCE file and line, not the bundle.
 *
 * The synthetic mapping ``;IA0HQ`` maps generated line 2, column 4 -> source[0]
 * line 123 (1-based), column 8 (0-based) — verified against the source-map
 * package's SourceMapConsumer as an oracle while authoring these pins.
 */

import { describe, it, expect } from 'vitest'

import {
  originalPositionFor,
  parseBundleFrame,
  resolveDetailSourceLocation,
  type RawSourceMap,
} from './walkerSourceMap'
import { formatReport, type ReportFinding, type RunMeta } from './walkerReport'

const SYNTHETIC_MAP: RawSourceMap = {
  version: 3,
  file: 'SectionSheet-Cd88mXWF.js',
  // Vite lists sources relative to out/renderer/assets; the resolver tidies the
  // leading ../ chain back to the stable src/... form.
  sources: ['../../src/renderer/src/components/MapView.tsx'],
  names: [],
  // Line 1 (index 0) empty; line 2 has one segment [genCol 4, src 0, line 122, col 8].
  mappings: ';IA0HQ',
}

// The real walker detail (line 29159) — used for frame parsing and the
// no-map path (both independent of the synthetic map's tiny line count).
const CLEAR_RECT_DETAIL =
  "[ui 23:06:14.007 ERROR globalError] Cannot read properties of undefined (reading 'clearRect') " +
  'file:///C:/Users/robin/Documents/Strix/desktop/out/renderer/assets/SectionSheet-Cd88mXWF.js:29159:23'

// A frame that falls inside the synthetic map (generated line 2, column 5 ->
// 0-based column 4 -> the sole mapped segment). Used for the resolution pins.
const RESOLVABLE_DETAIL =
  "[ui 23:06:14.007 ERROR globalError] Cannot read properties of undefined (reading 'clearRect') " +
  'file:///C:/Users/robin/Documents/Strix/desktop/out/renderer/assets/SectionSheet-Cd88mXWF.js:2:5'

describe('walkerSourceMap -- originalPositionFor (pure VLQ decode)', () => {
  it('resolves a generated frame to its source file and 1-based line', () => {
    // generated line 2 (1-based), column 4 (0-based).
    const pos = originalPositionFor(SYNTHETIC_MAP, 2, 4)
    expect(pos).not.toBeNull()
    expect(pos!.source).toBe('../../src/renderer/src/components/MapView.tsx')
    expect(pos!.line).toBe(123)
    expect(pos!.column).toBe(8)
  })

  it('returns null for a line with no source-bearing mapping', () => {
    // Generated line 1 is empty in the synthetic map.
    expect(originalPositionFor(SYNTHETIC_MAP, 1, 0)).toBeNull()
  })

  it('returns null for a line past the end of the mappings', () => {
    expect(originalPositionFor(SYNTHETIC_MAP, 99, 0)).toBeNull()
  })
})

describe('walkerSourceMap -- parseBundleFrame', () => {
  it('extracts the file url, line and column from a globalError detail', () => {
    const frame = parseBundleFrame(CLEAR_RECT_DETAIL)
    expect(frame).not.toBeNull()
    expect(frame!.fileUrl).toBe(
      'file:///C:/Users/robin/Documents/Strix/desktop/out/renderer/assets/SectionSheet-Cd88mXWF.js',
    )
    expect(frame!.line).toBe(29159)
    expect(frame!.column).toBe(23)
  })

  it('returns null when the detail carries no bundle frame', () => {
    expect(parseBundleFrame('pageerror: Cannot read properties of undefined')).toBeNull()
  })
})

describe('walkerSourceMap -- resolveDetailSourceLocation', () => {
  // RED-FIRST pin (the brief's words): a finding names the source file and
  // line, not the bundle. The injected reader stands in for the emitted .map.
  it('appends the source file and line resolved through the chunk .map', () => {
    const enriched = resolveDetailSourceLocation(RESOLVABLE_DETAIL, () =>
      JSON.stringify(SYNTHETIC_MAP),
    )
    expect(enriched).toContain('src/renderer/src/components/MapView.tsx:123')
    // The raw bundle frame is still there; the source location is appended.
    expect(enriched.startsWith(RESOLVABLE_DETAIL)).toBe(true)
  })

  it('leaves the detail unchanged when no .map is present', () => {
    const same = resolveDetailSourceLocation(CLEAR_RECT_DETAIL, () => null)
    expect(same).toBe(CLEAR_RECT_DETAIL)
  })

  it('leaves a detail with no bundle frame unchanged', () => {
    const detail = 'pageerror: Cannot read properties of undefined'
    expect(resolveDetailSourceLocation(detail, () => JSON.stringify(SYNTHETIC_MAP))).toBe(detail)
  })
})

describe('walkerSourceMap -- formatReport wiring', () => {
  const META: RunMeta = {
    seed: 7,
    steps: 300,
    stepBudget: 300,
    timeBudgetS: 900,
    durationS: 1,
    stagesVisited: ['Sections'],
    projectId: 'p-1',
    startedAt: '2026-09-07T00:00:00.000Z',
    appCrashed: false,
  }

  it('renders the resolved source location in the finding detail', () => {
    const findings: ReportFinding[] = [
      { step: 124, invariant: 'console-error', detail: RESOLVABLE_DETAIL, trail: [] },
    ]
    const md = formatReport(META, findings, d =>
      resolveDetailSourceLocation(d, () => JSON.stringify(SYNTHETIC_MAP)),
    )
    expect(md).toContain('src/renderer/src/components/MapView.tsx:123')
  })
})
