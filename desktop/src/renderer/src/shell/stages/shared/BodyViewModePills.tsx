// Solid / Fence / Wireframe view-mode pill cluster + empty-fence hint shared
// by the Lithology and Geotechnical 3D canvases.
//
// Extracted per audit 2026-07-12 FE-SHELL-CLIENTS-10 — the JSX was byte-equal
// between the two canvases modulo data-testids, tooltip copy and the hint's
// vertical offset, so those are the only props that vary.  Both blocks are
// absolutely positioned and expect a `relative` ancestor (the canvas root):
//   • the pill cluster sits bottom-2 left-2 z-20 to stay CLEAR of the Layers
//     legend (top-2 left-2 z-10) and the BasemapPanel (top-2 right-2) that
//     Geology3DViewer paints;
//   • the hint sits top-centre for the same reason.

import { Grid3x3, Loader2, Network } from 'lucide-react'

import type { FencePanel } from '../../../utils/fencePanels'
import { useT } from '../../../i18n/translate'

/** Props for ``BodyViewModePills``. */
export interface BodyViewModePillsProps {
  /** data-testid prefix — 'litho' → litho-view-mode-solid etc. */
  testIdPrefix: string
  /** Tooltip on the pill-cluster wrapper (view-mode discoverability, Fix D). */
  title: string
  /** Current Solid/Fence view sub-mode. */
  viewMode: 'solid' | 'fence'
  setViewMode: React.Dispatch<React.SetStateAction<'solid' | 'fence'>>
  /** Wireframe toggle state (Solid mode only). */
  wireframe: boolean
  setWireframe: React.Dispatch<React.SetStateAction<boolean>>
  /** True while the per-section edge fetches are in flight. */
  fenceLoading: boolean
  /** Fence panels — the hint shows when defined-but-empty in Fence mode. */
  fencePanels: readonly FencePanel[] | undefined
  /** data-testid of the empty-fence hint (kept exact for the e2e specs). */
  emptyHintTestId: string
  /** Hint copy — points the user at where correlations are authored. */
  emptyHintText: string
  /** Vertical offset class of the hint (litho 'top-8', geotech 'top-10'). */
  emptyHintTopClassName: string
}

/**
 * The Solid/Fence pill pair, the Solid-only Wireframe toggle and the
 * empty-fence hint.
 *
 * Parameters
 * ----------
 * props : BodyViewModePillsProps
 *     View-mode state + the per-canvas testid / copy variations.
 *
 * Returns
 * -------
 * JSX.Element
 *     The pill cluster and (conditionally) the empty-fence hint.
 */
export function BodyViewModePills(props: BodyViewModePillsProps): JSX.Element {
  const t = useT()
  const {
    testIdPrefix,
    title,
    viewMode,
    setViewMode,
    wireframe,
    setWireframe,
    fenceLoading,
    fencePanels,
    emptyHintTestId,
    emptyHintText,
    emptyHintTopClassName,
  } = props

  return (
    <>
      <div
        className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5"
        title={title}
      >
        {/* Small "View" label so first-time users read this as a view-mode
            switch rather than an action button (Fix D). */}
        <span className="text-[10px] text-text-secondary select-none leading-none">{t('export.viewLabel')}</span>
        <div className="flex rounded overflow-hidden border border-border-default shadow-sm">
          <button
            type="button"
            data-testid={`${testIdPrefix}-view-mode-solid`}
            aria-pressed={viewMode === 'solid'}
            disabled={fenceLoading}
            onClick={() => setViewMode('solid')}
            className={[
              'px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              viewMode === 'solid'
                ? 'bg-accent text-white'
                : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
            ].join(' ')}
          >
            {t('export.viewSolid')}
          </button>
          <button
            type="button"
            data-testid={`${testIdPrefix}-view-mode-fence`}
            aria-pressed={viewMode === 'fence'}
            disabled={fenceLoading}
            onClick={() => setViewMode('fence')}
            className={[
              'px-3 py-1 text-xs font-medium transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed',
              viewMode === 'fence'
                ? 'bg-accent text-white'
                : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
            ].join(' ')}
          >
            {/* Spinner sits beside the label so the button width stays stable
                and the label stays readable. */}
            {fenceLoading && <Loader2 size={11} className="animate-spin" />}
            {t('export.viewFence')}
          </button>
        </div>

        {/* Wireframe toggle — Solid mode only (wireframe applies to the
            filled body-solid render, which Fence mode does not draw).
            Matches the Fence/Solid pill styling so the two read as one
            view-control cluster; aria-pressed mirrors the toggle state. */}
        {viewMode === 'solid' && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-view-wireframe`}
            aria-pressed={wireframe}
            title={t('export.viewWireframeTitle')}
            onClick={() => setWireframe(w => !w)}
            className={[
              'px-3 py-1 text-xs font-medium transition-colors inline-flex items-center gap-1 rounded border border-border-default shadow-sm',
              wireframe
                ? 'bg-accent text-white'
                : 'bg-surface-overlay/80 backdrop-blur-sm text-text-secondary hover:bg-surface-overlay',
            ].join(' ')}
          >
            <Grid3x3 size={11} />
            {t('export.viewWireframe')}
          </button>
        )}
      </div>

      {/* Empty-fence hint pill (Fix C) — rendered only when Fence mode is
          active, the edge fetch has completed (not loading), and no panels
          were produced.  Positioned top-centre so it clears the Layers
          legend (top-2 left-2) and the BasemapPanel (top-2 right-2). */}
      {viewMode === 'fence' && !fenceLoading && fencePanels !== undefined && fencePanels.length === 0 && (
        <div
          data-testid={emptyHintTestId}
          className={`absolute ${emptyHintTopClassName} left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] pointer-events-none`}
          style={{
            color: 'var(--section-hint-text)',
            background: 'var(--section-hint-bg)',
          }}
        >
          <Network size={12} />
          {emptyHintText}
        </div>
      )}
    </>
  )
}
