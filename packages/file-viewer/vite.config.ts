import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The Vue entries (./vue, ./viewer, ./model) as built output for publishing
// (ADR 0043, ADR 0052); `scripts/build-package.mjs` builds the core and the
// 3D engine (src/model/) with tsc into the same dist/ first. Vue, Vuetify and
// the libraries stay imports, so an app's build resolves them once; the
// engine stays an import of its tsc output, so its WebAssembly and worker
// remain the `?url` imports an app's Vite resolves, never inlined here.
const libraries = /^(?:vue|vuetify|monaco-editor|pdfjs-dist|markdown-it|dompurify|three|web-ifc|occt-import-js)(?:\/|$)/
const engine = fileURLToPath(new URL('src/model/', import.meta.url))

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
    rolldownOptions: {
      external: (id, _importer, resolved) => libraries.test(id) || (resolved && id.startsWith(engine)),
      output: {
        // dist/ is flat for these entries and their chunks; the engine is in dist/model/.
        paths: id => (id.startsWith(engine) ? `./model/${relative(engine, id).replace(/\.ts$/, '.js')}` : id),
      },
    },
  },
})
