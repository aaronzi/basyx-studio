import type { AppSettingSummary } from '#shared/contract'
import { describe, expect, it } from 'vitest'
import { copySettingValues, obsoleteSettingKeys, settingFormOf, settingProblem, settingValuesOf } from '~~/app/utils/app-settings'

// The forms of apps' settings on the Apps page and in the infrastructure
// dialog (ADR 0048).

function setting (key: string, overrides: Partial<AppSettingSummary> = {}): AppSettingSummary {
  return { key, type: 'string', title: { en: key }, description: null, enum: null, default: null, required: false, scope: 'infrastructure', ...overrides }
}

describe('app settings forms', () => {
  it('keep empty values apart from unset fields, as the server resolves them', () => {
    expect(settingValuesOf(copySettingValues({ assetTypes: [], siteId: '', pageSize: 25 }))).toEqual({ assetTypes: [], siteId: '', pageSize: 25 })
    const form = settingFormOf([setting('siteId'), setting('assetTypes', { type: 'stringList' }), setting('label')], { siteId: '', assetTypes: [] })
    expect(form).toEqual({ siteId: '', assetTypes: [], label: null })
    expect(settingValuesOf(form)).toEqual({ siteId: '', assetTypes: [] })
  })

  it('check empty values too', () => {
    expect(settingProblem(setting('units', { enum: ['metric'] }), '')).toBe('enum')
    expect(settingProblem(setting('units', { enum: ['metric'] }), null)).toBeNull()
    expect(settingProblem(setting('assetTypes', { type: 'stringList' }), [])).toBeNull()
  })

  it('find the values an installed version no longer takes per infrastructure', () => {
    const settings = [setting('assetTypes', { type: 'stringList' }), setting('pageSize', { type: 'number', scope: 'installation' })]
    expect(obsoleteSettingKeys(settings, { assetTypes: ['urn:example:pump'], pageSize: 10, siteId: 'north', label: null })).toEqual(['pageSize', 'siteId'])
  })
})
