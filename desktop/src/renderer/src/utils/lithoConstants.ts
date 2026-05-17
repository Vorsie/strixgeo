// Shared lithology → display label + colour tables (#55, senior-review
// S-2/C-1). Single source of truth: the ghost-suggestion overlay
// renders a layer with LITHOLOGY_LABELS[token] / LITHOLOGY_COLORS[token],
// and handleAcceptLithoSuggestion creates the formation with the SAME
// name + colour. Two copies (the prior state) would let an accepted
// layer's formation drift from what its ghost column showed — a
// user-facing mismatch. Hex literals (SVG fill attribute / formation
// colour column) — NOT Tailwind tokens.
//
// Keys are the base-lithology tokens the Robertson segmenter emits
// (domain/services/litho_constants.py BASE_LITHOLOGIES).

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

/** Fallback colour for an unrecognised lithology token (matches the
 * neutral-grey default used at formation create). */
export const LITHOLOGY_FALLBACK_COLOR = '#9ca3af'
