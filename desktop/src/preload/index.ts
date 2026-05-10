import { contextBridge, ipcRenderer } from 'electron'

// Snapshot of a recent-project entry returned from the main process. Kept
// inline (not imported from a shared module) so the preload stays
// self-contained — preload bundles run before the renderer module graph
// is loaded.
interface RecentProject {
  path: string
  name: string
  lastOpened: string
}

// Helper: subscribe to a main→renderer event and return an unsubscribe fn.
// The pattern is identical for every menu signal, so factoring it removes
// ~5 boilerplate lines per handler.
function onMenuEvent(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electron', {
  getApiBaseUrl: (): Promise<string> =>
    ipcRenderer.invoke('api:base-url'),

  waitForApi: (): Promise<boolean> =>
    ipcRenderer.invoke('api:ready'),

  openFile: (filters: Electron.FileFilter[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-file', filters),

  openFiles: (filters: Electron.FileFilter[]): Promise<string[]> =>
    ipcRenderer.invoke('dialog:open-files', filters),

  readFile: (filePath: string): Promise<Buffer> =>
    ipcRenderer.invoke('fs:read-file', filePath),

  // Project file lifecycle — see desktop/src/main/index.ts for the
  // server-side handlers and CLAUDE.md "Project files" for the format spec.
  showProjectOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('project:open-dialog'),

  showProjectSaveDialog: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('project:save-dialog', defaultName),

  readProjectFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('project:read-file', filePath),

  writeProjectFile: (filePath: string, contents: string): Promise<void> =>
    ipcRenderer.invoke('project:write-file', filePath, contents),

  addRecentProject: (filePath: string, name: string): Promise<RecentProject[]> =>
    ipcRenderer.invoke('project:add-recent', filePath, name),

  getRecentProjects: (): Promise<RecentProject[]> =>
    ipcRenderer.invoke('project:get-recent'),

  // Menu signals — same shape as the existing onMenuImport* helpers but
  // routed through the shared ``onMenuEvent`` factory above.
  onMenuImportCpt: (cb: () => void) => onMenuEvent('menu:import-cpt', cb),
  onMenuImportBorehole: (cb: () => void) => onMenuEvent('menu:import-borehole', cb),

  onMenuProjectNew: (cb: () => void) => onMenuEvent('menu:project-new', cb),
  onMenuProjectOpen: (cb: () => void) => onMenuEvent('menu:project-open', cb),
  onMenuProjectSave: (cb: () => void) => onMenuEvent('menu:project-save', cb),
  onMenuProjectSaveAs: (cb: () => void) => onMenuEvent('menu:project-save-as', cb),
  onMenuProjectClose: (cb: () => void) => onMenuEvent('menu:project-close', cb),
  onMenuProjectOpenRecent: (cb: (path: string) => void) =>
    onMenuEvent('menu:project-open-recent', cb as (...a: unknown[]) => void),
})
