import { contextBridge, ipcRenderer } from 'electron'

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

  onMenuImportCpt: (cb: () => void) => {
    ipcRenderer.on('menu:import-cpt', cb)
    return () => ipcRenderer.removeListener('menu:import-cpt', cb)
  },

  onMenuImportBorehole: (cb: () => void) => {
    ipcRenderer.on('menu:import-borehole', cb)
    return () => ipcRenderer.removeListener('menu:import-borehole', cb)
  }
})
