import type { FileGrant } from '#shared/contract'

/** The native bridge exposed by the Electron preload (electron/preload.ts). */
export interface DesktopBridge {
  chooseAasxFile: () => Promise<FileGrant | null>
  chooseSaveLocation: (suggestedName: string) => Promise<FileGrant | null>
}

declare global {
  interface Window {
    studioDesktop?: DesktopBridge
  }
}

/** The desktop bridge, or `null` in a browser and during SSR. */
export function useDesktopBridge (): DesktopBridge | null {
  return import.meta.client ? (window.studioDesktop ?? null) : null
}
