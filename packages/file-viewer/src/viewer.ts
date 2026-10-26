// The file viewer component (ADR 0052): one file of any kind, inline or
// full-screen. It loads PDF.js and the 3D viewer when a file needs them, so a
// build that imports it holds them; thumbnails alone come from `./vue`.

export { default as FileViewer } from './components/FileViewer.vue'
