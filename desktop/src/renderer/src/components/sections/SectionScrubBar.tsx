/**
 * Section scrub bar — fast horizontal navigation for long profiles.
 *
 * Track represents the full section (0 → sectionLength). A coloured
 * handle inside it shows the current viewport window. Drag the
 * handle to pan; click on the track outside the handle to recentre
 * the viewport at that x.
 *
 * Vertical zoom is unaffected — only the X bounds move. This keeps
 * the scrub interaction predictable: same Y window, different X
 * slice.
 */

import { useRef } from 'react'

export default function SectionScrubBar({
  sectionLength,
  xMin,
  xMax,
  onScrubTo,
}: {
  sectionLength: number
  xMin: number
  xMax: number
  onScrubTo: (centerX: number) => void
}): JSX.Element | null {
  const trackRef = useRef<HTMLDivElement>(null)
  // Pixel offset between the cursor and the handle's centre at
  // drag-start. Lets the user grab anywhere on the handle without
  // the handle jumping to the cursor's exact x.
  const dragGrabRef = useRef<number | null>(null)

  if (sectionLength <= 0) return null

  // Viewport window as percentages of the full section. Clamped to
  // [0, 100] so a window scrolled past either end of the section
  // still renders as a flush-against-edge handle.
  const startPct = Math.max(0, Math.min(100, (xMin / sectionLength) * 100))
  const endPct = Math.max(0, Math.min(100, (xMax / sectionLength) * 100))
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
    return fraction * sectionLength
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
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-[10px] text-gray-500 flex items-center gap-2">
      <span className="tabular-nums w-14 text-right shrink-0">
        {Math.round(Math.max(0, xMin))} m
      </span>
      <div
        ref={trackRef}
        onMouseDown={onTrackClick}
        className="relative flex-1 h-3 rounded bg-gray-200 cursor-pointer select-none"
        title={`Showing ${viewportSpan.toFixed(0)} m of ${sectionLength.toFixed(0)} m`}
      >
        <div
          onMouseDown={startDrag}
          className="absolute top-0 bottom-0 rounded bg-blue-500/70 hover:bg-blue-500 transition-colors cursor-grab active:cursor-grabbing"
          style={{
            left: `${startPct}%`,
            width: `${widthPct}%`,
          }}
        />
      </div>
      <span className="tabular-nums w-14 text-left shrink-0">
        {Math.round(Math.min(sectionLength, xMax))} m
      </span>
    </div>
  )
}
