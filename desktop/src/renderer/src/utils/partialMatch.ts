/**
 * Pure ranking utility for partial-match ordering of stratigraphy names.
 *
 * Implements `rankByPartialMatch` — a deterministic score-based sort that
 * helps the user locate a candidate by typing part of its name.  It NEVER
 * filters out items (every name receives a score, even 0); the caller always
 * shows the full list so the user can hand-pick a zero-score name into a
 * group whose synonymy the string math cannot know.
 *
 * Design constraints (owner directive, 2026-05-17):
 *   - The system MUST NOT decide that two names are the same unit.
 *   - Ranking REORDERS; it never removes anything from the candidate list.
 *   - No seeds, no default rules, no auto-alias library.
 */

// Noise tokens that carry no distinguishing information and are dropped
// before token-set Jaccard scoring.  These are short Dutch/English
// prepositions and articles that appear in virtually every formation name
// (e.g. "Formatie VAN Aalter", "Lid VAN Oedelem", "Afzettingen VAN DE
// Lede") and would artificially inflate token-set similarity between
// unrelated names.  Bare numbers (e.g. depth qualifiers like "3.50") are
// also dropped because they appear in verbose DOV descriptions.
// WHY a Set: O(1) membership test inside the hot token-filter path.
const NOISE_TOKENS = new Set([
  'van',
  'de',
  'het',
  'tot',
  'm',
])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Typographically normalise a string for matching purposes.
 *
 * Steps mirror the Python `normalize_formation_key` typographic core:
 *   1. NFD + remove combining characters → strips diacritics (é → e,
 *      ë → e, ü → u).  This is the main reason "holoceen" matches
 *      "holocene" — the acute / diaeresis on Dutch variants disappear.
 *   2. Lowercase.
 *   3. Collapse every non-alphanumeric run to a single space; trim.
 *
 * NOT exported — callers use `rankByPartialMatch`.
 */
function _normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Split a normalised string into significant tokens (noise tokens removed).
 */
function _tokens(normalised: string): string[] {
  return normalised
    .split(' ')
    .filter(t => t.length > 0 && !NOISE_TOKENS.has(t) && !/^\d+$/.test(t))
}

/**
 * Token-set Jaccard similarity: |A ∩ B| / |A ∪ B|.
 * Returns 0 when both sets are empty.
 */
function _jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setB = new Set(b)
  let intersection = 0
  for (const t of a) {
    if (setB.has(t)) intersection++
  }
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : intersection / union
}

/**
 * Character bigram Dice coefficient.
 *
 * Dice = 2 * |bigrams(A) ∩ bigrams(B)| / (|bigrams(A)| + |bigrams(B)|).
 * Returns 0 for strings shorter than 2 characters.
 *
 * This is the fuzzy tiebreaker that catches spelling variants such as
 * "holoceen" ↔ "holocene" — they share most bigrams (ho, ol, lo, oc, ce,
 * ee/en) even though their token sets are identical (only one token each).
 */
function _diceBigrams(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0
  function bigrams(s: string): Map<string, number> {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }
  const ba = bigrams(a)
  const bb = bigrams(b)
  let intersect = 0
  for (const [bg, count] of ba) {
    const countB = bb.get(bg) ?? 0
    intersect += Math.min(count, countB)
  }
  const total = (a.length - 1) + (b.length - 1)
  return total === 0 ? 0 : (2 * intersect) / total
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A candidate name with its match score in [0, 1]. */
export interface RankedName {
  /** The original candidate string (unmodified). */
  name: string
  /**
   * Match score in [0, 1].  Higher = better match.
   * A score of 0 does NOT mean filtered out — the candidate is still returned;
   * the caller must never hide zero-score items from the user.
   */
  score: number
}

/**
 * Rank a list of candidate names by how well they match `query`.
 *
 * Returns every name in the input — NEVER removes any entry.  The
 * "rank-reorders-never-filters" rule is load-bearing: the user must be
 * able to hand-pick a zero-score name (e.g. "Lid van Saint-Maur") into an
 * "Orchies" group when string math cannot know the synonymy.
 *
 * Score is a deterministic weighted blend of three signals, each in [0, 1]:
 *   1. **Containment** (weight 0.50) — the normalised query is a substring
 *      of the normalised candidate, or the candidate is a substring of the
 *      query.  This is the strongest signal for the common "type part of
 *      the name" use-case.
 *   2. **Token-set Jaccard** (weight 0.30) — proportion of significant
 *      tokens shared between query and candidate (noise tokens excluded).
 *   3. **Dice bigrams** (weight 0.20) — character-bigram overlap between
 *      the full normalised strings; catches spelling variants such as
 *      "holoceen" ↔ "holocene".
 *
 * The returned array is sorted by score descending, with a stable secondary
 * sort by original name ascending so equal-score items are always in a
 * predictable order.
 *
 * @param query - The search string typed by the user.
 * @param names - The full candidate list (not filtered, not deduplicated).
 * @returns Every input name with a score, sorted score-desc / name-asc.
 *
 * @example
 * ```ts
 * const ranked = rankByPartialMatch('holoceen', [...candidates])
 * // Items named 'Holoceen', 'Holoceen (Laat Pleistoceen)', and
 * // 'Quartair: Holocene afzettingen' all score high.
 * // Items with score 0 ('Geroerd', 'Verstoord') appear at the bottom.
 * ```
 */
export function rankByPartialMatch(
  query: string,
  names: string[],
): RankedName[] {
  if (names.length === 0) return []

  const normQuery = _normalise(query)
  const queryTokens = _tokens(normQuery)

  const scored: RankedName[] = names.map(name => {
    const normName = _normalise(name)

    // Signal 1: containment — query ⊆ candidate or candidate ⊆ query.
    // Weighted 0.50 — the primary "I know how it starts" signal.
    const containment =
      normQuery.length > 0 &&
      (normName.includes(normQuery) || normQuery.includes(normName))
        ? 1
        : 0

    // Signal 2: token-set Jaccard on significant tokens.
    const nameTokens = _tokens(normName)
    const jaccard = _jaccardTokens(queryTokens, nameTokens)

    // Signal 3: Dice bigrams for fuzzy spelling-variant matching.
    // WHY: "holoceen" and "holocene" share most bigrams even though
    // their exact character strings differ; bigram Dice bridges the gap
    // that token-set Jaccard and containment miss.
    const dice = _diceBigrams(normQuery, normName)

    const score = 0.5 * containment + 0.3 * jaccard + 0.2 * dice
    return { name, score }
  })

  // Sort: score desc, then original name asc for stability.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.name.localeCompare(b.name)
  })

  return scored
}
