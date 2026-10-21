import type { StudioClient } from '@basyx/studio-sdk'
import type { InjectionKey, Ref } from 'vue'
import { computed, inject, provide, ref } from 'vue'

// Texts of Studio's apps in Studio's UI locales (ADR 0026). An app passes
// its base catalog (English unless `baseLocale` says otherwise) and the
// translations; the locale follows Studio's context, and missing texts fall
// back to the base catalog.

/** Texts in sections, nested to any depth: `section.key`, `section.group.key`. */
export interface Catalog {
  [key: string]: string | Catalog
}

/** The keys of the base catalog, nested as there; any of them may be missing. */
export type PartialCatalog<C extends Catalog> = { [Key in keyof C]?: PartialEntry<C[Key]> }

type PartialEntry<T> = T extends string ? string : T extends Catalog ? PartialCatalog<T> : never

export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface I18nOptions {
  /** The language of the base catalog, e.g. `de` (default `en`). */
  baseLocale?: string
}

export interface I18n {
  t: Translate
  /** Studio's UI locale, e.g. `de` or `de-saar`. */
  locale: Ref<string>
  /**
   * The locale of the catalog the texts come from, as a BCP 47 tag for
   * `Intl` and Vuetify: Studio's dialects (`de-saar`) as their language,
   * and the base locale where the app has no catalog for Studio's locale.
   * Numbers and dates formatted with it match the texts.
   */
  formatLocale: Readonly<Ref<string>>
}

const key: InjectionKey<I18n> = Symbol('i18n')

/** A catalog as `lookup` reads it, complete or partial. */
interface Texts {
  [key: string]: string | Texts | undefined
}

function lookup (catalog: Texts, path: string): string | undefined {
  let node: Texts | string | undefined = catalog
  for (const name of path.split('.')) {
    if (typeof node !== 'object' || !Object.hasOwn(node, name)) {
      return undefined
    }
    node = node[name]
  }
  return typeof node === 'string' ? node : undefined
}

/** `de-saar` → `de`: Studio's dialects have a lower-case variant of four letters or more, unlike scripts (`zh-Hans`) and regions. */
function intlLocale (locale: string): string {
  return /^[a-z]{2,3}-[a-z]{4,}$/.test(locale) ? locale.split('-', 1)[0]! : locale
}

/** Provides `t` and the locales to the app's components. */
export function provideI18n<C extends Catalog> (client: StudioClient, base: C, translations: Record<string, PartialCatalog<C>>, options: I18nOptions = {}): I18n {
  const baseLocale = options.baseLocale ?? 'en'
  const catalogs: Record<string, Texts> = { ...translations, [baseLocale]: base }
  const locale = ref(client.context.locale)
  client.onContext(context => {
    locale.value = context.locale
  })
  // Studio's locale, then its language (the German dialects use German), then the base catalog.
  const chain = computed(() => {
    const language = locale.value.split('-', 1)[0]!
    return [...new Set([locale.value, language, baseLocale])].filter(code => Object.hasOwn(catalogs, code))
  })
  const formatLocale = computed(() => intlLocale(chain.value[0]!))
  const t: Translate = (path, params) => {
    let text: string | undefined
    for (const code of chain.value) {
      text = lookup(catalogs[code]!, path)
      if (text !== undefined) {
        break
      }
    }
    text ??= path
    return params ? text.replaceAll(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
  }
  const i18n = { t, locale, formatLocale }
  provide(key, i18n)
  return i18n
}

export function useI18n (): I18n {
  const i18n = inject(key)
  if (!i18n) {
    throw new Error('useI18n needs provideI18n in a parent component.')
  }
  return i18n
}
