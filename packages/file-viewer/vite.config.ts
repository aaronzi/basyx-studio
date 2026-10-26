import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The Vue entries (./vue, ./viewer, ./model) as built output for publishing
// (ADR 0043, ADR 0052); `scripts/build-package.mjs` builds the core with tsc
// into the same dist/ first. Vue, Vuetify and the libraries stay imports, so
// an app's build resolves them once.
const external = /^(?:vue|vuetify|monaco-editor|pdfjs-dist|markdown-it|dompurify|@basyx\/model-viewer)(?:\/|$)/

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: { vue: 'src/vue.ts', viewer: 'src/viewer.ts', model: 'src/model.ts' },
      formats: ['es'],
    },
    rolldownOptions: { external: id => external.test(id) },
  },
})
