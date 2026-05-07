// Typed fetch wrappers for the Ground Model FastAPI backend.

export interface CptListItem {
  id: string
  name: string
  cpt_type: string
  max_depth_m: number | null
  n_rows: number | null
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
}

export interface ImportCptResponse {
  cpt_id: string
  has_errors: boolean
  issues: { level: string; code: string; message: string; rows: number[] }[]
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

export const api = {
  cpt: {
    list: (): Promise<CptListItem[]> => get('/cpt/'),

    get: (id: string): Promise<CptResponse> => get(`/cpt/${id}`),

    plot: (id: string): Promise<CptPlotResponse> => get(`/cpt/${id}/plot`),

    import: async (filePath: string): Promise<ImportCptResponse> => {
      // Read via IPC — fetch('file://') is blocked in the renderer sandbox.
      const buffer: Buffer = await window.electron.readFile(filePath)
      const fileName = filePath.split(/[\\/]/).pop() ?? 'upload.gef'
      const blob = new Blob([buffer])
      const form = new FormData()
      form.append('file', blob, fileName)
      const res = await fetch(`${_base}/cpt/import`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Import failed: ${res.status}`)
      return res.json()
    }
  }
}
