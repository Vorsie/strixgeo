// Tiny array helpers — promoted out of inline duplications across the
// codebase per the "extract on the second copy" rule in user-CLAUDE.md.

// Shallow positional equality. Callers use this for arrays of primitives
// (string ids, numeric epsg codes, tag labels) where reference equality
// isn't enough but JSON.stringify is overkill.
export function arraysEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
