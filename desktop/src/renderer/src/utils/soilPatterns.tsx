// SVG ``<pattern>`` defs for DOV soil tokens, used by ``BoreholeLog`` to fill
// observation-layer rectangles in the borelog canvas.
//
// Mirrors DOV's PDF report convention (international ENISO 14689 / DIN 18196):
//
// * sands       → tan base + dot grid (small dots = fine, larger = coarse)
// * clays       → blue-grey base + diagonal hatching
// * silts       → tan-grey base + horizontal dashes
// * loam        → brown base + mixed dot/dash
// * lime/chalk  → off-white base + plus signs
// * glauconite  → green base + V chevrons (DOV-distinctive)
// * sandstone   → brown base + brick + dots
// * stones      → dark grey base + brick
// * shells      → cream base + crescents
//
// Falls back to a solid neutral fill for unrecognised tokens — the borelog
// must always render something visible regardless of dictionary coverage.

import type { ReactElement } from 'react'

import { soilStyle } from './soilColors'

/**
 * SVG ``<defs>`` containing every soil-token pattern.
 *
 * Render once at the top of the borelog SVG; every layer rectangle then uses
 * ``fill={getSoilFillUrl(code)}`` to reference the appropriate pattern by id.
 *
 * Returning a fragment of ``<pattern>`` elements (not a wrapper) so the caller
 * can place them inside its own ``<defs>`` next to other defs (e.g. clip
 * paths) without nested defs.
 */
export function SoilPatterns(): ReactElement {
  return (
    <>
      {/* Fine sand: small dot grid on tan */}
      <pattern id="soil-FZ" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#f5e0a4" />
        <circle cx="1.5" cy="1.5" r="0.55" fill="#7a6234" />
        <circle cx="4.5" cy="4.5" r="0.55" fill="#7a6234" />
      </pattern>

      {/* Coarse sand: larger sparse dots on tan */}
      <pattern id="soil-ZG" width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="#f0c668" />
        <circle cx="2" cy="2" r="0.9" fill="#7a5a1a" />
        <circle cx="6.5" cy="6.5" r="0.9" fill="#7a5a1a" />
      </pattern>

      {/* Clay: 45° hatching on muted blue-grey */}
      <pattern
        id="soil-KL"
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" fill="#7d8da0" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="#2d3d50" strokeWidth="1" />
      </pattern>

      {/* Silt: horizontal dashes on tan-grey */}
      <pattern id="soil-SI" width="8" height="6" patternUnits="userSpaceOnUse">
        <rect width="8" height="6" fill="#c9b88d" />
        <line x1="1" y1="2" x2="4" y2="2" stroke="#5d4f30" strokeWidth="0.7" />
        <line x1="4" y1="5" x2="7" y2="5" stroke="#5d4f30" strokeWidth="0.7" />
      </pattern>

      {/* Loam: mixed dot + dash on brown */}
      <pattern id="soil-LE" width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="#a08868" />
        <circle cx="2" cy="2" r="0.6" fill="#3d2f1f" />
        <line x1="5" y1="6" x2="8" y2="6" stroke="#3d2f1f" strokeWidth="0.6" />
      </pattern>

      {/* Lime / chalk: plus signs on off-white */}
      <pattern id="soil-KA" width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill="#e8e6d8" />
        <line x1="3" y1="4.5" x2="6" y2="4.5" stroke="#8a8770" strokeWidth="0.7" />
        <line x1="4.5" y1="3" x2="4.5" y2="6" stroke="#8a8770" strokeWidth="0.7" />
      </pattern>

      {/* Glauconite: V chevrons on olive — DOV's distinctive marker */}
      <pattern id="soil-GL" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#6b8e23" />
        <path d="M0 6 L4 2 L8 6" stroke="#1f3000" strokeWidth="0.8" fill="none" />
      </pattern>

      {/* Sandstone: brick + dot on warm brown */}
      <pattern id="soil-ZS" width="12" height="9" patternUnits="userSpaceOnUse">
        <rect width="12" height="9" fill="#8b6f47" />
        <line x1="0" y1="4.5" x2="12" y2="4.5" stroke="#3a2e1c" strokeWidth="0.6" />
        <line x1="3" y1="0" x2="3" y2="4.5" stroke="#3a2e1c" strokeWidth="0.6" />
        <line x1="9" y1="4.5" x2="9" y2="9" stroke="#3a2e1c" strokeWidth="0.6" />
        <circle cx="6" cy="2" r="0.5" fill="#3a2e1c" />
      </pattern>

      {/* Stones (DOV "stenen", code ST): dense brick on dark slate.
          Originally registered under "XZ" — corrected after authoritative
          DOV codetable showed XZ = "zand" (generic sand), not stones. */}
      <pattern id="soil-ST" width="10" height="8" patternUnits="userSpaceOnUse">
        <rect width="10" height="8" fill="#5a5a5a" />
        <line x1="0" y1="4" x2="10" y2="4" stroke="#1a1a1a" strokeWidth="0.7" />
        <line x1="2" y1="0" x2="2" y2="4" stroke="#1a1a1a" strokeWidth="0.7" />
        <line x1="7" y1="4" x2="7" y2="8" stroke="#1a1a1a" strokeWidth="0.7" />
      </pattern>

      {/* Sand (no grain-size qualifier): same dot pattern as fine sand but
          slightly larger spacing so it reads "generic sand" not "fine". */}
      <pattern id="soil-XZ" width="7" height="7" patternUnits="userSpaceOnUse">
        <rect width="7" height="7" fill="#f5e0a4" />
        <circle cx="1.8" cy="1.8" r="0.6" fill="#7a6234" />
        <circle cx="5.2" cy="5.2" r="0.6" fill="#7a6234" />
      </pattern>

      {/* Peat: dark brown with fibre dashes (organic matter) */}
      <pattern id="soil-VE" width="10" height="6" patternUnits="userSpaceOnUse">
        <rect width="10" height="6" fill="#3d2a18" />
        <line x1="0" y1="2" x2="3" y2="2" stroke="#8b6743" strokeWidth="0.7" />
        <line x1="5" y1="4" x2="8" y2="4" stroke="#8b6743" strokeWidth="0.7" />
      </pattern>

      {/* Stone fragments (SN): dark base with chunky scattered shapes */}
      <pattern id="soil-SN" width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="#6e5a4a" />
        <polygon points="2,2 4,1 5,3 3,4" fill="#3a2c1f" />
        <polygon points="7,6 9,5 8,8 6,7" fill="#3a2c1f" />
      </pattern>

      {/* Shell fragments: small crescents on cream */}
      <pattern id="soil-NN" width="9" height="6" patternUnits="userSpaceOnUse">
        <rect width="9" height="6" fill="#e6dfc8" />
        <path
          d="M1 3 a 2 2 0 0 0 3 0"
          stroke="#7a6e4a"
          strokeWidth="0.5"
          fill="none"
        />
        <path
          d="M5 4 a 2 2 0 0 0 3 0"
          stroke="#7a6e4a"
          strokeWidth="0.5"
          fill="none"
        />
      </pattern>
    </>
  )
}

/**
 * Resolve a DOV soil-token to a `fill="..."` URL for SVG rectangles.
 *
 * Returns a `url(#soil-XXX)` reference when a pattern exists, falling back
 * to the solid colour from `soilStyle()` for unrecognised tokens. Callers
 * can rely on this never returning ``null`` — every layer always has a fill.
 */
export function getSoilFillUrl(code: string | null | undefined): string {
  if (!code) return soilStyle(code).fill
  // The pattern id convention is ``soil-${code}``. Tokens that don't have
  // a registered pattern (above) fall through to the solid colour, so the
  // layer is at least filled with the base hue.
  if (KNOWN_PATTERN_CODES.has(code)) {
    return `url(#soil-${code})`
  }
  return soilStyle(code).fill
}

const KNOWN_PATTERN_CODES = new Set([
  'FZ', 'ZG', 'KL', 'SI', 'LE', 'KA', 'GL', 'ZS', 'XZ', 'NN',
  'ST', 'VE', 'SN',
])
