/**
 * Bottom-left gesture cheat pill for the section canvas.
 *
 * Always lists the canvas-wide pan / zoom / column gestures; on the
 * lithostratigraphic axis it adds a second line for the litho-ghost
 * layer gestures (accept / copy / context menu) — these are otherwise
 * undiscoverable, esp. the Alt+drag copy-composition gesture (debt #95).
 *
 * Parameters
 * ----------
 * axisMode
 *     Which model axis the section is editing. Drives whether the
 *     litho-specific gesture line is shown, and whether the
 *     geotech-not-built hint is eligible to surface.
 * correlateBlocked
 *     Debt #139 — the user has entered correlate mode on a section with
 *     zero litho contacts. Surfaces an explanatory hint so the no-op is
 *     discoverable instead of silent.
 * geotechNotReconciled
 *     Geotech axis only — the geotech model for this section has not been
 *     built yet. Surfaces a discoverability hint prompting the user to
 *     trigger a build before the NAD suggestion flow is available.
 */
import { useT } from '../../i18n/translate'

export default function CanvasHints({
  axisMode,
  correlateBlocked = false,
  geotechNotReconciled = false,
}: {
  axisMode: 'geological' | 'lithostratigraphic' | 'geotechnical'
  /** Debt #139 — user has entered correlate mode on a section with zero
   *  litho contacts.  The CorrelationEdgesOverlay paints no hit-rects in
   *  this state, leaving the user with no clickable surface.  Surface a
   *  hint line so the failure mode is discoverable instead of silent. */
  correlateBlocked?: boolean
  /** Geotech axis only — fires when the geotech model for the active
   *  section has not yet been built, so the NAD subdivision suggestion
   *  flow is unavailable.  Mirrors the ``correlateBlocked`` pattern:
   *  visible only on the geotechnical axis when true, styled amber to
   *  draw the eye without implying an error. */
  geotechNotReconciled?: boolean
}): JSX.Element {
  const t = useT()
  return (
    // SVG can't use Tailwind dark: variants; the hint pill's background and
    // text colour are driven by --section-hint-* CSS-var tokens (index.css
    // :root/.dark) so they match the dark plot-area chrome.
    <div
      className="absolute bottom-2 left-2 z-10 text-[10px] px-1.5 py-0.5 rounded pointer-events-none leading-snug"
      style={{
        color: 'var(--section-hint-text)',
        background: 'var(--section-hint-bg)',
      }}
    >
      <div>{t('sections.hints.panZoom')}</div>
      {/* Debt #203 — the Help → Gesture cheatsheet (debt #95) is otherwise
          only reachable via the menu/F1 accelerator with no on-canvas cue;
          this line closes the discoverability loop. */}
      <div data-testid="f1-cheatsheet-hint">{t('sections.hints.f1')}</div>
      {axisMode === 'lithostratigraphic' && (
        <div data-testid="litho-gesture-hint">{t('sections.hints.lithoLayer')}</div>
      )}
      {correlateBlocked && (
        <div data-testid="correlate-blocked-hint" style={{ color: 'var(--section-hint-emphasis, #fbbf24)' }}>
          {t('sections.hints.acceptFirst')}
        </div>
      )}
      {axisMode === 'geotechnical' && geotechNotReconciled && (
        <div data-testid="geotech-not-built-hint" style={{ color: 'var(--section-hint-emphasis, #fbbf24)' }}>
          {t('sections.hints.buildGeotechFirst')}
        </div>
      )}
    </div>
  )
}
