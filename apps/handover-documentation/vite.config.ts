import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The UI in ui/ is built to dist/ui/ with relative URLs, as Studio serves
// it under /app/<installation>/ui/, and Vuetify gets Studio's Sass settings
// (studioApp(), ADR 0043).
// The file viewer brings PDF.js and, for documents that are 3D models, the
// 3D viewer's parser worker and its WebAssembly files (ADR 0038, ADR 0052),
// each loaded only for its files.
export default defineConfig({
  plugins: [vue(), studioApp()],
  build: {
    chunkSizeWarningLimit: 8000,
  },
})
