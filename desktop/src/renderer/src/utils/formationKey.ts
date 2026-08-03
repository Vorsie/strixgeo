/**
 * Client-side mirror of the server's stratigraphy merge key.
 *
 * The backend derives a formation's identity with
 * ``groundmodel.shared.formation_key.normalize_formation_key``.  Anywhere the
 * renderer has to answer "is THIS formation the one behind THAT candidate key",
 * it must answer it the same way the server will — the da98053 UI freeze was a
 * raw ``.toLowerCase()`` on the client diverging from the server's normaliser
 * for every name containing a dash, colon, or double space.
 *
 * The normalisation is typographic ONLY, exactly as on the server: no
 * chrono-prefix stripping, no "lid van" reduction, no diacritic folding.  Two
 * formations that differ semantically must keep differing here.
 *
 * WHY a mirror instead of asking the server: these keys are compared inside
 * synchronous render paths (pre-check state, "what would this Apply delete")
 * where a round-trip is not available.  Keep this file in lockstep with
 * ``formation_key.py``; it is the one place the duplication lives.
 */

/**
 * Canonicalise a stratigraphy description into its merge / identity key.
 *
 * Mirrors the Python implementation step for step:
 *   1. NFKC — folds NBSP → space, en/em-dash → ``-``, ligature and fullwidth
 *      forms.
 *   2. Lowercase (the JS stand-in for Python's Unicode ``casefold``).
 *   3. Collapse every run of non-alphanumeric characters — punctuation,
 *      whitespace, underscores — to a single space, then trim.
 *
 * @param raw - Raw layer description, ``regional_ref``, or formation name.
 * @returns The normalised key; ``''`` for an empty / whitespace-only input.
 */
export function normaliseFormationKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    // Unicode-aware "non-word" run, matching Python's `[\W_]+` with re.UNICODE.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The stable key of an existing formation.
 *
 * Mirrors the server rule: ``regional_ref`` when it carries a value (the
 * stable cross-borehole formal code), else the display ``name``.
 *
 * @param formation - Anything carrying the two identity fields.
 * @returns The normalised stable key.
 */
export function formationStableKey(formation: {
  name: string
  regional_ref?: string | null
}): string {
  return normaliseFormationKey(formation.regional_ref ?? formation.name)
}
