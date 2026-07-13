/**
 * Automated parity gate for the lithology colour palette (debt DRY-05).
 *
 * Why this exists
 * ---------------
 * The lithology to colour spec lives in TWO places that MUST stay
 * byte-identical:
 *
 *   - the frontend ``LITHOLOGY_COLORS`` table in this directory's
 *     ``lithoConstants.ts`` (drives the ghost-suggestion overlay), and
 *   - the backend mirror ``LITHOLOGY_COLORS`` in
 *     ``src/groundmodel/shared/constants/litho_constants.py`` (stamped onto
 *     ``geological_formation.color`` at litho-formation create).
 *
 * A divergence would let a ghost preview render one colour while the accepted
 * band reads another from the DB. Parity was previously enforced only by
 * hand-maintained comments in both files; this test replaces the comment with
 * a real gate that fails on any drift.
 *
 * How it works
 * ------------
 * Imports the TS palette directly, reads the Python source from the repo via
 * ``node:fs`` (resolving REPO_ROOT from ``import.meta.url`` the same way
 * ``partitionFill.cs1void.test.ts`` does), extracts the Python
 * ``LITHOLOGY_COLORS`` dict + the ``LITHOLOGY_FALLBACK_COLOR`` scalar with
 * tolerant regexes anchored on the actual ``"TOKEN": "#hex"`` source shape,
 * and asserts identical token sets (both directions, missing tokens reported
 * by name) and identical hex per token (case-insensitive).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LITHOLOGY_COLORS, LITHOLOGY_FALLBACK_COLOR } from './lithoConstants'

// utils -> src -> renderer -> src -> desktop -> repo root (same walk as the
// committed CS1 real-data gate in partitionFill.cs1void.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const PY_PATH = resolve(REPO_ROOT, 'src/groundmodel/shared/constants/litho_constants.py')

/**
 * Extract the backend ``LITHOLOGY_COLORS`` dict from the Python source.
 *
 * Isolates the ``LITHOLOGY_COLORS: dict[str, str] = { ... }`` block first so
 * entries from the other colour scalar / dicts in the file can never leak in,
 * then pulls every ``"TOKEN": "#hex"`` pair from inside it.
 *
 * @returns Mapping of base-lithology token to lowercased hex colour string.
 */
function parsePythonColors(source: string): Record<string, string> {
  const blockMatch = source.match(/LITHOLOGY_COLORS\s*:\s*dict\[str,\s*str\]\s*=\s*\{([\s\S]*?)\}/)
  if (!blockMatch) {
    throw new Error(
      'Could not locate the `LITHOLOGY_COLORS: dict[str, str] = { ... }` block in ' +
        `${PY_PATH} - the backend palette shape changed; update this parity gate's regex.`,
    )
  }
  const body = blockMatch[1]
  const colors: Record<string, string> = {}
  // Anchor on the literal source shape:  "TOKEN": "#rrggbb",
  const entryRe = /"([A-Z]+)"\s*:\s*"(#[0-9a-fA-F]{3,8})"/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(body)) !== null) {
    colors[m[1]] = m[2].toLowerCase()
  }
  return colors
}

/**
 * Extract the backend ``LITHOLOGY_FALLBACK_COLOR`` scalar from the source.
 *
 * @returns The lowercased fallback hex colour string.
 */
function parsePythonFallback(source: string): string {
  const m = source.match(/LITHOLOGY_FALLBACK_COLOR\s*=\s*"(#[0-9a-fA-F]{3,8})"/)
  if (!m) {
    throw new Error(
      'Could not locate `LITHOLOGY_FALLBACK_COLOR = "#..."` in ' +
        `${PY_PATH} - the backend fallback shape changed; update this parity gate's regex.`,
    )
  }
  return m[1].toLowerCase()
}

describe('lithology colour palette parity (TS <-> Python)', () => {
  const pySource = readFileSync(PY_PATH, 'utf8')
  const pyColors = parsePythonColors(pySource)
  const pyFallback = parsePythonFallback(pySource)

  const tsTokens = Object.keys(LITHOLOGY_COLORS).sort()
  const pyTokens = Object.keys(pyColors).sort()

  it('the regex actually extracted a non-empty backend palette', () => {
    // Guard against a silently-empty parse masking a real divergence.
    expect(pyTokens.length).toBeGreaterThan(0)
  })

  it('has no token in TS that is missing from the Python palette', () => {
    const missingInPy = tsTokens.filter((t) => !(t in pyColors))
    expect(
      missingInPy,
      `Tokens present in lithoConstants.ts but absent from litho_constants.py: ${
        missingInPy.join(', ') || '(none)'
      }`,
    ).toEqual([])
  })

  it('has no token in Python that is missing from the TS palette', () => {
    const missingInTs = pyTokens.filter((t) => !(t in LITHOLOGY_COLORS))
    expect(
      missingInTs,
      `Tokens present in litho_constants.py but absent from lithoConstants.ts: ${
        missingInTs.join(', ') || '(none)'
      }`,
    ).toEqual([])
  })

  it('has identical token sets in both palettes', () => {
    expect(tsTokens).toEqual(pyTokens)
  })

  it('has an identical hex value for every shared token (case-insensitive)', () => {
    const mismatches: string[] = []
    for (const token of tsTokens) {
      if (!(token in pyColors)) continue
      const tsHex = LITHOLOGY_COLORS[token].toLowerCase()
      const pyHex = pyColors[token]
      if (tsHex !== pyHex) {
        mismatches.push(`${token}: TS=${tsHex} vs PY=${pyHex}`)
      }
    }
    expect(mismatches, `Colour divergences: ${mismatches.join('; ') || '(none)'}`).toEqual([])
  })

  it('has an identical fallback colour (case-insensitive)', () => {
    expect(LITHOLOGY_FALLBACK_COLOR.toLowerCase()).toBe(pyFallback)
  })
})
