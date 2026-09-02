// Fence-diagram cutout for the scoped unit (owner ruling R4, 2026-08-27,
// verbatim: "make a cutout of the fence diagram where only the selected unit
// and the base map are visible, as a visual aid what the user selected").
//
// This host stays Cesium-free: the scene lives in ``UnitFenceScene`` behind a
// ``React.lazy`` boundary, so the heavy chunk — and the fence's per-section
// edge fetches — load only while a unit is actually scoped (the canvas mounts
// this component only then).

import { Suspense, lazy } from 'react'

import { LoadingState } from '../../EmptyState'
import { useT } from '../../../i18n/translate'
import type { ParameterUnitScope } from '../../ShellContext'

const UnitFenceScene = lazy(() => import('./UnitFenceScene'))

interface Props {
  /** The unit whose walls the cutout shows. */
  scope: ParameterUnitScope
}

/**
 * The fence cutout panel — heading + lazily-loaded Cesium scene.
 *
 * Parameters
 * ----------
 * props : Props
 *     The typed unit scope.
 *
 * Returns
 * -------
 * JSX.Element
 *     A titled panel whose body is the scene (or its loading fallback).
 */
export default function UnitFenceCutout({ scope }: Props): JSX.Element {
  const t = useT()
  return (
    <div className="border-t border-border-subtle" data-testid="unit-fence-cutout">
      <div className="px-3 py-2">
        <div className="text-xs font-semibold text-text-primary">{t('params.whereUnitSits')}</div>
        <div className="text-[10px] text-text-muted">{t('params.fenceCutoutBlurb')}</div>
      </div>
      <div className="px-3 pb-3">
        <Suspense
          fallback={
            <div className="h-40">
              <LoadingState label={t('params.loading3dView')} />
            </div>
          }
        >
          <UnitFenceScene scope={scope} />
        </Suspense>
      </div>
    </div>
  )
}
