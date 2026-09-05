// The "NAD characteristic values" block — a per-body read of the NAD table,
// shown SEPARATELY from the per-unit statistics (owner ruling 2026-09-05):
// *"add to unit statistics that NAD values phi'-c'-cu and dry and wet density
// are also available … We will be adding NAD values though but maybe separate
// it from the per unit statistics."*
//
// It is a TABLE READ, never a derivation: five values with units, a dash where
// the table carries one (no cu for a granular class), a provenance line naming
// the norm, and the standing caveat that these are characterisation values, not
// design values (the CLAUDE.md scope boundary — φ′/c′/cu that feed a design
// check stay Phase 5; here they are read verbatim from the published table).
//
// Renders NOTHING when the scope has no single NAD class or no transcribed row
// — a litho unit, an unclassified body, or a class with no table row.

import { useT } from '../../../i18n/translate'
import { nadClassName } from '../../../utils/nadClasses'
import type { NadCharacteristicValues } from '../../../api/clients/geology.types'

interface Props {
  /** The unit's single NAD packing class, or null (litho / mixed / unclassified). */
  nadClass: number | null
  /** The class's characteristic values, or null when there is no table row. */
  parameters: NadCharacteristicValues | null
}

/** Symbol + unit are universal notation (like axis symbols), so they are not
 *  translated — only the descriptive name and the block chrome are. */
const KN_M3 = 'kN/m³'
const KPA = 'kPa'
const DEG = '°'

/**
 * The NAD characteristic-values block for the scoped unit.
 *
 * @param props - the resolved NAD class + its characteristic values.
 * @returns the block, or ``null`` when there is nothing to show.
 */
export default function UnitNadParameters({ nadClass, parameters }: Props): JSX.Element | null {
  const t = useT()
  // Nothing to show without a single class AND a transcribed row.
  if (nadClass === null || parameters === null) return null

  const rows: ReadonlyArray<{
    key: string
    symbol: string
    name: string
    value: string
  }> = [
    {
      key: 'gamma-dry',
      // Subscripted like gINT / D-Series parameter tables so the two γ rows are
      // distinct in the symbol column without reading the name (ux-reviewer
      // 2026-09-05). Universal notation, not translated.
      symbol: 'γd',
      name: t('params.nadDryUnitWeight'),
      value: `${parameters.gamma_unsat_kn_m3} ${KN_M3}`,
    },
    {
      key: 'gamma-wet',
      symbol: 'γsat',
      name: t('params.nadWetUnitWeight'),
      value: `${parameters.gamma_sat_kn_m3} ${KN_M3}`,
    },
    {
      key: 'phi',
      symbol: 'φ′',
      name: t('params.nadFrictionAngle'),
      value: `${parameters.phi_deg}${DEG}`,
    },
    {
      key: 'c',
      symbol: 'c′',
      name: t('params.nadCohesion'),
      value: `${parameters.c_kpa} ${KPA}`,
    },
    {
      key: 'cu',
      symbol: 'cᵤ',
      name: t('params.nadUndrainedShear'),
      // The table carries a dash for a granular class — show it, never 0 kPa.
      value: parameters.cu_kpa === null ? '—' : `${parameters.cu_kpa} ${KPA}`,
    },
  ]

  return (
    <section
      data-testid="unit-nad-parameters"
      className="mx-3 mb-4 mt-2 rounded border border-border-subtle bg-surface-card"
    >
      <h3 className="border-b border-border-subtle px-3 py-2 text-xs font-semibold text-text-primary">
        {t('params.nadValuesTitle')}
      </h3>
      <dl className="divide-y divide-border-subtle">
        {rows.map(row => (
          <div key={row.key} className="flex items-baseline gap-2 px-3 py-1.5">
            <dt className="w-8 shrink-0 tabular-nums text-xs font-medium text-text-primary">
              {row.symbol}
            </dt>
            <dd className="min-w-0 flex-1 truncate text-xs text-text-secondary">{row.name}</dd>
            <dd
              data-testid={`nad-param-${row.key}`}
              className="shrink-0 tabular-nums text-xs text-text-primary"
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {/* text-text-secondary, not text-text-muted: the muted token fails WCAG
          2.2 AA contrast at this size in both themes (index.css:173 documents
          the dark hex failing 4.5:1), and this is the liability-bearing caveat —
          it must be legible (ux-reviewer 2026-09-05). */}
      <div className="border-t border-border-subtle px-3 py-2">
        <p data-testid="nad-param-provenance" className="text-[10px] text-text-secondary">
          {t('params.nadProvenance', { n: nadClass, name: nadClassName(nadClass) })}
        </p>
        <p data-testid="nad-param-caveat" className="mt-1 text-[10px] italic text-text-secondary">
          {t('params.nadCaveat')}
        </p>
      </div>
    </section>
  )
}
