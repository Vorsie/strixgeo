import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Static check: every React hook call in ``App.tsx`` must live ABOVE
// the first early-return guard in the function body, so the hook
// count stays identical whether ``apiError`` / ``ready`` / ``project``
// short-circuit the render or not.
//
// We hit this exact bug while wiring M1: ``useMemo``s for the DEM
// overlay landed below the ``if (!project) return <WelcomeScreen />``
// guard, so the first render (no project) called N-3 hooks and the
// next render (after newProject) called N — React threw
// "Rendered more hooks than during the previous render".
//
// A full ``render(<App />)`` smoke test would also catch this but
// needs leaflet / electron / fetch all mocked. This grep-style
// invariant is a thin alternative — same protection for ~50 lines.
//
// If this test fails because you legitimately need a hook below the
// early-return ladder, the right fix is almost always to lift the
// hook above the ladder instead of relaxing this guard.

describe('App.tsx — Rules of Hooks structure', () => {
  it('every hook lives above the first early-return guard', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, 'App.tsx'), 'utf8')

    const lines = src.split('\n')

    // The App function body is the top-level ``export default function App() {``.
    const appStart = lines.findIndex(l => /^export default function App\b/.test(l))
    expect(appStart, 'expected `export default function App` in App.tsx').toBeGreaterThanOrEqual(0)

    // First early-return = the first ``if (...) {<newline>    return``
    // pattern after ``App`` opens. Matches the ``if (apiError) { return ... }``
    // / ``if (!ready) { return ... }`` / ``if (!project) { return ... }``
    // ladder uniformly.
    let firstEarlyReturnLine = -1
    for (let i = appStart + 1; i < lines.length; i += 1) {
      // ``  if (...) {`` followed within 3 lines by ``    return``
      if (/^\s{2}if \(/.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
          if (/^\s{4,}return\b/.test(lines[j])) {
            firstEarlyReturnLine = i
            break
          }
        }
        if (firstEarlyReturnLine !== -1) break
      }
    }
    expect(firstEarlyReturnLine, 'expected an early-return guard in App').toBeGreaterThan(appStart)

    // Locate every hook call BELOW the first early-return guard and
    // ABOVE the final ``}`` that closes the App function. ``return (``
    // marking the main JSX render is the upper bound — hooks inside
    // JSX or inside other components don't count, but ``App.tsx``
    // doesn't define other top-level components so the simple bound
    // works.
    const HOOK_RE = /\b(useState|useEffect|useLayoutEffect|useMemo|useCallback|useRef|useReducer|useContext|useImperativeHandle|useDeferredValue|useTransition|useSyncExternalStore|useId|useInsertionEffect)\b/

    const violations: { line: number; text: string }[] = []
    const renderJsxStart = lines.findIndex(
      (l, idx) => idx > firstEarlyReturnLine && /^\s{2}return \(/.test(l),
    )
    const upperBound = renderJsxStart > 0 ? renderJsxStart : lines.length

    for (let i = firstEarlyReturnLine + 1; i < upperBound; i += 1) {
      const line = lines[i]
      // Skip comments — many docstrings reference hook names by name.
      if (/^\s*\/\//.test(line)) continue
      if (HOOK_RE.test(line)) {
        violations.push({ line: i + 1, text: line.trim() })
      }
    }

    expect(
      violations,
      `Hook calls found below the first early-return guard ` +
        `(L${firstEarlyReturnLine + 1}). Move them above the guard so the ` +
        `hook count stays stable across renders. Offenders:\n` +
        violations.map(v => `  L${v.line}: ${v.text}`).join('\n'),
    ).toEqual([])
  })
})
