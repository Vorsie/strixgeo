import { Fragment } from 'react'
import { CircleMarker, Polyline } from 'react-leaflet'
import { tieToLatLngLine } from '../utils/tieToLatLngLine'
import type { SuggestedTie } from '../utils/tieAutoSuggest'

export interface TieSuggestionOverlayProps {
  ties: readonly SuggestedTie[]
  epsg: number
  /** Index-keyed accept handler (creates the section). */
  onAccept: (index: number) => void
  /** Index-keyed reject handler (drops the suggestion). */
  onReject: (index: number) => void
}

/**
 * Render auto-proposed tie-sections as green dashed ghost lines on the
 * map. Click a line to accept it (creates the section); click its red
 * end dot to reject it. Drawn in the existing ``section-overlays`` pane.
 */
export function TieSuggestionOverlay({
  ties,
  epsg,
  onAccept,
  onReject,
}: TieSuggestionOverlayProps): JSX.Element {
  return (
    <>
      {ties.map((tie, i) => {
        const line = tieToLatLngLine(tie, epsg)
        return (
          <Fragment key={`tie-ghost-${i}`}>
            <Polyline
              positions={line}
              pane="section-overlays"
              pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.75, dashArray: '7 5' }}
              eventHandlers={{ click: () => onAccept(i) }}
            />
            <CircleMarker
              center={line[1]}
              radius={5}
              pane="section-overlays"
              pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 }}
              eventHandlers={{ click: () => onReject(i) }}
            />
          </Fragment>
        )
      })}
    </>
  )
}
