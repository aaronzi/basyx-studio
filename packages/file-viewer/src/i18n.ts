import type * as MonacoEditor from 'monaco-editor/editor'
import type { InjectionKey } from 'vue'
import { computed, inject, provide } from 'vue'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import nl from './locales/nl.json'
import zhHans from './locales/zh-Hans.json'

// The viewer's texts in Studio's seven UI locales (ADR 0026), so Studio and
// every app show the same ones. The host passes its locale; Studio's
// dialects (`de-saar`) use their language, and missing texts fall back to
// English.

interface Texts {
  [key: string]: string | Texts
}

const catalogs: Record<string, Texts> = { en, de, es, fr, ja, nl, 'zh-Hans': zhHans }

/** Monaco loaded with its workers set up, as `monaco-editor/editor` exports it. */
export type MonacoApi = typeof MonacoEditor

export interface FileViewerOptions {
  /** Studio's UI locale, e.g. `de` or `de-saar`. */
  locale: () => string
  /**
   * Loads Monaco with its workers set up, plus `@basyx/file-viewer/monaco`
   * for the languages. Without it, texts show without highlighting.
   */
  monaco?: () => Promise<MonacoApi>
}

export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface FileViewerContext {
  t: Translate
  /** The locale for `Intl`, e.g. numbers and sizes. */
  formatLocale: () => string
  monaco: (() => Promise<MonacoApi>) | null
}

// A registered symbol: the same key when the module is loaded again (hot
// reload) or twice (two copies of the package in one page).
const key: InjectionKey<FileViewerContext> = Symbol.for('@basyx/file-viewer')

function lookup (catalog: Texts | undefined, path: string): string | undefined {
  let node: Texts | string | undefined = catalog
  for (const name of path.split('.')) {
    if (typeof node !== 'object' || !Object.hasOwn(node, name)) {
      return undefined
    }
    node = node[name]
  }
  return typeof node === 'string' ? node : undefined
}

/** `de-saar` → `de`: Studio's dialects have a lower-case variant of four letters or more, unlike scripts (`zh-Hans`). */
function intlLocale (locale: string): string {
  return /^[a-z]{2,3}-[a-z]{4,}$/.test(locale) ? locale.split('-', 1)[0]! : locale
}

/** A translate function for a locale, without a component, e.g. for tests. Numbers are formatted for it. */
export function translator (locale: () => string): Translate {
  const chain = computed(() => {
    const code = locale()
    return [...new Set([code, code.split('-', 1)[0]!, 'en'])].filter(entry => Object.hasOwn(catalogs, entry))
  })
  return (path, params) => {
    let text = path
    for (const code of chain.value) {
      const found = lookup(catalogs[code], path)
      if (found !== undefined) {
        text = found
        break
      }
    }
    // "one | many", chosen by `count`.
    if (text.includes(' | ') && typeof params?.count === 'number') {
      const [one, many] = text.split(' | ')
      text = (params.count === 1 ? one : many) ?? text
    }
    if (!params) {
      return text
    }
    const numbers = new Intl.NumberFormat(intlLocale(locale()))
    return text.replaceAll(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name]
      return typeof value === 'number' ? numbers.format(value) : (value ?? match)
    })
  }
}

/** Provides the locale and Monaco to the viewer's components below. */
export function provideFileViewer (options: FileViewerOptions): FileViewerContext {
  const context: FileViewerContext = {
    t: translator(options.locale),
    formatLocale: () => intlLocale(options.locale()),
    monaco: options.monaco ?? null,
  }
  provide(key, context)
  return context
}

export function useFileViewerContext (): FileViewerContext {
  const context = inject(key, null)
  if (!context) {
    throw new Error('The file viewer needs provideFileViewer() in a parent component.')
  }
  return context
}

/** A file size for people: 1.2 MB, 340 KB, 12 B. */
export function formatSize (bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`
}
