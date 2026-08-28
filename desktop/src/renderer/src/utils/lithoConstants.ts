// Shared lithology → display label + colour tables (#55, senior-review
// S-2/C-1). The ghost-suggestion overlay renders a layer with
// LITHOLOGY_LABELS[token] / LITHOLOGY_COLORS[token] BEFORE any formation
// row exists; on accept the backend stamps the formation's stored colour
// from the same lithology (debt #145), so accepted bands read
// ``formation.color`` directly and never drift from their ghost.
//
// LITHOLOGY_COLORS MUST stay byte-identical to the backend mirror in
// ``shared/constants/litho_constants.py`` (LITHOLOGY_COLORS) — the two
// together are the single colour spec; a divergence would let a ghost
// preview disagree with the accepted band. Hex literals (SVG fill
// attribute / formation colour column) — NOT Tailwind tokens.
//
// Keys are the base-lithology tokens the Robertson segmenter emits
// (shared/constants/litho_constants.py BASE_LITHOLOGIES).

export const LITHOLOGY_COLORS: Record<string, string> = {
  GRIND: '#d97706', // amber / orange-brown — gravel
  ZAND: '#fbbf24', // yellow — sand
  SILT: '#84cc16', // lime-green — silt
  KLEI: '#6b7280', // blue-grey — clay
  VEEN: '#92400e', // dark brown — peat
}

export const LITHOLOGY_LABELS: Record<string, string> = {
  GRIND: 'Gravel',
  ZAND: 'Sand',
  SILT: 'Silt',
  KLEI: 'Clay',
  VEEN: 'Peat',
}

// Dutch (Flemish) base-lithology labels. Translate-at-the-presentation-boundary
// means rendering Dutch is SELECTING the source token, not inventing one: the
// five base lithologies ARE Dutch words in the domain (ZAND / KLEI / SILT /
// GRIND / VEEN, the ``BASE_LITHOLOGIES`` the backend stores), so the NL label is
// simply the title-cased source token. Keyed identically to ``LITHOLOGY_LABELS``
// so a display helper can pick the table by language and get the SAME five keys.
export const LITHOLOGY_LABELS_NL: Record<string, string> = {
  GRIND: 'Grind',
  ZAND: 'Zand',
  SILT: 'Silt',
  KLEI: 'Klei',
  VEEN: 'Veen',
}

/** Fallback colour for an unrecognised lithology token (matches the
 * neutral-grey default used at formation create). Still used by the
 * ghost-suggestion overlay, which colours a layer before any formation
 * row exists. Once a suggestion is accepted the backend stamps the
 * formation's ``color`` at create (debt #145), so read-side surfaces
 * read ``formation.color`` directly — no presentation-layer override. */
export const LITHOLOGY_FALLBACK_COLOR = '#9ca3af'
