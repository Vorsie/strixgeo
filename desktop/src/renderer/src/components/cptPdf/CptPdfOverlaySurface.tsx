// The page surface of the calibration overlay: the backend's overlay PNG (the
// page with the digitised curve in orange) under one dashed frame per panel,
// with a drag handle on the top-left and bottom-right corner of each frame.
//
// Pure presentation: the overlay owns the calibration, the drag state and the
// eyedropper; this component draws them and reports the gestures.

import type { RefObject } from 'react'

import type { CptPdfOverlay, PageCalibrationDict } from '../../api/clients/cptPdf'
import { useT } from '../../i18n/translate'
import type { FrameCorner } from './cptPdfCalibrationEdits'

const CORNERS: FrameCorner[] = ['top-left', 'bottom-right']

interface Props {
  overlay: CptPdfOverlay
  /** The calibration the frames are drawn from (edits already applied). */
  cal: PageCalibrationDict
  /** Overlay pixels per calibration unit. */
  scale: number
  /** The selected panel (drawn in the accent colour). */
  panelIdx: number
  /** While the eyedropper is armed the handles hide and the cursor is a crosshair. */
  eyedropper: boolean
  imageRef: RefObject<HTMLImageElement>
  onSurfaceClick: (e: React.MouseEvent<HTMLDivElement>) => void
  /** A corner handle was grabbed at (cx, cy) overlay pixels. */
  onCornerDown: (panel: number, corner: FrameCorner, e: React.MouseEvent<SVGCircleElement>, cx: number, cy: number) => void
}

/**
 * Draw the page with its panel frames and corner handles.
 *
 * @returns The surface.
 */
export default function CptPdfOverlaySurface({
  overlay,
  cal,
  scale,
  panelIdx,
  eyedropper,
  imageRef,
  onSurfaceClick,
  onCornerDown,
}: Props): JSX.Element {
  const t = useT()
  return (
    <div
      data-testid="cpt-pdf-overlay-surface"
      className={['relative', eyedropper ? 'cursor-crosshair' : ''].join(' ')}
      style={{ width: overlay.width, height: overlay.height }}
      onClick={onSurfaceClick}
    >
      <img
        ref={imageRef}
        data-testid="cpt-pdf-overlay-image"
        src={`data:image/png;base64,${overlay.png_base64}`}
        width={overlay.width}
        height={overlay.height}
        alt={t('cptPdf.overlay.page', { page: overlay.page_number })}
        draggable={false}
      />
      <svg className="absolute inset-0" width={overlay.width} height={overlay.height}>
        {cal.panels.map((p, i) => (
          <g key={`${p.kind}-${i}`}>
            <rect
              x={p.frame.x0 * scale}
              y={p.frame.y0 * scale}
              width={(p.frame.x1 - p.frame.x0) * scale}
              height={(p.frame.y1 - p.frame.y0) * scale}
              fill="none"
              stroke={i === panelIdx ? '#0ea5e9' : '#94a3b8'}
              strokeDasharray="4 3"
            />
            {!eyedropper &&
              CORNERS.map(corner => {
                const cx = (corner === 'top-left' ? p.frame.x0 : p.frame.x1) * scale
                const cy = (corner === 'top-left' ? p.frame.y0 : p.frame.y1) * scale
                return (
                  <circle
                    key={corner}
                    data-testid={`cpt-pdf-corner-${i}-${corner}`}
                    aria-label={t('cptPdf.overlay.cornerHandle', {
                      corner: t(
                        corner === 'top-left' ? 'cptPdf.overlay.cornerTopLeft' : 'cptPdf.overlay.cornerBottomRight',
                      ),
                      kind: p.kind,
                    })}
                    cx={cx}
                    cy={cy}
                    r={6}
                    className="cursor-move fill-sky-500/70 stroke-white"
                    onMouseDown={e => onCornerDown(i, corner, e, cx, cy)}
                  />
                )
              })}
          </g>
        ))}
      </svg>
    </div>
  )
}
