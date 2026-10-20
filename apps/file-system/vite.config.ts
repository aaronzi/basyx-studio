import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The UI in ui/ is built to dist/ui/ with relative URLs, as Studio serves
// it under /app/<installation>/ui/, and Vuetify gets Studio's Sass settings
// (studioApp(), ADR 0043). PDF.js is a chunk of its own, loaded when a PDF
// is shown (ADR 0050).
export default defineConfig({
  plugins: [vue(), studioApp()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
