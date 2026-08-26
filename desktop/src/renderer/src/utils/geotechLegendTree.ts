/**
 * Build the nested soil ▸ NAD class ▸ body tree the 3-D LAYERS legend renders.
 *
 * WHY a tree: a geotech model subdivides every litho unit into packing classes,
 * so the flat per-formation legend degenerates into dozens of rows whose text is
 * identical ("SAND", "SAND", "SAND", "CLAY", …) and whose only difference is a
 * near-adjacent shade of the NAD ramp — unreadable, and impossible to use as a
 * visibility control (owner ruling 2026-08-26, mockup
 * ``blend_viewer/geotech_ui_tidy_ideas.html``). Three levels fix it:
 *
 *   • SOIL family  — one row per main soil code; the eye hides the whole family.
 *   • NAD class    — the level the engineer works at; labelled by DENSITY /
 *                    FIRMNESS ("medium dense", "slightly firm"), never by a
 *                    repeat of the soil word.
 *   • BODY         — the individual built solid, so one body can be isolated.
 *
 * This module is PURE (no React, no Cesium, no I/O): formations + solids in,
 * tree out. The presentation lives in ``GeotechLayersTree``.
 *
 * Translate-at-the-presentation-boundary: the soil code stays the raw DOV token
 * in the domain; ``formatLithoDisplayName`` / ``nadPackingLabel`` are the
 * lookup that turns it into English here.
 */

import type { AdmixtureItem } from '../api/client'
import { formatLithoDisplayName } from './lithoLabels'
import {
  NAD_SOIL_FAMILY_ORDER,
  nadClassColor,
  nadPackingLabel,
  nadSoilFamilyName,
} from './nadClasses'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Label for a geotech unit that carries no NAD class yet — the borehole-only
 * "(geotech)" skeletons. They are shown, never hidden: they are real ground the
 * viewer paints, and the row is the prompt to go and classify it.
 */
export const UNCLASSIFIED_CLASS_LABEL = 'not yet classified'

/** Family-row label when the unit carries neither a soil code nor a class. */
const UNKNOWN_FAMILY_LABEL = 'Unclassified'

/** Sorts after every known family (``indexOf`` returns -1 for strangers). */
const UNKNOWN_FAMILY_RANK = Number.MAX_SAFE_INTEGER

// ---------------------------------------------------------------------------
// Input shapes — structural subsets of the API types, so the builder can be
// exercised without constructing a full GeologicalFormationResponse.
// ---------------------------------------------------------------------------

/** The formation fields the legend tree reads. */
export interface GeotechLegendFormationInput {
  id: string
  name: string
  color: string
  nad_class: number | null
  litho_main_soil_code: string | null
  litho_admixtures?: readonly AdmixtureItem[] | null
}

/** The body-solid fields the legend tree reads. */
export interface GeotechLegendSolidInput {
  body_id: string
  formation_id: string
  body_ordinal: number
  /** Only the LENGTH matters: an empty mesh is a body the viewer never paints. */
  triangles?: readonly unknown[]
  display_color?: string | null
  is_flagged?: boolean
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/** Leaf row: one built body solid. */
export interface GeotechLegendBodyNode {
  bodyId: string
  formationId: string
  /** ``"#3"``, or ``"SAND | slightly clayey #3"`` when the class row spans units. */
  label: string
  color: string
  isFlagged: boolean
}

/** Middle row: one NAD packing class within a soil family. */
export interface GeotechLegendClassNode {
  /** Stable React key + expansion-state key (``"ZAND:6"`` / ``"ZAND:none"``). */
  key: string
  nadClass: number | null
  /** Density / firmness only — never the soil word. */
  label: string
  color: string
  bodyCount: number
  /** Every formation under this class — what the row's eye toggles. */
  formationIds: string[]
  bodies: GeotechLegendBodyNode[]
}

/** Top row: one soil family. */
export interface GeotechLegendFamilyNode {
  /** Stable React key — the raw soil code (``""`` for the unknown bucket). */
  key: string
  label: string
  color: string
  bodyCount: number
  /** Every formation under this family — what the row's eye toggles. */
  formationIds: string[]
  classes: GeotechLegendClassNode[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** English family label for a unit: its soil code, else its class's soil word. */
function familyLabelOf(f: GeotechLegendFormationInput): string {
  if (f.litho_main_soil_code != null && f.litho_main_soil_code !== '') {
    return formatLithoDisplayName(f.litho_main_soil_code, [])
  }
  return nadSoilFamilyName(f.nad_class) || UNKNOWN_FAMILY_LABEL
}

/** The unit's own display name — soil + admixtures, the litho identity. */
function unitLabelOf(f: GeotechLegendFormationInput): string {
  if (f.litho_main_soil_code != null && f.litho_main_soil_code !== '') {
    return formatLithoDisplayName(f.litho_main_soil_code, f.litho_admixtures ?? [])
  }
  return f.name
}

/** Ascending class order with the unclassified row LAST (it is the remainder). */
function compareClassKeys(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Group geotech formations + their built body solids into the legend tree.
 *
 * Grouping keys: the raw soil code for the family, the NAD class (``null``
 * included) for the middle row. Two litho units subdivided to the same packing
 * class therefore share ONE class row — that merge is the whole point, and the
 * row carries both formation ids so its eye hides both.
 *
 * Counts are BODY counts (built solids), not unit counts, because the legend
 * controls what the 3-D scene paints. A class the model contains but has not
 * built yet keeps its row with a zero count — before Build, and in Fence mode,
 * there are no solids at all and the legend must still describe the model.
 *
 * Parameters
 * ----------
 * formations
 *     The geotech units of the viewed model (classified AND skeletons).
 * bodySolids
 *     The model's built body solids. Solids with an empty ``triangles`` mesh
 *     are skipped — the viewer paints nothing for them.
 *
 * Returns
 * -------
 * GeotechLegendFamilyNode[]
 *     Families in NAD soil order (GRAVEL → PEAT, strangers last), classes
 *     ascending with the unclassified row last, bodies ascending by ordinal.
 */
export function buildGeotechLegendTree(
  formations: readonly GeotechLegendFormationInput[],
  bodySolids: readonly GeotechLegendSolidInput[],
): GeotechLegendFamilyNode[] {
  // formation id → its built solids, ordinal-ascending.
  const solidsByFormation = new Map<string, GeotechLegendSolidInput[]>()
  for (const s of bodySolids) {
    if ((s.triangles?.length ?? 0) === 0) continue
    const arr = solidsByFormation.get(s.formation_id)
    if (arr) arr.push(s)
    else solidsByFormation.set(s.formation_id, [s])
  }
  for (const arr of solidsByFormation.values()) {
    arr.sort((a, b) => a.body_ordinal - b.body_ordinal || a.body_id.localeCompare(b.body_id))
  }

  // Two-level bucketing in one pass; insertion order preserves the caller's
  // formation order inside every bucket (display_order upstream).
  interface FamilyBucket {
    key: string
    label: string
    classes: Map<string, { nadClass: number | null; units: GeotechLegendFormationInput[] }>
  }
  const families = new Map<string, FamilyBucket>()

  for (const f of formations) {
    const familyKey = f.litho_main_soil_code ?? ''
    let family = families.get(familyKey)
    if (!family) {
      family = { key: familyKey, label: familyLabelOf(f), classes: new Map() }
      families.set(familyKey, family)
    }
    const classKey = `${familyKey}:${f.nad_class ?? 'none'}`
    const cls = family.classes.get(classKey)
    if (cls) cls.units.push(f)
    else family.classes.set(classKey, { nadClass: f.nad_class, units: [f] })
  }

  const out: GeotechLegendFamilyNode[] = []

  for (const family of families.values()) {
    const classNodes: GeotechLegendClassNode[] = [...family.classes.entries()]
      .sort(([, a], [, b]) => compareClassKeys(a.nadClass, b.nadClass))
      .map(([classKey, { nadClass, units }]) => {
        const color = nadClassColor(nadClass)
        // A class row shared by several units would otherwise show "#0" twice —
        // the same identical-text disease the tree exists to kill — so the body
        // label names its unit exactly when the row is ambiguous.
        const spansUnits = units.length > 1
        const bodies: GeotechLegendBodyNode[] = []
        for (const u of units) {
          const unitLabel = spansUnits ? `${unitLabelOf(u)} ` : ''
          for (const s of solidsByFormation.get(u.id) ?? []) {
            bodies.push({
              bodyId: s.body_id,
              formationId: u.id,
              label: `${unitLabel}#${s.body_ordinal}`,
              color: s.display_color ?? color,
              isFlagged: s.is_flagged === true,
            })
          }
        }
        return {
          key: classKey,
          nadClass,
          label: nadClass === null ? UNCLASSIFIED_CLASS_LABEL : nadPackingLabel(nadClass),
          color,
          bodyCount: bodies.length,
          formationIds: units.map(u => u.id),
          bodies,
        }
      })

    // The family swatch reads as ONE hue: inside a family the NAD palette is a
    // lightness ramp of a single hue, so the class carrying the most bodies —
    // the family's dominant packing — is the honest representative. Ties keep
    // the first (lowest) class, which is already the sort order.
    const dominant = classNodes.reduce<GeotechLegendClassNode | null>(
      (best, c) => (best === null || c.bodyCount > best.bodyCount ? c : best),
      null,
    )

    out.push({
      key: family.key,
      label: family.label,
      color: dominant?.color ?? nadClassColor(null),
      bodyCount: classNodes.reduce((n, c) => n + c.bodyCount, 0),
      formationIds: classNodes.flatMap(c => c.formationIds),
      classes: classNodes,
    })
  }

  const rankOf = (label: string): number => {
    const i = NAD_SOIL_FAMILY_ORDER.indexOf(label)
    return i === -1 ? UNKNOWN_FAMILY_RANK : i
  }
  out.sort((a, b) => rankOf(a.label) - rankOf(b.label) || a.label.localeCompare(b.label))

  return out
}
