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
 *     litho-specific gesture line is shown.
 * correlateBlocked
 *     Debt #139 — the user has entered correlate mode on a section with
 *     zero litho contacts. Surfaces an explanatory hint so the no-op is
 *     discoverable instead of silent.
 */
export default function CanvasHints({
  axisMode,
  correlateBlocked = false,
}: {
  axisMode: 'geological' | 'lithostratigraphic'
  /** Debt #139 — user has entered correlate mode on a section with zero
   *  litho contacts.  The CorrelationEdgesOverlay paints no hit-rects in
   *  this state, leaving the user with no clickable surface.  Surface a
   *  hint line so the failure mode is discoverable instead of silent. */
  correlateBlocked?: boolean
}): JSX.Element {
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
      <div>
        Drag to pan · scroll to zoom · right-click a column to focus · double-click a column to open
      </div>
      {axisMode === 'lithostratigraphic' && (
        <div data-testid="litho-gesture-hint">
          Litho layer: double-click to accept · Alt+drag to copy composition ·
          Shift+drag past neighbour midpoint to absorb · right-click for more
        </div>
      )}
      {correlateBlocked && (
        <div data-testid="correlate-blocked-hint" style={{ color: 'var(--section-hint-emphasis, #fbbf24)' }}>
          Accept litho suggestions to enable correlation — 0 accepted contacts on this section.
        </div>
      )}
    </div>
  )
}
