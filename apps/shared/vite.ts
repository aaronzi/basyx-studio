import type { Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Studio compiles Vuetify's Sass with app/assets/styles/settings.scss
// (14 px fields, 16 px card titles, denser lists, button weight). Vuetify's
// precompiled CSS uses the stock settings, so apps built with it look
// different inside Studio. This plugin swaps each Vuetify stylesheet for
// its Sass source compiled with Studio's settings, as vite-plugin-vuetify's
// `styles.configFile` does, so the apps shipped with Studio match it.

const settings = fileURLToPath(new URL('../../app/assets/styles/settings.scss', import.meta.url))
const prefix = 'virtual:studio-vuetify:'

export function vuetifySettings (): Plugin {
  return {
    name: 'studio-vuetify-settings',
    enforce: 'pre',
    async resolveId (source, importer) {
      let css: string | undefined
      if (source === 'vuetify/styles') {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- the Vite plugin context
        css = (await this.resolve('vuetify/lib/styles/main.css', importer, { skipSelf: true }))?.id
      } else if (source.endsWith('.css') && importer && /[/\\]vuetify[/\\]lib[/\\]/.test(importer)) {
        css = resolve(dirname(importer), source)
      }
      const sass = css?.replace(/\.css$/, '.sass')
      return sass && existsSync(sass) ? `${prefix}${sass}` : null
    },
    load (id) {
      if (!id.startsWith(prefix)) {
        return null
      }
      const file = id.slice(prefix.length)
      const layers = file.replace(/([/\\]vuetify[/\\]lib[/\\]).*$/, '$1styles/generic/_layers.scss')
      // The settings first, so Vuetify's settings module is configured before
      // the stylesheet uses it. Then the order of Vuetify's cascade layers:
      // apps load component styles before vuetify/styles, which would put the
      // reset layer above the components (buttons lose their weight and size).
      return `@use '${settings}'\n@use '${layers}'\n@use '${file}'\n`
    },
  }
}
