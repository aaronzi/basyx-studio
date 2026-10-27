// The 3D view in parts (ADR 0052), for an app that draws its own frame
// around it, as the 3D Models app does: `useModelView` for the viewer and
// its problem texts, `ModelCanvas` for the canvas with its loading state,
// and `ModelElementPanel` for a picked IFC element. Studio's file view is
// built from the same parts. Needs `provideFileViewer()` for the texts.

export { default as ModelCanvas } from './components/ModelCanvas.vue'
export { default as ModelElementPanel } from './components/ModelElementPanel.vue'
export * from './model-view.ts'
