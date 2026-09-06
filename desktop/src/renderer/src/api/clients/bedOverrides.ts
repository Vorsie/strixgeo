/**
 * Bed-override API client — typed wrappers for
 * ``/projects/{pid}/bed-overrides/*`` (owner ruling 2026-09-06).
 *
 * A bed override is a polygon drawn on the map with one constant bed elevation
 * (m TAW / NAP). Inside it the ground surface takes that level instead of the
 * DEM — the manual fix for the missing bathymetry over dredged water. Survey-
 * file bathymetry import stays Phase 5.
 *
 * @module clients/bedOverrides
 */
import { del, get, patch, post } from './shared'

/** One polygon-ring vertex, ``[x, y]`` in the project's horizontal CRS. */
export type BedOverrideVertex = [number, number]

/** Bed-override row — mirrors ``BedOverrideResponse`` on the backend 1:1. */
export interface BedOverrideResponse {
  id: string
  app_project_id: string
  /** Human-readable name shown in the bed-override list (e.g. "Canal bed"). */
  label: string
  /** The constant bed elevation in the project's vertical datum (m TAW / NAP). */
  level_m: number
  /** EPSG of the polygon coordinates — the project's horizontal CRS. */
  epsg: number
  /** The polygon ring as ``[x, y]`` pairs in the project CRS. */
  vertices: BedOverrideVertex[]
  created_at: string
  updated_at: string
}

/** Request body for ``POST /projects/{pid}/bed-overrides``. */
export interface BedOverrideCreatePayload {
  label: string
  level_m: number
  epsg: number
  vertices: BedOverrideVertex[]
}

/** Request body for ``PATCH /projects/{pid}/bed-overrides/{oid}`` (partial). */
export interface BedOverrideUpdatePayload {
  label?: string
  level_m?: number
  epsg?: number
  vertices?: BedOverrideVertex[]
}

/** Typed wrappers for all ``/projects/{pid}/bed-overrides/*`` endpoints. */
export const bedOverrideClient = {
  list: (projectId: string): Promise<BedOverrideResponse[]> =>
    get(`/projects/${projectId}/bed-overrides`),

  create: (projectId: string, body: BedOverrideCreatePayload): Promise<BedOverrideResponse> =>
    post(`/projects/${projectId}/bed-overrides`, body),

  update: (
    projectId: string,
    overrideId: string,
    body: BedOverrideUpdatePayload,
  ): Promise<BedOverrideResponse> =>
    patch(`/projects/${projectId}/bed-overrides/${overrideId}`, body),

  delete: (projectId: string, overrideId: string): Promise<void> =>
    del(`/projects/${projectId}/bed-overrides/${overrideId}`),
}
