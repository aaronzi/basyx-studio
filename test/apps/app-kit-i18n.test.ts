import type { Catalog, I18nOptions, PartialCatalog } from '@basyx/studio-app-kit/i18n'
import { provideI18n } from '@basyx/studio-app-kit/i18n'
import { createTestStudio } from '@basyx/studio-sdk/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The app kit's texts (external apps follow-up plan L1–L3): a base catalog
// in any language, the locale for numbers and dates, and nested keys.

const en = {
  shells: {
    title: 'Shells in {target}',
    none: 'No shells',
    counts: { instances: 'Instances', types: 'Types' },
  },
}
const de = { shells: { title: 'Verwaltungsschalen in {target}', counts: { instances: 'Instanzen' } } }
// An app whose first language is German, with a partial English translation.
const deBase = { shells: { title: 'Verwaltungsschalen in {target}', counts: { instances: 'Instanzen', types: 'Typen' } } }
const enPartial = { shells: { counts: { instances: 'Instances' } } }

beforeEach(() => {
  // Outside a component, Vue warns about provide().
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return () => vi.restoreAllMocks()
})

function i18nIn<C extends Catalog> (locale: string, base: C, translations: Record<string, PartialCatalog<C>>, options?: I18nOptions) {
  const studio = createTestStudio({ context: { locale } })
  return { studio, i18n: provideI18n(studio.client, base, translations, options) }
}

describe('provideI18n', () => {
  it('falls back to the English base catalog, as before', () => {
    const { i18n } = i18nIn('de', en, { de })
    expect(i18n.t('shells.title', { target: 'Demo' })).toBe('Verwaltungsschalen in Demo')
    expect(i18n.t('shells.none')).toBe('No shells')
    expect(i18n.formatLocale.value).toBe('de')
  })

  it('reads nested keys at any depth, and names a missing one', () => {
    const { i18n } = i18nIn('de', en, { de })
    expect(i18n.t('shells.counts.instances')).toBe('Instanzen')
    expect(i18n.t('shells.counts.types')).toBe('Types')
    expect(i18n.t('shells.counts')).toBe('shells.counts')
    expect(i18n.t('shells.missing.key')).toBe('shells.missing.key')
  })

  it('falls back to a German base catalog and formats in German', () => {
    const { i18n } = i18nIn('fr', deBase, { en: enPartial }, { baseLocale: 'de' })
    expect(i18n.t('shells.title', { target: 'Demo' })).toBe('Verwaltungsschalen in Demo')
    expect(i18n.formatLocale.value).toBe('de')
    expect(new Intl.NumberFormat(i18n.formatLocale.value).format(1234.5)).toBe('1.234,5')
  })

  it('uses a translation of a German base catalog where there is one', () => {
    const { i18n, studio } = i18nIn('de', deBase, { en: enPartial }, { baseLocale: 'de' })
    expect(i18n.t('shells.counts.instances')).toBe('Instanzen')
    studio.setContext({ locale: 'en' })
    expect(i18n.t('shells.counts.instances')).toBe('Instances')
    expect(i18n.t('shells.counts.types')).toBe('Typen')
    expect(i18n.formatLocale.value).toBe('en')
  })

  it('formats in the language of the texts: a dialect as its language, an untranslated locale as the base', () => {
    const { i18n, studio } = i18nIn('de-saar', en, { de, 'zh-Hans': { shells: { none: '没有' } } })
    expect(i18n.t('shells.title', { target: 'Demo' })).toBe('Verwaltungsschalen in Demo')
    expect(i18n.locale.value).toBe('de-saar')
    expect(i18n.formatLocale.value).toBe('de')
    studio.setContext({ locale: 'zh-Hans' })
    expect(i18n.formatLocale.value).toBe('zh-Hans')
    studio.setContext({ locale: 'ja' })
    expect(i18n.t('shells.none')).toBe('No shells')
    expect(i18n.formatLocale.value).toBe('en')
  })

  it('prefers a dialect\'s own catalog, then its language', () => {
    const { i18n } = i18nIn('de-saar', en, { de, 'de-saar': { shells: { none: 'Nix do' } } })
    expect(i18n.t('shells.none')).toBe('Nix do')
    expect(i18n.t('shells.counts.instances')).toBe('Instanzen')
    expect(i18n.formatLocale.value).toBe('de')
  })
})
