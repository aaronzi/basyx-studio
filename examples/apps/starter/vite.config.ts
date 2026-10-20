import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// ui/ is built to dist/ui/ with Studio's Vuetify settings; `pnpm package`
// packages it with studio-app.json.
export default defineConfig({
  plugins: [vue(), studioApp()],
})
