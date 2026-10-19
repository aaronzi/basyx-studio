import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { vuetifySettings } from '../shared/vite.ts'

// The UI is served under /app/<installation>/ui/, so every URL is relative.
// The 3D viewer's parser worker is a module (ADR 0038); its WebAssembly
// files are assets of the package.
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [vue(), vuetifySettings()],
  worker: { format: 'es' },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
})
