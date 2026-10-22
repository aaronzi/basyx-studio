<template>
  <!-- A set field, also an empty one, wins over the fallback (ADR 0048).
       Clearing a text or a single choice unsets it; lists, where removing
       every item leaves an empty list, have a reset action. -->
  <v-select
    v-if="setting.type === 'boolean'"
    clearable
    :hint="hint"
    :items="booleanItems"
    :label="title"
    :model-value="value"
    persistent-hint
    :readonly="readonly"
    :rules="[rule]"
    @update:model-value="update"
  />

  <v-select
    v-else-if="setting.enum"
    :append-icon="setting.type === 'stringList' ? resetIcon : undefined"
    :chips="setting.type === 'stringList'"
    :clearable="setting.type === 'string'"
    :closable-chips="setting.type === 'stringList' && !readonly"
    :hint="hint"
    :items="setting.enum"
    :label="title"
    :model-value="choice"
    :multiple="setting.type === 'stringList'"
    persistent-hint
    :readonly="readonly"
    :rules="[rule]"
    @click:append="reset"
    @update:model-value="update"
  />

  <v-combobox
    v-else-if="setting.type === 'stringList'"
    :append-icon="resetIcon"
    chips
    :closable-chips="!readonly"
    :hint="hint"
    :label="title"
    :model-value="list"
    multiple
    persistent-hint
    :readonly="readonly"
    :rules="[rule]"
    @click:append="reset"
    @update:model-value="update"
  />

  <v-text-field
    v-else-if="setting.type === 'number'"
    clearable
    :hint="hint"
    :label="title"
    :model-value="isSettingSet(value) ? String(value) : ''"
    persistent-hint
    :readonly="readonly"
    :rules="[rule]"
    type="number"
    @update:model-value="text => update(toNumber(text))"
  />

  <v-text-field
    v-else
    clearable
    :hint="hint"
    :label="title"
    :model-value="typeof value === 'string' ? value : ''"
    persistent-hint
    :placeholder="isSettingSet(value) ? undefined : fallbackText"
    :readonly="readonly"
    :rules="[rule]"
    @update:model-value="update"
  />
</template>

<script lang="ts" setup>
  import type { AppSettingSummary, AppSettingValue } from '#shared/contract'
  import { hasSettingValue, isSettingSet, settingProblem } from '~/utils/app-settings'

  // One setting of an app (ADR 0048) as a field: text, number, a choice for
  // booleans and `enum`, chips for lists. Without a value here (`null`), the
  // fallback applies; an empty text or list is a value that replaces it.
  // Clearing a text, number or choice, or the reset action, unsets the field.
  const props = defineProps<{
    setting: AppSettingSummary
    /** What applies without a value here: the installation's value or the default; `null` for none. */
    fallback: AppSettingValue | null
    /** Where the field is: per installation, an `infrastructure` setting says that infrastructures may set their own. */
    level: 'installation' | 'infrastructure'
    readonly?: boolean
  }>()
  // `undefined` for a key the form does not hold yet.
  const value = defineModel<AppSettingValue | null | undefined>({ required: true })

  const { t } = useI18n()
  const label = useLocalizedLabel()

  const title = computed(() => label(props.setting.title))
  /** The value of a choice: one item, or several for a list. */
  const choice = computed(() => typeof value.value === 'string' || Array.isArray(value.value) ? value.value : null)
  const list = computed(() => Array.isArray(value.value) ? value.value : [])
  const booleanItems = computed(() => [{ value: true, title: t('apps.settings.yes') }, { value: false, title: t('apps.settings.no') }])

  function format (entry: AppSettingValue | null): string {
    if (!isSettingSet(entry)) {
      return t('apps.settings.none')
    }
    if (!hasSettingValue(entry)) {
      return t('apps.settings.empty')
    }
    if (typeof entry === 'boolean') {
      return entry ? t('apps.settings.yes') : t('apps.settings.no')
    }
    return Array.isArray(entry) ? entry.join(', ') : String(entry)
  }

  const fallbackText = computed(() => format(props.fallback))
  /** Unsets a list, where removing every item leaves an empty list instead. */
  const resetIcon = computed(() => isSettingSet(value.value) && !props.readonly ? 'mdi-restore' : undefined)

  function reset () {
    value.value = null
  }

  const hint = computed(() => [
    props.setting.description ? label(props.setting.description) : null,
    props.setting.required ? t('apps.settings.required') : null,
    props.level === 'installation' && props.setting.scope === 'infrastructure' ? t('apps.settings.perInfrastructure') : null,
    // A set field, also an empty one, replaces the fallback.
    isSettingSet(value.value) ? t('apps.settings.replaces', { value: fallbackText.value }) : t('apps.settings.fallback', { value: fallbackText.value }),
  ].filter(Boolean).join(' · '))

  function toNumber (text: string | null): number | string | null {
    if (!text?.trim()) {
      return null
    }
    const number = Number(text)
    return Number.isFinite(number) ? number : text
  }

  function update (next: unknown) {
    value.value = (next ?? null) as AppSettingValue | null
  }

  function rule (): true | string {
    const problem = settingProblem(props.setting, value.value ?? null)
    return problem === null || t(`apps.settings.invalid.${problem}`, { values: props.setting.enum?.join(', ') ?? '' })
  }
</script>
