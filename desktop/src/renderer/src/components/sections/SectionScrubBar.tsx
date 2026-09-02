/**
 * Section scrub bar — fast horizontal navigation for long profiles.
 *
 * Track outer bounds run from the leftmost-test along-position
 * (``dataMinM``) to the rightmost-test along-position (``dataMaxM``)
 * — NOT 0 → sectionLength. Engineers don't usually need to scroll
 * into the empty pre-/post-data tail of the section line; locking
 * the track to the data range makes the handle's percentage
 * read against what's actually there.
 *
 * A coloured handle inside the track shows the current viewport
 * window. Drag the handle to pan; click on the track outside the
 * handle to recentre the viewport at that x. Vertical zoom is
 * unaffected — same Y window, different X slice.
 *
 * Both bounds + the handle re-render automatically when the
 * viewport changes (zoom / pan) or when the placed-column set
 * changes (new investigation imported, spacing affecting which
 * tests are visible, etc.).
 */

import { useRef } from 'react'

import { useT } from '../../i18n/translate'

export default function SectionScrubBar({
  dataMinM,
  dataMaxM,
  xMin,
  xMax,
  onScrubTo,
}: {
  dataMinM: number
  dataMaxM: number
  xMin: number
  xMax: number
  onScrubTo: (centerX: number) => void
}): JSX.Element | null {
  const trackRef = useRef<HTMLDivElement>(null)
  // Pixel offset between the cursor and the handle's centre at
  // drag-start. Lets the user grab anywhere on the handle without
  // the handle jumping to the cursor's exact x.
  const dragGrabRef = useRef<number | null>(null)
  const t = useT()

  const dataSpan = dataMaxM - dataMinM
  if (dataSpan <= 0) return null

  // Viewport window as percentages of the DATA range, not the full
  // section. Clamped to [0, 100] so a viewport that has scrolled past
  // either end of the data still renders as a flush-against-edge
  // handle.
  const startPct = Math.max(0, Math.min(100, ((xMin - dataMinM) / dataSpan) * 100))
  const endPct = Math.max(0, Math.min(100, ((xMax - dataMinM) / dataSpan) * 100))
  // Floor at 2% so the handle stays grab-able when fully zoomed in.
  const widthPct = Math.max(2, endPct - startPct)
  const centerX = (xMin + xMax) / 2
  const viewportSpan = xMax - xMin

  function xFromMouse(e: MouseEvent | React.MouseEvent): number | null {
    const track = trackRef.current
    if (!track) return null
    const rect = track.getBoundingClientRect()
    const px = e.clientX - rect.left
    const fraction = Math.max(0, Math.min(1, px / rect.width))
    return dataMinM + fraction * dataSpan
  }

  function startDrag(e: React.MouseEvent): void {
    const cursorX = xFromMouse(e)
    if (cursorX === null) return
    dragGrabRef.current = cursorX - centerX
    e.stopPropagation()
    e.preventDefault()
    function onMove(ev: MouseEvent): void {
      const x = xFromMouse(ev)
      if (x === null || dragGrabRef.current === null) return
      onScrubTo(x - dragGrabRef.current)
    }
    function onUp(): void {
      dragGrabRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onTrackClick(e: React.MouseEvent): void {
    // Click outside the handle = recentre on that x. The handle
    // has its own onMouseDown that ``stopPropagation``s, so a
    // handle grab won't accidentally recentre via this listener.
    const x = xFromMouse(e)
    if (x === null) return
    onScrubTo(x)
  }

  return (
    <div
      data-testid="section-scrub-bar"
      className="border-t border-border-subtle bg-surface-card px-3 py-2 text-[10px] text-text-muted flex items-center gap-2"
    >
      {/* End labels show the panbar's outer bounds — the LEFTMOST and
          RIGHTMOST test's along-section positions — NOT the current
          viewport's edges. The handle position inside the track
          conveys the current viewport; static end labels anchor the
          track to "where is the data" so the engineer can tell at a
          glance whether they're zoomed into the head, middle, or tail
          of the section (dogfeed 2026-05-31). */}
      <span data-testid="section-scrub-min-label" className="tabular-nums w-14 text-right shrink-0">
        {Math.round(dataMinM)} m
      </span>
      <div
        ref={trackRef}
        onMouseDown={onTrackClick}
        className="relative flex-1 h-3 rounded bg-border-subtle cursor-pointer select-none"
        title={t('sections.scrub.showing', {
          shown: viewportSpan.toFixed(0),
          total: dataSpan.toFixed(0),
        })}
      >
        <div
          onMouseDown={startDrag}
          // Always fully visible (was bg-accent/70 — too faint on the
          // track, only popped on hover). minWidth keeps a small
          // viewport window grabbable + visible.
          className="absolute top-0 bottom-0 rounded bg-accent ring-1 ring-inset ring-white/40 hover:brightness-125 transition-[filter] cursor-grab active:cursor-grabbing"
          style={{
            left: `${startPct}%`,
            width: `${widthPct}%`,
            minWidth: '8px',
          }}
        />
      </div>
      <span data-testid="section-scrub-max-label" className="tabular-nums w-14 text-left shrink-0">
        {Math.round(dataMaxM)} m
      </span>
    </div>
  )
}
