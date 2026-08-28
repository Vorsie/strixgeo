// The segmented Geology / Litho / Geotech control for the Sections toolbar.
//
// Extracted verbatim from ``SectionsToolbar``'s ``renderAxisPill`` (debt #201).
// It is a leaf presentational control — every piece of state it reads is passed
// in, so it holds no hooks and cannot drift from the toolbar's axis state.

import type { GeologicalModelResponse } from '../../../api/client'
import type { SectionModelAxis } from '../../../hooks/useSections'

/** What the axis pill needs from the toolbar to render + switch axes. */
export interface SectionsAxisPillProps {
  /**
   * Swap "Geology" for "Geo" — the ONLY segment with a designed short form.
   * "Litho" is already short, and "Geotech" is the segment the owner watched
   * get cut, so it is spelled out at every width.
   */
  short: boolean
  /** True when the lithostratigraphic axis is active. */
  isLitho: boolean
  /** True when the geotechnical axis is active. */
  isGeotech: boolean
  /** Active litho model — gates the Litho + Geotech segments when null. */
  activeLithoModel: GeologicalModelResponse | null
  /** Active geotech model — decides the Geotech segment's enabled/tooltip state. */
  activeGeotechModel: GeologicalModelResponse | null
  /** Validate + switch the section model axis. */
  onAxisChange: (axis: SectionModelAxis) => void
}

/**
 * The segmented Geology / Litho / Geotech control.
 *
 * ``short`` swaps "Geology" for "Geo" — the ONLY segment with a designed
 * short form. "Litho" is already short, and "Geotech" is the segment the
 * owner watched get cut, so it is spelled out at every width.
 */
export default function SectionsAxisPill({
  short,
  isLitho,
  isGeotech,
  activeLithoModel,
  activeGeotechModel,
  onAxisChange: handleAxisChange,
}: SectionsAxisPillProps): JSX.Element {
  return (
    <>
      {/* Geology ↔ Lithology segmented toggle (slice 2, #55).
          Disabled on the litho segment when no litho model exists yet.
          Reads/writes sectionModelAxis from the sections slice. Uses
          border-default + surface-card / accent semantic tokens only.

          WHY the span wrapper on the disabled Litho button:
          Chromium/Electron does not fire mouse events (including hover)
          on `disabled` elements, so a `title` attribute on the button
          itself is never surfaced to the user — they see only the
          not-allowed cursor with no guidance. Wrapping in a non-disabled
          <span role="presentation"> lets the browser attach the tooltip
          to the span instead, restoring the expected UX. The span is
          purely presentational (role="presentation", no tabIndex) so it
          does not break the radiogroup/radio semantics or keyboard nav. */}
      {/* ``shrink-0`` is load-bearing and MUST NOT be dropped. Per CSS
          Flexbox §4.5 a flex item's automatic minimum size is min-content
          only while its overflow is ``visible``; ``overflow-hidden`` (here
          for the rounded corners) collapses that minimum to zero, so
          flexbox picked this group as the one item free to absorb the whole
          width deficit and its own clip then cut the last segment mid-word
          — the owner's "Geology | Litho | Geote" (dogfeed 2026-08-26).
          ``shrink-0`` refuses the shrink; ResponsiveToolbarRow decides the
          pill's form instead, and it only ever picks a DESIGNED one. */}
      <div
        role="group"
        aria-label="Section model axis"
        className="flex items-center rounded border border-border-default overflow-hidden text-xs shrink-0"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!isLitho && !isGeotech}
          onClick={() => handleAxisChange('geological')}
          className={[
            'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent whitespace-nowrap',
            !isLitho && !isGeotech
              ? 'bg-accent text-text-on-accent'
              : 'bg-surface-card text-text-secondary hover:text-text-primary',
          ].join(' ')}
          // The full word stays in the tooltip + accessible name when the
          // short form is showing, so "Geo" is never the only thing a user
          // (or a screen reader) has to go on.
          aria-label="Geology"
          title="Edit the geological model contacts on this section"
        >
          {short ? 'Geo' : 'Geology'}
        </button>
        {/* Span wrapper surfaces the tooltip on hover when the button is
            disabled — Chromium suppresses mouse events (incl. title) on
            disabled elements.  role="presentation" keeps this invisible
            to screen readers; the button's own aria-disabled conveys state. */}
        <span
          role="presentation"
          title={
            activeLithoModel === null
              ? 'Create a lithostratigraphic model in the Lithology stage first'
              : undefined
          }
        >
          <button
            type="button"
            role="radio"
            aria-checked={isLitho}
            disabled={activeLithoModel === null}
            onClick={() => handleAxisChange('lithostratigraphic')}
            className={[
              'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent whitespace-nowrap',
              isLitho
                ? 'bg-accent text-text-on-accent'
                : activeLithoModel === null
                  ? 'bg-surface-card text-text-muted cursor-not-allowed'
                  : 'bg-surface-card text-text-secondary hover:text-text-primary',
            ].join(' ')}
            title={
              activeLithoModel !== null
                ? 'Edit the lithostratigraphic model contacts on this section'
                : undefined
            }
          >
            Litho
          </button>
        </span>
        {/* Geotech segment — enabled when a geotech model exists OR a litho
            model does. The litho model is the real prerequisite: the packing
            pipeline's "1 · Subdivide CPTs" (which CREATES the geotech model)
            lives on this axis, so gating the axis on the geotech model would
            deadlock every clean-slate run. Same span-wrapper pattern as
            Litho: Chromium suppresses title on disabled elements, so the
            tooltip rides the presentational span. */}
        <span
          role="presentation"
          title={
            activeGeotechModel === null && activeLithoModel === null
              ? 'Create a lithostratigraphic model first — packing subdivides litho bodies'
              : undefined
          }
        >
          <button
            type="button"
            role="radio"
            aria-checked={isGeotech}
            disabled={activeGeotechModel === null && activeLithoModel === null}
            onClick={() => handleAxisChange('geotechnical')}
            data-testid="axis-geotech"
            className={[
              'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent whitespace-nowrap',
              isGeotech
                ? 'bg-accent text-text-on-accent'
                : activeGeotechModel === null && activeLithoModel === null
                  ? 'bg-surface-card text-text-muted cursor-not-allowed'
                  : 'bg-surface-card text-text-secondary hover:text-text-primary',
            ].join(' ')}
            title={
              activeGeotechModel !== null
                ? 'View geotechnical subdivision (NAD packing classes) on this section'
                : activeLithoModel !== null
                  ? 'No geotech model yet — “Packing pipeline → 1 · Subdivide CPTs” creates it'
                  : undefined
            }
          >
            Geotech
          </button>
        </span>
      </div>

      {/* Inline hint — shown only when no litho model exists so the user
          understands why the Litho segment is disabled without hovering.
          Disappears as soon as a model exists (no permanent toolbar weight —
          debt #23 toolbar crowding).  text-text-muted is a verified semantic
          token (defined in index.css as --color-text-muted, used in
          SectionsInspector, GeologyInspector, EmptyState, etc.). */}
      {activeLithoModel === null && (
        <p className="text-xs text-text-muted whitespace-nowrap">
          No lithostratigraphic model — create one in the Lithology stage.
        </p>
      )}
    </>
  )
}
