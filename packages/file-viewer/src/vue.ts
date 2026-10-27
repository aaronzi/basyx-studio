// The file viewer in Vue and Vuetify, for Studio and its apps (ADR 0052):
// `provideFileViewer()` once, then a state per file, `FileThumbnail` for
// small pictures, and `FileViewer` from `@basyx/file-viewer/viewer` wherever
// a file shows. This entry stays light: the viewer's PDF and 3D parts
// (PDF.js, three.js, WebAssembly parsers) come only with `./viewer`. Its
// components import the Vuetify components they use, so an app need not
// register them.

export { default as FileThumbnail } from './components/FileThumbnail.vue'
export * from './i18n.ts'
export * from './state.ts'
