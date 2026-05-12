/**
 * Deterministic hash-based colour generation.
 *
 * Used when we need a stable colour for an arbitrary string token —
 * formation names, drill methods, observation kinds — without
 * shipping a curated palette per token. The same string always
 * produces the same colour across reloads + machines.
 *
 * Two flavours:
 *
 *   * ``hashHslColor`` — returns ``hsl(h, 55%, 50%)``. Wider colour
 *     space, browser-native, but unsuitable for inputs that demand
 *     a hex value (HTML5 ``<input type="color">`` only accepts
 *     ``#rrggbb``).
 *   * ``hashHexColor`` — returns ``#rrggbb``. Hex-safe for backends
 *     that store colour as a short string + for ``<input
 *     type="color">``. Produces the same hue as ``hashHslColor``
 *     so the visual identity is preserved.
 *
 * The hash itself is DJB2 — fast, stable, no collisions to worry
 * about at the cardinality of tokens we'll see in a project
 * (dozens, not thousands).
 */

function djb2Hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
  }
  return Math.abs(h)
}

/** Stable HSL colour for an arbitrary string token. */
export function hashHslColor(s: string): string {
  const hue = djb2Hash(s) % 360
  return `hsl(${hue}, 55%, 50%)`
}

/** Stable hex colour for an arbitrary string token. Same hue as
 * ``hashHslColor`` so a value rendered in one form looks identical
 * when rendered in the other. */
export function hashHexColor(s: string): string {
  const hue = djb2Hash(s) % 360
  return hslToHex(hue, 55, 50)
}

/** Convert an HSL triple (h ∈ [0, 360), s + l ∈ [0, 100]) to a
 * 6-digit ``#rrggbb`` hex string. Standard formula. */
function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lit = l / 100
  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lit - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const toByte = (v: number): string => {
    const n = Math.round((v + m) * 255)
    return n.toString(16).padStart(2, '0')
  }
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}
