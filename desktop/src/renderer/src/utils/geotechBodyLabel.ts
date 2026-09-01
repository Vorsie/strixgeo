// The ONE geotech-body auto-label vocabulary — soil + packing + ordinal.
//
// Owner dogfeed 2026-09-01, verbatim: "the stats jump lands on 'SF #0' while the
// pane says 'SILT · #0' — different bodies, same-looking ordinals … very
// confusing". A geotech body used to read "SF #0" (packing only) in the jump /
// scope header and got mistaken for a litho body's "SILT · #0". It now reads
// "SILT · SF #0" — the soil word AND the packing — so it is unambiguous and,
// because every surface (Parameters pane rows, scope header, section body-menu
// header, Geotech-units pane) calls this one helper, it reads identically
// everywhere.
//
// Language: the SOIL word follows the interface language (NL translates it —
// "ZAND"), the packing token stays English (owner ruling 19, CLAUDE.local.md —
// "ZAND·MD stands"). Both come straight from ``nadCompactLabel``, so this file
// adds only the spacing + ordinal, never a second vocabulary.

import type { Language } from '../i18n/i18n_constants'
import { nadCompactLabel } from './nadClasses'

/**
 * The spaced soil+packing abbreviation of a NAD class — "SILT · SF" (NL "ZAND ·
 * MD").
 *
 * ``nadCompactLabel`` returns the middot-joined ``NAD_CLASS_ABBR`` form
 * ("SILT·SF"); this re-spaces it to " · " so it reads as a label rather than a
 * code. An out-of-range class has no middot ("NAD 99") and passes through
 * unchanged.
 *
 * Parameters
 * ----------
 * nadClass
 *     A NAD class (1..31).
 * language
 *     The locale to render the soil word in; defaults to the active language.
 *
 * Returns
 * -------
 * str
 *     The spaced abbreviation, e.g. ``"SILT · SF"``.
 */
export function nadSoilPackingLabel(nadClass: number, language?: Language): string {
  return nadCompactLabel(nadClass, language).split('·').join(' · ')
}

/**
 * A geotech body's AUTO label — soil + packing + ordinal, "SILT · SF #0".
 *
 * The auto form a body reads when the engineer has not named it. The ordinal is
 * the body's own (0-based, the way the 3-D legend numbers bodies).
 *
 * Parameters
 * ----------
 * nadClass
 *     The NAD class the body's ground carries.
 * bodyOrdinal
 *     The body's ordinal within its formation's naming group (0-based).
 * language
 *     The locale to render the soil word in; defaults to the active language.
 *
 * Returns
 * -------
 * str
 *     ``"SILT · SF #0"``.
 */
export function geotechBodyAutoLabel(
  nadClass: number,
  bodyOrdinal: number,
  language?: Language,
): string {
  return `${nadSoilPackingLabel(nadClass, language)} #${bodyOrdinal}`
}
