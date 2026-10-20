import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The UI in ui/ is built to dist/ui/ with relative URLs, as Studio serves
// it under /app/<installation>/ui/, and Vuetify gets Studio's Sass settings
// (studioApp(), ADR 0043).
// The 3D viewer's parser worker is a module (ADR 0038); its WebAssembly
// files are assets of the package. The preset builds occt-import-js
// without `new Function`, which the app's CSP forbids, in the worker too.
export default defineConfig({
  plugins: [vue(), studioApp()],
  build: {
    chunkSizeWarningLimit: 8000,
  },
})
