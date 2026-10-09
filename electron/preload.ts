// The renderer's only native bridge (SEC-009). It exposes two calls that let
// the user pick a file in a native dialog and return an opaque, single-use
// handle; the renderer never sees a native path.
import { contextBridge, ipcRenderer } from 'electron'

export interface StudioFileGrant {
  handle: string
  fileName: string
}

export interface StudioDesktopBridge {
  chooseAasxFile: () => Promise<StudioFileGrant | null>
  chooseSaveLocation: (suggestedName: string) => Promise<StudioFileGrant | null>
}

const bridge: StudioDesktopBridge = {
  chooseAasxFile: () => ipcRenderer.invoke('studio:choose-aasx-file'),
  chooseSaveLocation: suggestedName => ipcRenderer.invoke('studio:choose-save-location', String(suggestedName).slice(0, 255)),
}

contextBridge.exposeInMainWorld('studioDesktop', bridge)
