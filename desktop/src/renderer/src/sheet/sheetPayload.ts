/**
 * The wire contract of the cross-section sheet. Assembled on the Sections
 * stage (``useSheetPayload``), posted into the preview iframe, relayed by the
 * main process into the hidden print window. Plain JSON: no functions, no
 * class instances, so it survives ``postMessage`` and IPC unchanged.
 *
 * Geometry stays in the screen's frame: regions are ``[fraction, elevation_m]``
 * polygons per gap (exactly ``RegionInput``), columns carry their true
 * ``along_m``. Column x on paper is resolved at draw time from the spacing
 * slider, so a slider move never recomputes a fill.
 */
import type { BoreholeDetailResponse } from '../api/clients/borehole'
import type { CptPlotResponse } from '../api/clients/cpt'
import type { RegionInput } from '../utils/buildVoxelRequest'

export type SheetFill = 'litho' | 'geotech'
export type SheetScaleMode = 'fit' | 'explicit'

export interface SheetField {
  label: string
  value: string
}

export interface SheetSettings {
  fill: SheetFill
  scaleMode: SheetScaleMode
  /** ``1:N`` denominators; only read in explicit mode. */
  hScale: number | null
  vScale: number | null
  vex: number
  /** 0 = packed, 1 = true distance (the section's ``column_spacing``). */
  spacing: number
  fields: [SheetField, SheetField, SheetField, SheetField]
}

export interface SheetColumn {
  investigationId: string
  kind: 'cpt' | 'borehole'
  name: string
  code: string
  projectKey: string
  colourIndex: number
  alongM: number
  collarElevationM: number
  totalDepthM: number
  /** CPT only. */
  cptType: string | null
  plot: CptPlotResponse | null
  /** Borehole only. */
  detail: BoreholeDetailResponse | null
}

export interface SheetUnit {
  formationId: string
  name: string
  /**
   * The stored formation colour. On the litho / geological axes this is what the
   * region is drawn in; on the geotech axis it is the litho hue the geotech row
   * inherited from its source litho unit, which is NOT its display colour — that
   * comes from the packing class (``nadClass`` / ``colorOverride`` below).
   */
  colour: string
  displayOrder: number
  /**
   * NAD packing class (1..31) on the geotech axis — the identity that decides
   * both the region fill colour and the compact legend label. ``null`` = a
   * geotech unit not yet classified; ABSENT on the litho / geological axes,
   * where the drawing falls back to ``colour`` and the stored ``name``.
   */
  nadClass?: number | null
  /** The engineer's colour pick on the units pane; honoured over the NAD ramp on the geotech axis. */
  colorOverride?: string | null
  /**
   * Main soil token (GRIND / ZAND / …). Only read for the unclassified-gravel
   * colour exception (owner ruling, installer #26): an unclassified gravel
   * region reads as gravel, not the null grey that clashes with clay.
   */
  mainSoilCode?: string | null
}

export interface SheetMapPoint {
  investigationId: string
  kind: 'cpt' | 'borehole'
  code: string
  colourIndex: number
  worldX: number
  worldY: number
  onProfile: boolean
}

export interface SheetProjectLegendRow {
  projectKey: string
  colourIndex: number
  /** Codes in A → A′ order (on-profile first), then map order. */
  codes: string[]
}

export interface SheetPayload {
  language: 'en' | 'nl'
  section: {
    id: string
    name: string
    epsg: number
    lengthM: number
    startX: number
    startY: number
    endX: number
    endY: number
    /** The section's ``view_state`` — the column components read their channel toggles from it. */
    viewState: Record<string, unknown> | null
  }
  columns: SheetColumn[]
  regions: RegionInput[]
  units: SheetUnit[]
  /** Highest / lowest level drawn, already padded by ``LEVEL_PAD_M``. */
  levelMaxM: number
  levelMinM: number
  map: {
    basemapId: string
    points: SheetMapPoint[]
    legend: SheetProjectLegendRow[]
  }
  settings: SheetSettings
}

/** What the sheet page reports back once it has laid itself out. */
export interface SheetReadyMessage {
  type: 'sheet:ready'
  paperWidthMm: number
  paperHeightMm: number
  /** True when the basemap tiles never arrived (offline caption shown). */
  offline: boolean
}

export interface SheetPayloadMessage {
  type: 'sheet:payload'
  payload: SheetPayload
}
