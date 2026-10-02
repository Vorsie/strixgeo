// Presentation labels for the Parameters body tree — pure, no scope/band
// dependency, so the tree module (``parameterBodyTree.ts``) stays under the
// 500-line god-component cap (debt #201). The tree owns the STRUCTURE and the
// band authority; this file owns how a unit / body / class row READS.
//
// Translate-at-presentation-boundary: a litho unit's stored name is the raw DOV
// token ("ZAND (SL:M)"); rows read ``formationUnitDisplayName`` ("ZAND | matig
// siltig") and the raw token rides the row's tooltip (owner finding
// 2026-10-02). A body the roster does not know yet reads a LOADING word, never
// an id prefix (owner finding 2026-10-02: "a84343518…" showed for a moment).

import type { GeologicalFormationResponse } from '../../../api/client'
import { formationUnitDisplayName } from '../../../utils/formationUnitDisplayName'
import { geotechBodyAutoLabel, nadSoilPackingLabel } from '../../../utils/geotechBodyLabel'
import { bodyLabelLoading, type BodyRosterEntry } from './parameterUnitBodies'

/** The middot between a unit name and a body ordinal ("ZAND · #4"). */
const BODY_SEP = ' · '

/**
 * A litho unit's display name, looked up by id.
 *
 * @param unitId  The litho formation id, or ``null``.
 * @param formations  The litho model's formation rows.
 * @returns  The translated unit name; ``'—'`` when the id is unknown.
 */
export function lithoUnitDisplayName(
  unitId: string | null | undefined,
  formations: readonly GeologicalFormationResponse[],
): string {
  if (unitId == null) return '—'
  const formation = formations.find(f => f.id === unitId)
  return formation === undefined ? '—' : formationUnitDisplayName(formation)
}

/**
 * A litho body's label: its name, else ``"<HOME unit name> · #<ordinal>"``
 * (rendered "ZAND · #4").
 *
 * Owner finding 2026-10-02: a body is named after its OWN home formation (the
 * roster's ``formation_id``), under whichever tree row it sits. A cross-family
 * weld body homed on ZAND that also shows under the ZAND (SL:M) row reads
 * "ZAND · #4" in both places, never "ZAND (SL:M) · #4". The ordinal is the
 * stored ``body_ordinal`` as is (ruling A(a): "#12" stays "#12").
 *
 * @param bodyId  The resolver body id.
 * @param rowUnitName  The display name of the row the body sits under — the
 *     fallback when the home formation is not in ``formations``.
 * @param roster  The litho body roster (``id → entry``), possibly incomplete.
 * @param formations  The litho formation rows for the home lookup; omitted, the
 *     row's unit name stands in.
 * @returns  A non-empty label; ``"<unit> · Loading…"`` while the roster does
 *     not know the body.
 */
export function lithoBodyLabel(
  bodyId: string,
  rowUnitName: string,
  roster: ReadonlyMap<string, BodyRosterEntry>,
  formations?: readonly GeologicalFormationResponse[],
): string {
  const entry = roster.get(bodyId)
  const name = entry?.name?.trim()
  if (name) return name
  if (entry === undefined) return rowUnitName + BODY_SEP + bodyLabelLoading()
  const home =
    entry.formation_id != null && formations !== undefined
      ? formations.find(f => f.id === entry.formation_id)
      : undefined
  const unitName = home !== undefined ? formationUnitDisplayName(home) : rowUnitName
  return `${unitName}${BODY_SEP}#${entry.body_ordinal}`
}

/**
 * A geotech body's label: its name, else the UNIFIED auto label ``"<soil> ·
 * <packing> #<ordinal>"`` (rendered "SILT · SF #0").
 *
 * Owner dogfeed 2026-09-01: the packing-only "SF #0" read like a litho body's
 * "SILT · #0" and confused which was which. The auto form now carries the soil
 * word too (``geotechBodyAutoLabel``, the ONE shared vocabulary), so every
 * surface — this scope header, the Parameters pane rows and the section body-menu
 * header — reads the geotech body identically and never collides with the litho
 * body label.
 *
 * @param bodyId  The resolver body id.
 * @param nadClass  The class the body's ground carries (for the abbreviation).
 * @param roster  The geotech body roster (``id → entry``), possibly incomplete.
 * @returns  A non-empty label; ``"<soil> · <packing> · Loading…"`` while the
 *     roster does not know the body.
 */
export function geotechBodyLabel(
  bodyId: string,
  nadClass: number,
  roster: ReadonlyMap<string, BodyRosterEntry>,
): string {
  const entry = roster.get(bodyId)
  const name = entry?.name?.trim()
  if (name) return name
  if (entry !== undefined) return geotechBodyAutoLabel(nadClass, entry.body_ordinal)
  return nadSoilPackingLabel(nadClass) + BODY_SEP + bodyLabelLoading()
}
