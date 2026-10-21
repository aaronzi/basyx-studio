import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The UI in ui/ is built to dist/ui/ with Studio's Vuetify settings
// (studioApp(), ADR 0043). The viewer registers only the IFC parser, so the
// build holds web-ifc's WebAssembly and worker, and none of STEP's.
export default defineConfig({
  plugins: [vue(), studioApp()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
