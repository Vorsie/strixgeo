/**
 * Basemap + vector overlay for the sheet's map box (spec "The map").
 * Leaflet draws the tiles; the overlay (line A–A′, dots, codes, scale bar,
 * north arrow) is one SVG positioned over the box and re-laid on every
 * ``move`` so it prints as vectors. Reports ``onReady(offline)`` once tiles
 * loaded or ``TILE_WAIT_MS`` passed.
 */
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { sheetMapBounds, sheetPointToLatLng } from './sheetMapProjection'
import { basemapById } from '../utils/basemapSources'
import { computeMapExtent, pickScaleBarM } from './mapExtent'
import { projectColour } from './projectPalette'
import { TILE_WAIT_MS } from './sheetConstants'
import type { SheetPayload } from './sheetPayload'

const INK = '#1f2933'
const LINE = '#c8442b'

/** The tile provider's attribution as plain text — the print has no links to click. */
function attributionText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

export function SheetMap({ payload, offlineLabel, onReady }: {
  payload: SheetPayload; offlineLabel: string; onReady: (offline: boolean) => void
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [offline, setOffline] = useState(false)
  const [tick, setTick] = useState(0)
  const source = basemapById(payload.map.basemapId) ?? basemapById('osm')

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const map = L.map(el, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0,
    })
    mapRef.current = map
    let loaded = false
    let done = false
    const finish = (isOffline: boolean): void => {
      if (done) return
      done = true
      setOffline(isOffline)
      onReady(isOffline)
    }
    if (source) {
      const layer = L.tileLayer(source.url, { maxZoom: 19, subdomains: source.subdomains ?? 'abc' })
      layer.on('load', () => { loaded = true; finish(false) })
      layer.on('tileerror', () => { if (!loaded) finish(true) })
      layer.addTo(map)
    } else {
      finish(true)
    }
    const timer = window.setTimeout(() => finish(!loaded), TILE_WAIT_MS)
    // Converted with the section's own CRS — a 28992 project is not Lambert 72.
    const { sw, ne } = sheetMapBounds(payload.section.epsg, [
      { x: payload.section.startX, y: payload.section.startY }, { x: payload.section.endX, y: payload.section.endY },
      ...payload.map.points.filter(p => p.onProfile).map(p => ({ x: p.worldX, y: p.worldY })),
    ])
    map.fitBounds(L.latLngBounds(L.latLng(sw[0], sw[1]), L.latLng(ne[0], ne[1])), { padding: [0, 0], animate: false })
    map.on('move zoom resize', () => setTick(v => v + 1))
    setTick(v => v + 1)
    return () => { window.clearTimeout(timer); map.remove(); mapRef.current = null }
    // reason: the map is created once per payload identity; every field the
    // effect reads is part of that payload, and re-running on onReady/source
    // identity would tear down the tiles mid-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  const map = mapRef.current
  const box = boxRef.current
  const toPx = (x: number, y: number): [number, number] => {
    if (!map) return [0, 0]
    const [lat, lng] = sheetPointToLatLng(payload.section.epsg, x, y)
    const p = map.latLngToContainerPoint(L.latLng(lat, lng))
    return [p.x, p.y]
  }
  const w = box?.clientWidth ?? 0
  const h = box?.clientHeight ?? 0
  const a = toPx(payload.section.startX, payload.section.startY)
  const b = toPx(payload.section.endX, payload.section.endY)
  // px per 100 m from the fitted extent (Web-Mercator distortion is negligible at box scale).
  const east = toPx(payload.section.startX + 100, payload.section.startY)
  const pxPer100m = Math.max(1e-6, Math.hypot(east[0] - a[0], east[1] - a[1]))
  const barM = pickScaleBarM((w / pxPer100m) * 100)
  const barPx = (barM / 100) * pxPer100m

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
      <svg key={tick} data-testid="sheet-map-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={LINE} strokeWidth={2.4} />
        <text x={a[0] - 12} y={a[1] + 4} fontSize={11} fontWeight={600} fill={LINE}>A</text>
        <text x={b[0] + 4} y={b[1] - 4} fontSize={11} fontWeight={600} fill={LINE}>A′</text>
        {payload.map.points.map(p => {
          const [x, y] = toPx(p.worldX, p.worldY)
          return (
            <g key={p.investigationId} opacity={p.onProfile ? 1 : 0.5}>
              <circle cx={x} cy={y} r={p.onProfile ? 3.2 : 2.6} fill={projectColour(p.colourIndex)} stroke={INK} strokeWidth={0.6} />
              <text x={x + 4.5} y={y - 3} fontSize={8} fontWeight={500} fill={INK}>{p.code}</text>
            </g>
          )
        })}
        <g transform={`translate(8 ${h - 10})`} fontSize={7} fill={INK}>
          <rect x={0} y={0} width={barPx / 2} height={3} fill={INK} />
          <rect x={barPx / 2} y={0} width={barPx / 2} height={3} fill="#fff" stroke={INK} strokeWidth={0.5} />
          <text x={0} y={-2}>0</text><text x={barPx / 2 - 6} y={-2}>{barM / 2}</text><text x={barPx - 8} y={-2}>{barM} m</text>
        </g>
        <g transform={`translate(${w - 14} ${h - 24})`} fill={INK}>
          <polygon points="0,-11 4,4 0,1 -4,4" />
          <text x={-3.5} y={14} fontSize={8} fontWeight={600}>N</text>
        </g>
        {offline && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={8} fill="#5b6673">{offlineLabel}</text>}
      </svg>
      {source?.attribution && (
        <div style={{ position: 'absolute', right: 2, bottom: 1, fontSize: '5pt', color: '#5b6673', background: 'rgba(255,255,255,.7)', padding: '0 2px' }}>
          {attributionText(source.attribution)}
        </div>
      )}
    </div>
  )
}
