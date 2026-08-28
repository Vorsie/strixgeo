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
 *                    repeat of its family's soil word. A class from another
 *                    soil family names itself in full — see ``classRowLabel``.
 *   • BODY         — the individual built solid, so one body can be isolated.
 *
 * This module is PURE (no React, no Cesium, no I/O): formations + solids in,
 * tree out. The presentation lives in ``GeotechLayersTree``.
 *
 * WHAT EXISTS: only what the scene paints gets a row. Owner ruling 2026-08-26,
 * looking at the shipped legend: "why are there suboptions like this ... not yet
 * classified?" A row whose eye cannot change anything on screen is noise, and
 * worse, it reads as a model the engineer failed to build rather than as nothing
 * at all. So a class row renders only when the CURRENT VIEW MODE paints
 * something for it:
 *
 *   • SOLID mode — the class has at least one built body solid with geometry.
 *   • FENCE mode — one of the class's units has a wall panel. Fence walls are
 *     computed from the geotech layers + accepted ties with no Build involved,
 *     so a band legitimately exists there with zero solids; and the solid render
 *     is skipped entirely in fence mode, so a built body with no wall paints
 *     nothing and gets no row.
 *
 * The mode is read off ``fencePanels``: undefined = solid mode, an array = fence
 * mode (the same signal ``Geology3DViewer`` itself uses). Families follow their
 * classes — a family with no surviving class is not a row.
 *
 * Consequence, accepted: the tree changes shape when the engineer flips view
 * mode. That is the point — each mode describes what that mode draws.
 *
 * Translate-at-the-presentation-boundary: the soil code stays the raw DOV token
 * in the domain; ``formatLithoDisplayName`` / ``nadPackingLabel`` are the
 * lookup that turns it into English here.
 */

import type { AdmixtureItem } from '../api/client'
import { geotechRowColorOverride } from './geotechRowColorOverride'
import { formatLithoDisplayName, lithoDisplayName } from './lithoLabels'
import {
  NAD_SOIL_FAMILY_ORDER,
  nadClassColor,
  nadClassName,
  nadClassQualifier,
  nadPackingLabel,
  nadSoilFamilyName,
} from './nadClasses'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Label for a geotech unit that carries no NAD class yet — the borehole-only
 * "(geotech)" skeletons. Such a unit gets a row on exactly the same terms as
 * any other: when the scene paints it. It is real ground, so once it is built
 * the row is the prompt to go and classify it; with nothing built it is an
 * empty bin and is dropped like any other (see the module note on existence).
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
  /** The colour the engineer picked for this unit; null when nobody has. */
  color_override?: string | null
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

/**
 * The fence-panel fields the legend tree reads.
 *
 * ``formationId`` is camelCase, unlike the solid's ``formation_id``: fence walls
 * are built in the renderer (``buildFencePanels``) and never went through the
 * snake_case API boundary. Keeping each source's own spelling means the caller
 * passes its arrays straight through with no remapping to get wrong.
 */
export interface GeotechLegendPanelInput {
  formationId: string
  /** Only the LENGTH matters: an empty wall is one the viewer never paints. */
  triangles?: readonly unknown[]
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
  /**
   * Density / firmness only, so the row never repeats its family's soil word —
   * except for a class from a DIFFERENT soil family, which states its own full
   * name so the composed line stays a NAD class that exists (``classRowLabel``).
   */
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

/**
 * DISPLAY family label for a unit: its soil code, else its class's soil word,
 * in the active interface language.
 *
 * The parallel ``familyLabelEnOf`` returns the English form — the STABLE key the
 * sort and the class-row comparison run on. The two must never be conflated: the
 * label the user reads follows the language toggle, but the grouping order and
 * "is this class a stranger to this family" test must not move with it.
 */
function familyLabelOf(f: GeotechLegendFormationInput): string {
  if (f.litho_main_soil_code != null && f.litho_main_soil_code !== '') {
    return lithoDisplayName(f.litho_main_soil_code, [])
  }
  return nadSoilFamilyName(f.nad_class) || UNKNOWN_FAMILY_LABEL
}

/** English (language-stable) family label — the sort + comparison key. */
function familyLabelEnOf(f: GeotechLegendFormationInput): string {
  if (f.litho_main_soil_code != null && f.litho_main_soil_code !== '') {
    return formatLithoDisplayName(f.litho_main_soil_code, [])
  }
  return nadSoilFamilyName(f.nad_class, 'en') || UNKNOWN_FAMILY_LABEL
}

/** The unit's own display name — soil + admixtures, in the active language. */
function unitLabelOf(f: GeotechLegendFormationInput): string {
  if (f.litho_main_soil_code != null && f.litho_main_soil_code !== '') {
    return lithoDisplayName(f.litho_main_soil_code, f.litho_admixtures ?? [])
  }
  return f.name
}

/**
 * The class row's text under a given family header.
 *
 * The tree reads as a sentence — the family row names the soil, the class row
 * names the packing — so the bare qualifier ("medium dense") is only honest
 * while the class belongs to the family it sits under. The two can disagree:
 * the family word comes from the unit's LITHO soil code and the qualifier from
 * its NAD class, and ``SubdivideAllBodies`` assigns a borehole-only sub-body
 * "the nearest CPT of ANY lithology" when no same-lithology cone reaches that
 * depth. A ZAND unit carrying NAD 14 then composed into "SAND ▸ moderately
 * firm" — a class the NAD table does not contain, because granular soils are
 * described by packing density and cohesive soils by firmness, never the other
 * way round (owner ruling 2026-08-26: "moderately firm sand just does not
 * exist").
 *
 * A stranger therefore states its OWN full class name instead. It keeps its
 * place under the litho body it subdivides — that grouping is what the tree is
 * for, and hiding the mismatch would hide the ground the viewer paints — but
 * the line the user reads is always a NAD class that exists.
 *
 * ``familyLabelEn`` is the ENGLISH family word (the stable key): the
 * belongs-to-this-family test compares English-to-English so it can never be
 * broken by the interface language, while the text returned (packing phrase or
 * full class name) follows the active language for display.
 */
function classRowLabel(nadClass: number, familyLabelEn: string): string {
  return nadSoilFamilyName(nadClass, 'en') === familyLabelEn
    ? nadPackingLabel(nadClass)
    : nadClassName(nadClass)
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
 * built is not listed at all — see the module note on existence. In fence mode
 * a listed class can still carry a zero count, because its walls are what the
 * scene paints there.
 *
 * Parameters
 * ----------
 * formations
 *     The geotech units of the viewed model (classified AND skeletons).
 * bodySolids
 *     The model's built body solids. Solids with an empty ``triangles`` mesh
 *     are skipped — the viewer paints nothing for them.
 * fencePanels
 *     The fence walls when the viewer is in FENCE mode; ``undefined`` in solid
 *     mode. This doubles as the mode signal, matching ``Geology3DViewer``.
 *
 * Returns
 * -------
 * GeotechLegendFamilyNode[]
 *     Families in NAD soil order (GRAVEL → PEAT, strangers last), classes
 *     ascending with the unclassified row last, bodies ascending by ordinal.
 *     Only families and classes the current mode paints are present.
 */
export function buildGeotechLegendTree(
  formations: readonly GeotechLegendFormationInput[],
  bodySolids: readonly GeotechLegendSolidInput[],
  fencePanels?: readonly GeotechLegendPanelInput[],
): GeotechLegendFamilyNode[] {
  // Formation ids the fence diagram draws a wall for. Only consulted in fence
  // mode; in solid mode the walls are not rendered, so they cannot make a row
  // exist.
  const walledFormationIds = new Set<string>()
  if (fencePanels !== undefined) {
    for (const p of fencePanels) {
      if ((p.triangles?.length ?? 0) === 0) continue
      walledFormationIds.add(p.formationId)
    }
  }

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
    /** English family word — the language-stable sort + class-comparison key. */
    labelEn: string
    classes: Map<string, { nadClass: number | null; units: GeotechLegendFormationInput[] }>
  }
  const families = new Map<string, FamilyBucket>()

  for (const f of formations) {
    const familyKey = f.litho_main_soil_code ?? ''
    let family = families.get(familyKey)
    if (!family) {
      family = {
        key: familyKey,
        label: familyLabelOf(f),
        labelEn: familyLabelEnOf(f),
        classes: new Map(),
      }
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
        // The pick has to win in the legend too (owner ruling 2026-08-26) or
        // the swatch stops identifying the body it stands for. Shared with the
        // units pane so the two cannot disagree about the same class.
        const color = geotechRowColorOverride(units) ?? nadClassColor(nadClass)
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
          label:
            nadClass === null
              ? nadClassQualifier(null)
              : classRowLabel(nadClass, family.labelEn),
          color,
          bodyCount: bodies.length,
          formationIds: units.map(u => u.id),
          bodies,
        }
      })
      // Only what this mode paints gets a row (module note). Fence mode asks the
      // walls; solid mode asks the bodies. Dropping the row here rather than in
      // the component keeps the counts, the family swatch and the family's
      // formationIds — which the family eye toggles — describing what is left.
      .filter(c =>
        fencePanels === undefined
          ? c.bodyCount > 0
          : c.formationIds.some(id => walledFormationIds.has(id)),
      )

    // A family whose every class was dropped paints nothing either.
    if (classNodes.length === 0) continue

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

  // Rank by the ENGLISH family word (NAD_SOIL_FAMILY_ORDER is English), never by
  // the display label — otherwise a Dutch UI would sort families alphabetically
  // ("KLEI/GRIND/…") instead of in the norm's geological order (GRAVEL→PEAT).
  const labelEnByKey = new Map<string, string>()
  for (const family of families.values()) labelEnByKey.set(family.key, family.labelEn)
  const rankOf = (node: GeotechLegendFamilyNode): number => {
    const i = NAD_SOIL_FAMILY_ORDER.indexOf(labelEnByKey.get(node.key) ?? node.label)
    return i === -1 ? UNKNOWN_FAMILY_RANK : i
  }
  const tieKey = (node: GeotechLegendFamilyNode): string => labelEnByKey.get(node.key) ?? node.label
  out.sort((a, b) => rankOf(a) - rankOf(b) || tieKey(a).localeCompare(tieKey(b)))

  return out
}
