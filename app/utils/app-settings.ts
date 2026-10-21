import type { AppSettingSummary, AppSettingValue, AppSettingValues } from '#shared/contract'

// The forms of apps' settings (ADR 0048), on the Apps page per installation
// and in the infrastructure dialog per infrastructure. A field without a
// value is `null`, so the fallback applies; an empty text or list is a value
// of its own, which wins over the fallback as on Studio's server. The server
// checks every value against the installed manifest, these checks only say
// early what it would refuse.

export type SettingFormValues = Record<string, AppSettingValue | null>

/** Whether a field is set, also to an empty text or list; `null` leaves the fallback. */
export function isSettingSet (value: AppSettingValue | null | undefined): value is AppSettingValue {
  return value !== null && value !== undefined
}

/** Whether a value has content: not unset, and not an empty text or list. */
export function hasSettingValue (value: AppSettingValue | null | undefined): value is AppSettingValue {
  return isSettingSet(value) && value !== '' && !(Array.isArray(value) && value.length === 0)
}

/** The form's values to save: every field that is set, empty ones included. */
export function settingValuesOf (form: SettingFormValues): AppSettingValues {
  return Object.fromEntries(Object.entries(form).filter((entry): entry is [string, AppSettingValue] => isSettingSet(entry[1])))
}

/** A copy of saved values to edit; lists are copied too. */
export function copySettingValues (values: AppSettingValues): SettingFormValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]))
}

/** A form for the settings, filled with the saved values. */
export function settingFormOf (settings: readonly AppSettingSummary[], values: AppSettingValues): SettingFormValues {
  const copy = copySettingValues(values)
  return Object.fromEntries(settings.map(setting => [setting.key, copy[setting.key] ?? null]))
}

/** Which check a value fails, as a key below `apps.settings.invalid`; `null` when the setting accepts it. */
export function settingProblem (setting: Pick<AppSettingSummary, 'type' | 'enum'>, value: AppSettingValue | null): 'text' | 'number' | 'boolean' | 'list' | 'enum' | null {
  if (!isSettingSet(value)) {
    return null
  }
  const inEnum = (item: string) => !setting.enum || setting.enum.includes(item)
  switch (setting.type) {
    case 'string': {
      if (typeof value !== 'string' || value.length > 2000) {
        return 'text'
      }
      return inEnum(value) ? null : 'enum'
    }
    case 'number': {
      return typeof value === 'number' && Number.isFinite(value) ? null : 'number'
    }
    case 'boolean': {
      return typeof value === 'boolean' ? null : 'boolean'
    }
    case 'stringList': {
      if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 2000)) {
        return 'list'
      }
      return value.every(item => inEnum(item)) ? null : 'enum'
    }
  }
}

/**
 * The keys of an infrastructure's values that the installed version does not
 * take per infrastructure: removed settings, and settings now set per
 * installation. Studio ignores them; the dialog drops them on save (ADR 0048).
 */
export function obsoleteSettingKeys (settings: readonly AppSettingSummary[], values: SettingFormValues): string[] {
  const own = new Set(settings.filter(setting => setting.scope === 'infrastructure').map(setting => setting.key))
  return Object.keys(values).filter(key => isSettingSet(values[key]) && !own.has(key))
}

/** The values of one app's settings on an infrastructure, as the dialog edits them. */
export interface InfrastructureAppSettingsForm {
  app: string
  values: SettingFormValues
}
