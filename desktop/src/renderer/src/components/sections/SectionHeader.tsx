/**
 * Cross-section header strip — name, length, buffer slider, VEX
 * slider, scale read-out, reset, zoom +/-, close.
 *
 * The VEX slider is log-mapped: a linear 0-100 thumb travels across
 * the full ``VEX_MIN..VEX_MAX`` log range. Geotech sections regularly
 * want 5× and 50× both reachable; linear mapping would crowd the
 * small values.
 *
 * The buffer slider mirrors a local-then-commit pattern (matches the
 * DEM overlay opacity slider): the displayed value updates
 * immediately as the user drags, but the server-side patch fires
 * only on release. Until commit, the projected columns still use
 * the value from the server-truth ``section`` prop.
 */

import { useEffect, useState } from 'react'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'

import type { CrossSectionResponse } from '../../api/client'
import { VEX_MAX, VEX_MIN } from './utils'

// Projection-buffer slider bounds. 5 m is the tightest engineers
// typically use (closely-spaced corridor surveys); 500 m covers
// regional / preliminary sections through sparse boreholes.
const BUFFER_MIN = 5
const BUFFER_MAX = 500

export default function SectionHeader({
  section,
  lengthM,
  onClose,
  onZoomIn,
  onZoomOut,
  vex,
  onVexChange,
  onVexCommit,
  onBufferCommit,
  scaleH,
  scaleV,
  onReset,
}: {
  section: CrossSectionResponse
  lengthM: number
  onClose: (() => void) | undefined
  onZoomIn: () => void
  onZoomOut: () => void
  vex: number
  onVexChange: (next: number) => void
  /** Fires on slider release with the final value; ``undefined``
   * means "don't persist" (test-render mode without a backend
   * seam). */
  onVexCommit: ((next: number) => void) | undefined
  onBufferCommit: ((next: number) => void) | undefined
  scaleH: number
  scaleV: number
  onReset: () => void
}): JSX.Element {
  const sliderValue = Math.round(
    ((Math.log10(vex) - Math.log10(VEX_MIN)) /
      (Math.log10(VEX_MAX) - Math.log10(VEX_MIN))) *
      100,
  )

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = Number(e.target.value) / 100
    const logRange = Math.log10(VEX_MAX) - Math.log10(VEX_MIN)
    onVexChange(Math.pow(10, Math.log10(VEX_MIN) + v * logRange))
  }

  const [localBuffer, setLocalBuffer] = useState(section.projection_buffer_m)
  useEffect(() => {
    setLocalBuffer(section.projection_buffer_m)
  }, [section.id, section.projection_buffer_m])

  return (
    <div className="flex items-center gap-4 px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs">
      <div className="flex flex-col min-w-0">
        <span
          className="font-medium text-gray-800 truncate"
          title={section.name}
        >
          {section.name}
        </span>
        <span className="text-[10px] text-gray-500">
          {lengthM.toFixed(0)} m · buffer ±{section.projection_buffer_m.toFixed(0)} m
        </span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <span
          className="text-[10px] text-gray-500"
          title="Lateral distance from the section line within which investigations are projected onto it"
        >
          Buffer
        </span>
        <input
          type="range"
          min={BUFFER_MIN}
          max={BUFFER_MAX}
          step={5}
          value={Math.round(localBuffer)}
          onChange={e => setLocalBuffer(Number(e.target.value))}
          onMouseUp={() => onBufferCommit?.(localBuffer)}
          onTouchEnd={() => onBufferCommit?.(localBuffer)}
          onKeyUp={() => onBufferCommit?.(localBuffer)}
          className="w-28 cursor-pointer"
          aria-label="Projection buffer (m)"
          disabled={onBufferCommit === undefined}
        />
        <span className="tabular-nums w-12 text-right">±{Math.round(localBuffer)} m</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500">V exag</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={handleSlider}
          onMouseUp={() => onVexCommit?.(vex)}
          onTouchEnd={() => onVexCommit?.(vex)}
          onKeyUp={() => onVexCommit?.(vex)}
          className="w-32 cursor-pointer"
          aria-label="Vertical exaggeration"
        />
        <span className="tabular-nums w-12 text-right">{vex.toFixed(1)}×</span>
      </div>

      <div className="flex flex-col items-end text-[10px] text-gray-500 tabular-nums">
        <span>H: {scaleH.toFixed(2)} px/m</span>
        <span>V: {scaleV.toFixed(2)} px/m</span>
      </div>

      <div className="flex items-center rounded border border-gray-200 overflow-hidden">
        <button
          onClick={onZoomOut}
          className="flex items-center justify-center w-7 h-7 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors border-r border-gray-200"
          title="Zoom out (or scroll the canvas)"
          aria-label="Zoom out"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={onZoomIn}
          className="flex items-center justify-center w-7 h-7 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors"
          title="Zoom in (or scroll the canvas)"
          aria-label="Zoom in"
        >
          <Plus size={13} />
        </button>
      </div>

      <button
        onClick={onReset}
        className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-white hover:text-gray-800 transition-colors"
        title="Reset view to default framing"
      >
        <RotateCcw size={11} />
        Reset
      </button>

      {onClose && (
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded border border-gray-200 text-gray-500 hover:bg-white hover:text-gray-800 transition-colors"
          title="Close section view (back to map)"
          aria-label="Close section view"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
