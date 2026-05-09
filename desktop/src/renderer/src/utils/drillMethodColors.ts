// Categorical colours for DOV drill-method tokens, used by the
// drill-method track in the borelog.
//
// Tokens (lowercased for matching) come from DOV's ``boormethode``
// vocabulary documented in the project's ``reference_dov_codelists``
// memory. The colour scheme is purely categorical — it doesn't carry
// geological meaning, only "different methods are easy to tell apart".
//
// Matching is case-insensitive and prefix-tolerant: DOV mixes Dutch
// spellings ("kerboor" vs "kernboring") which represent the same
// physical method. The lookup normalises both to the same colour.

export interface DrillMethodStyle {
  /** SVG / CSS fill for the segment rectangle. */
  fill: string
  /** Short English label for the legend; raw DOV token shown alongside. */
  label: string
}

/** Lookup table — keys are lowercased DOV tokens. */
const DRILL_METHOD_COLORS: Record<string, DrillMethodStyle> = {
  spade: { fill: '#d4a373', label: 'spade' },
  edelmanboring: { fill: '#a0522d', label: 'Edelman hand auger' },
  edelmanboor: { fill: '#a0522d', label: 'Edelman hand auger' },
  avegaarboring: { fill: '#cd853f', label: 'flight auger' },
  avegaarboor: { fill: '#cd853f', label: 'flight auger' },
  spoelboring: { fill: '#4682b4', label: 'wash boring' },
  spoelboor: { fill: '#4682b4', label: 'wash boring' },
  pulsboring: { fill: '#8b4789', label: 'percussion auger' },
  pulsboor: { fill: '#8b4789', label: 'percussion auger' },
  kernboring: { fill: '#8b1a1a', label: 'rotary core' },
  kerboor: { fill: '#8b1a1a', label: 'rotary core' },
  'meerdere technieken': { fill: '#888888', label: 'mixed methods' },
  onbekend: { fill: '#cccccc', label: 'unknown' },
}

const FALLBACK: DrillMethodStyle = { fill: '#bbbbbb', label: 'unknown method' }

/**
 * Resolve a DOV drill-method token to its render style.
 *
 * Returns FALLBACK for empty/null tokens or for tokens not in the lookup
 * — the segment is still rendered (in neutral grey), it just isn't
 * colour-coded. Surfacing the missing token in the legend tells us when
 * a new entry is needed.
 */
export function drillMethodStyle(method: string | null | undefined): DrillMethodStyle {
  if (!method) return FALLBACK
  const key = method.trim().toLowerCase()
  return DRILL_METHOD_COLORS[key] ?? FALLBACK
}
