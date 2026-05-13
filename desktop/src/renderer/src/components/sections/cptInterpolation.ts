// Linear-interpolation lookup of a CPT depth-series value at an
// arbitrary depth.
//
// Originally inlined in ContactPickBar's hover readout. The drag
// interaction in ContactsLayer now needs the same thing (qc / Rf at
// the drag's current depth) — the second use triggered the
// project's "extract on the second copy" rule.
//
// ``depths`` is required to be ascending — it is, in every CPT plot
// response coming back from the API. Out-of-range queries clamp to
// the first / last sample. Null samples are skipped via the bracket
// fall-through so partial-coverage series (e.g. CPTE→CPTU mid-test)
// don't silently render as zero.

export function lookupCptValueAtDepth(
  depths: readonly number[],
  values: readonly (number | null)[],
  depth: number,
): number | null {
  if (depths.length === 0 || values.length === 0) return null
  if (depth <= depths[0]) {
    const v = values[0]
    return v ?? null
  }
  if (depth >= depths[depths.length - 1]) {
    const v = values[values.length - 1]
    return v ?? null
  }
  // Linear walk — typical CPT length (~100 samples) makes this
  // cheap enough that a binary search isn't worth the extra code.
  // Hot path: mouse-move on hover / drag, so don't add overhead.
  for (let i = 1; i < depths.length; i += 1) {
    if (depths[i] >= depth) {
      const v0 = values[i - 1]
      const v1 = values[i]
      if (v0 === null || v0 === undefined) return v1 ?? null
      if (v1 === null || v1 === undefined) return v0
      const frac = (depth - depths[i - 1]) / (depths[i] - depths[i - 1])
      return v0 + frac * (v1 - v0)
    }
  }
  return null
}
