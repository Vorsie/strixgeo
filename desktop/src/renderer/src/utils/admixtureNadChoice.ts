/**
 * Which litho units the geotech admixture prompt must ask about, and how the
 * answer is scoped (owner ruling 2026-09-04).
 *
 * *"we can keep the admixture mix, but then we need to prompt user in geotech
 * stage on subdivide. Hey we see you have an admixture here, which NAD classes
 * do you want, pure sand or sand with admixture."*
 *
 * A litho unit is *admixture-ambiguous* when the NAD table can classify it BOTH
 * as a pure class AND as a with-admixture ((f)/(s)) class — i.e. its main soil
 * has a distinct secondary NAD column AND it carries the admixture that fork it.
 * This is the presentation-side mirror of the backend detection in
 * ``domain/services/nad_admixture_choice.py``; the code sets below are ported
 * VERBATIM from ``domain/services/nad_classification_constants.py`` and MUST stay
 * in sync (a vitest pins the resulting pairs). The class thresholds themselves
 * are never duplicated here — only which admixture forks which soil.
 */

import type {
  AdmixtureItem,
  GeologicalFormationResponse,
  NadAdmixtureChoice,
} from '../api/clients/geology.types'

/**
 * Sand-admixture codes: any of these makes a FINES soil (silt/clay)
 * "zandhoudend". Ported from ``_SAND_ADMIXTURE_CODES``.
 */
const SAND_ADMIXTURE_CODES: ReadonlySet<string> = new Set(['XZ', 'ZN', 'Z', 'FZ', 'MZ', 'GZ'])

/**
 * Silt/clay-admixture codes: any of these makes a COARSE soil (sand/gravel)
 * "silt-/kleihoudend". Ported from ``_SILT_CLAY_ADMIXTURE_CODES`` (SL = silt per
 * the owner's 2026-07-26 slib ruling; LE = leem = silt geotech).
 */
const SILT_CLAY_ADMIXTURE_CODES: ReadonlySet<string> = new Set(['SI', 'KL', 'LE', 'SL'])

/**
 * Main soil → the admixture code set whose presence forks it into the secondary
 * NAD column. Coarse soils fork on silt/clay; fines fork on sand. Ported from
 * ``_SECONDARY_ADMIXTURE_CODES``. VEEN is intentionally ABSENT: its secondary
 * NAD column mirrors its clean one, so no fork exists and it is never prompted.
 */
const SECONDARY_ADMIXTURE_CODES: Readonly<Record<string, ReadonlySet<string>>> = {
  GRIND: SILT_CLAY_ADMIXTURE_CODES,
  ZAND: SILT_CLAY_ADMIXTURE_CODES,
  SILT: SAND_ADMIXTURE_CODES,
  KLEI: SAND_ADMIXTURE_CODES,
}

/**
 * Whether the pure-vs-with-admixture NAD choice is a real fork for this unit.
 *
 * True only when the soil has a distinct with-admixture NAD column (GRIND / ZAND
 * / SILT / KLEI — not VEEN, not an unknown soil) AND the unit carries at least
 * one admixture in that soil's forking set.
 *
 * @param soilCode - the unit's ``litho_main_soil_code``.
 * @param admixtures - the unit's admixtures (may be null/empty).
 * @returns true when the geotech prompt should ask this unit.
 */
export function unitAdmixtureIsAmbiguous(
  soilCode: string | null,
  admixtures: AdmixtureItem[] | null | undefined,
): boolean {
  if (soilCode === null) return false
  const codes = SECONDARY_ADMIXTURE_CODES[soilCode]
  if (codes === undefined) return false
  return (admixtures ?? []).some(a => codes.has(a.soil_code))
}

/** One admixture-ambiguous litho unit the prompt lists. */
export interface AdmixtureUnit {
  /** The litho formation id (the PATCH target). */
  formationId: string
  /** The unit's display name. */
  name: string
  /** The main soil token (ZAND / GRIND / SILT / KLEI) — the dialog translates it. */
  soilCode: string
  /** The stored answer, or null when unanswered. */
  choice: NadAdmixtureChoice | null
}

/**
 * The admixture-ambiguous litho units within the subdivide scope.
 *
 * ``scopeFormationIds`` is the set of formation ids the subdivide will actually
 * classify — the ``formation_id`` of the accepted litho layers in the model, so
 * this lists exactly the units the classifier will see. Ordered by name for a
 * stable dialog.
 *
 * @param formations - every project formation (from ``geoModel.formations``).
 * @param scopeFormationIds - formation ids in the subdivide scope.
 * @returns the ambiguous units, each with its stored choice (may be null).
 */
export function ambiguousAdmixtureUnits(
  formations: readonly GeologicalFormationResponse[],
  scopeFormationIds: ReadonlySet<string>,
): AdmixtureUnit[] {
  return formations
    .filter(
      f =>
        scopeFormationIds.has(f.id) &&
        f.litho_main_soil_code !== null &&
        unitAdmixtureIsAmbiguous(f.litho_main_soil_code, f.litho_admixtures),
    )
    .map(f => ({
      formationId: f.id,
      name: f.name,
      soilCode: f.litho_main_soil_code as string,
      choice: f.nad_admixture_choice ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Whether any admixture-ambiguous unit in scope is still unanswered.
 *
 * The gate for auto-opening the prompt: the build press asks only when there is
 * something to decide, so a fully-answered model builds straight through.
 *
 * @param units - the output of {@link ambiguousAdmixtureUnits}.
 * @returns true when at least one unit has no stored answer.
 */
export function hasUnansweredAdmixtureUnits(units: readonly AdmixtureUnit[]): boolean {
  return units.some(u => u.choice === null)
}
