/** A view Studio itself offers in the Visualization tab, before the app views. */
export interface BuiltInView {
  id: string
  title: string
  icon: string
}

/** The file view of a File or Blob element (ADR 0052): images, PDF, text, 3D models and more. */
export const fileViewId = 'studio:file'

/** View ids of earlier versions, still in links: the 3D view became the file view. */
export const legacyViewIds: Record<string, string> = { 'studio:model-3d': fileViewId }
