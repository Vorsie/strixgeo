import type { ReactElement } from 'react'
import { AlertTriangle } from 'lucide-react'

import type { BoreholeDetailResponse } from '../../../api/client'
import { drillMethodStyle } from '../../../utils/drillMethodColors'
import { soilStyle } from '../../../utils/soilColors'
import { SoilPatterns, getSoilFillUrl } from '../../../utils/soilPatterns'
import { LITHOLOGY_TYPES, STRATIGRAPHY_TYPES } from '../constants'
import { LAB_TEST_ICONS } from '../labTestIcons'
import { useT } from '../../../i18n/translate'
import { LegendChip } from './LegendChip'
import { LegendSection } from './LegendSection'

/**
 * Bottom-of-canvas legend.
 *
 * Sections render only when the borehole actually has rows in that
 * category — so a stratigraphy-only borehole doesn't get an empty
 * "Lithology codes" panel, and a borehole with no samples drops the
 * lab-test row entirely. Sections enumerated:
 *
 *   1. Lithology codes used in any lithology track (main + admix).
 *   2. Stratigraphy formation codes (description prefix → full label).
 *   3. Drill methods used in any drill segment.
 *   4. Lab-test family glyphs present in any sample.
 *
 * Also surfaces an inline amber warning when the borehole has no
 * surface elevation set — the borelog still renders without the
 * absolute-level axis, but the user should know they're missing it.
 */
export function Legend({
  borehole,
}: {
  borehole: BoreholeDetailResponse
}): ReactElement {
  const t = useT()
  const soilCodes = new Set<string>()
  for (const obs of borehole.observations) {
    if (!LITHOLOGY_TYPES.has(obs.observation_type)) continue
    for (const layer of obs.layers) {
      layer.main_soil_codes.forEach(c => soilCodes.add(c))
      layer.admixtures.forEach(a => soilCodes.add(a.soil_code))
    }
  }

  const stratEntries = new Map<string, string>()
  for (const obs of borehole.observations) {
    if (!STRATIGRAPHY_TYPES.has(obs.observation_type)) continue
    for (const layer of obs.layers) {
      if (layer.description) {
        const code = layer.description.split(/[\s-]/)[0] || layer.description
        stratEntries.set(code, layer.description)
      }
    }
  }

  const drillMethods = new Set<string>()
  for (const seg of borehole.drill_segments) {
    if (seg.method) drillMethods.add(seg.method)
  }

  const testIcons = LAB_TEST_ICONS.filter(icon =>
    borehole.samples.some(s => icon.hasOn(s)),
  )

  const sectionsPresent =
    soilCodes.size > 0 || stratEntries.size > 0 || drillMethods.size > 0 || testIcons.length > 0

  if (!sectionsPresent) {
    return <div />
  }

  return (
    <div className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-4 py-2 text-[11px] flex flex-wrap gap-x-6 gap-y-2 shrink-0">
      {soilCodes.size > 0 && (
        <LegendSection title={t('borelog.lithologyCodes')}>
          {[...soilCodes].sort().map(code => {
            const style = soilStyle(code)
            return (
              <LegendChip
                key={code}
                code={code}
                label={style.label}
                preview={
                  <svg width={14} height={14}>
                    <defs>
                      <SoilPatterns />
                    </defs>
                    <rect
                      x={0}
                      y={0}
                      width={14}
                      height={14}
                      fill={getSoilFillUrl(code)}
                      stroke="#9ca3af"
                      strokeWidth={0.4}
                    />
                  </svg>
                }
              />
            )
          })}
        </LegendSection>
      )}

      {stratEntries.size > 0 && (
        <LegendSection title={t('borelog.stratigraphy')}>
          {[...stratEntries.entries()].map(([code, desc]) => (
            <LegendChip key={code} code={code} label={desc} />
          ))}
        </LegendSection>
      )}

      {drillMethods.size > 0 && (
        <LegendSection title={t('borelog.drillMethod')}>
          {[...drillMethods].sort().map(m => {
            const s = drillMethodStyle(m)
            return (
              <LegendChip
                key={m}
                code={m}
                label={s.label}
                preview={
                  <span
                    className="inline-block w-3.5 h-3.5 border border-gray-300 dark:border-slate-500 rounded-sm"
                    style={{ backgroundColor: s.fill }}
                  />
                }
              />
            )
          })}
        </LegendSection>
      )}

      {testIcons.length > 0 && (
        <LegendSection title={t('borelog.labTests')}>
          {testIcons.map(icon => (
            <span
              key={icon.label}
              className="flex items-center gap-1.5 text-gray-700 dark:text-slate-200"
            >
              <span className="text-base leading-none" style={{ color: icon.color }}>
                {icon.symbol}
              </span>
              <span>{icon.label}</span>
            </span>
          ))}
          <span className="text-[10px] text-gray-400 dark:text-slate-500 italic ml-2">
            {t('borelog.clickSampleToView')}
          </span>
        </LegendSection>
      )}

      {borehole.elevation_m == null && (
        <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <AlertTriangle size={11} />
          <span>{t('borelog.noSurfaceElevation')}</span>
        </div>
      )}
    </div>
  )
}
