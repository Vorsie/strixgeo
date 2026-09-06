/**
 * The walker's seeded pseudo-random source.
 *
 * A finding must be reproducible, so every random choice descends from one
 * printed integer seed (env ``WALKER_SEED``). Each step derives its OWN
 * generator from ``(seed, stepIndex)`` via {@link stepRng}, so the decision at
 * step N depends only on the seed and N (and the world the orchestrator
 * observed) -- never on how many random draws earlier steps happened to make.
 * That is what lets a run with the same seed replay the same action sequence.
 *
 * ``mulberry32`` is a tiny, well-known 32-bit generator (public domain); it is
 * NOT cryptographic and does not need to be -- determinism and a decent spread
 * are the only requirements.
 */

/**
 * Build a deterministic generator from a 32-bit seed.
 *
 * @param seed - Any integer; coerced into uint32.
 * @returns A function returning a float in [0, 1) on each call.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Mix a base seed with a step index into a fresh uint32 seed.
 *
 * A plain ``seed + step`` would make adjacent steps' generators near-identical
 * (mulberry32's first output moves little for a +1 seed), so consecutive steps
 * would feel correlated. This scrambles the pair first.
 *
 * @param seed - The run's base seed.
 * @param step - The 0-based step index.
 * @returns A uint32 seed unique-enough per (seed, step).
 */
export function mixSeed(seed: number, step: number): number {
  let h = (seed >>> 0) ^ Math.imul(step + 1, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * The generator for a single step of the walk.
 *
 * @param seed - The run's base seed.
 * @param step - The 0-based step index.
 * @returns A generator seeded deterministically for this step.
 */
export function stepRng(seed: number, step: number): () => number {
  return mulberry32(mixSeed(seed, step))
}

/**
 * Turn a caller-supplied seed string (``WALKER_SEED``) into a uint32.
 *
 * A bare integer string is used as-is (so ``WALKER_SEED=42`` is literally 42
 * and easy to quote in a bug report); any other string is hashed. An empty or
 * missing value returns null so the caller can draw a fresh random seed and
 * print it.
 *
 * @param raw - The env value, possibly undefined.
 * @returns A uint32 seed, or null when nothing usable was supplied.
 */
export function parseSeed(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0
  let h = 0x811c9dc5
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Pick an index in [0, length) from one draw. */
export function pickIndex(rng: () => number, length: number): number {
  if (length <= 0) return -1
  return Math.min(length - 1, Math.floor(rng() * length))
}

/**
 * Pick an index into ``weights`` proportional to each weight.
 *
 * @param rng - The step generator.
 * @param weights - Non-negative weights; all-zero falls back to a uniform pick.
 * @returns The chosen index, or -1 for an empty array.
 */
export function pickWeighted(rng: () => number, weights: readonly number[]): number {
  const n = weights.length
  if (n === 0) return -1
  let total = 0
  for (const w of weights) total += Math.max(0, w)
  if (total <= 0) return pickIndex(rng, n)
  let r = rng() * total
  for (let i = 0; i < n; i++) {
    r -= Math.max(0, weights[i])
    if (r < 0) return i
  }
  return n - 1
}
