// Typed fetch wrappers for the Ground Model FastAPI backend.
export interface CptListItem {
  id: string
  name: string
  cpt_type: string
  max_depth_m: number | null
  n_rows: number | null
  location_x: number
  location_y: number
  epsg: number | null
}

export interface CptResponse {
  id: string
  name: string
  cpt_type: string
  location_x: number
  location_y: number
  epsg: number | null
  elevation_m: number | null
  pre_drill_m: number
  cone_area_ratio: number | null
  max_depth_m: number | null
  n_rows: number | null
}

export interface CptPlotResponse {
  cpt_id: string
  depths_m: number[]
  qc_mpa: number[]
  fs_mpa: (number | null)[] | null
  u2_mpa: (number | null)[] | null
  rf_pct: (number | null)[] | null
  qt_mpa: (number | null)[] | null
  ic: (number | null)[] | null
}

export interface ImportCptResponse {
  cpt_id: string
  has_errors: boolean
  issues: { level: string; code: string; message: string; rows: number[] }[]
}

export interface ImportDovResponse {
  imported: number
  duplicates: number
  failed: number
  cpt_ids: string[]
}

export class DuplicateCptError extends Error {
  cptId: string
  constructor(cptId: string) {
    super('CPT already exists in this project')
    this.name = 'DuplicateCptError'
    this.cptId = cptId
  }
}

let _base = 'http://127.0.0.1:8765'

export function setBaseUrl(url: string): void {
  _base = url
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${_base}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`)
}

export const api = {
  cpt: {
    list: (projectId?: string): Promise<CptListItem[]> =>
      get(`/cpt/${projectId ? `?project_id=${projectId}` : ''}`),

    get: (id: string): Promise<CptResponse> => get(`/cpt/${id}`),

    plot: (id: string): Promise<CptPlotResponse> => get(`/cpt/${id}/plot`),

    delete: (id: string): Promise<void> => del(`/cpt/${id}`),

    importDov: async (
      bbox: { west: number; south: number; east: number; north: number },
      projectId?: string,
    ): Promise<ImportDovResponse> => {
      const res = await fetch(`${_base}/cpt/import-dov`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bbox, project_id: projectId ?? null }),
      })
      if (!res.ok) {
        // FastAPI surfaces specific reasons (network down, timeout, upstream error)
        // in body.detail; fall back to status code if the body is unparseable.
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `DOV import failed (HTTP ${res.status})`)
      }
      return res.json()
    },

    import: async (filePath: string, projectId?: string): Promise<ImportCptResponse> => {
      // Read via IPC — fetch('file://') is blocked in the renderer sandbox.
      const buffer: Buffer = await window.electron.readFile(filePath)
      const fileName = filePath.split(/[\\/]/).pop() ?? 'upload.gef'
      const blob = new Blob([buffer])
      const form = new FormData()
      form.append('file', blob, fileName)
      if (projectId) form.append('project_id', projectId)
      const res = await fetch(`${_base}/cpt/import`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 409 && body.detail?.cpt_id) {
          throw new DuplicateCptError(body.detail.cpt_id)
        }
        throw new Error(body.detail?.message ?? body.detail ?? `Import failed: ${res.status}`)
      }
      return res.json()
    },
  },
}
