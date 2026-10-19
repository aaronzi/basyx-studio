<template>
  <!-- Port of the Web UI's TimeRangeSelector: Grafana-style presets, a custom
       relative range and absolute datetime-local ranges. -->
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="bottom end"
    width="min(400px, calc(100vw - 32px))"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        :aria-label="t('timeRange.button', { label: buttonLabel })"
        :color="validationError ? 'error' : undefined"
        data-test="time-range"
        prepend-icon="mdi-clock-outline"
        size="small"
        variant="tonal"
        v-bind="menuProps"
      >
        {{ buttonLabel }}
        <v-icon end icon="mdi-menu-down" />
      </v-btn>
    </template>

    <v-card>
      <v-card-title class="d-flex align-center text-title-small">
        <span>{{ t('timeRange.title') }}</span>
        <v-spacer />

        <v-btn
          :aria-label="t('timeRange.close')"
          icon="mdi-close"
          size="x-small"
          @click="menuOpen = false"
        />
      </v-card-title>

      <v-card-text>
        <v-btn-toggle
          v-model="mode"
          class="d-flex mb-3"
          color="primary"
          density="compact"
          divided
          mandatory
          variant="outlined"
        >
          <v-btn class="flex-grow-1" value="relative">{{ t('timeRange.relative') }}</v-btn>
          <v-btn class="flex-grow-1" value="absolute">{{ t('timeRange.absolute') }}</v-btn>
        </v-btn-toggle>

        <template v-if="mode === 'relative'">
          <v-row class="mb-2" density="compact">
            <v-col v-for="preset in TIME_RANGE_PRESETS" :key="preset.id" cols="3">
              <v-btn
                :active="selectedPreset === preset.id"
                :aria-label="preset.id === 'custom' ? t('timeRange.customTitle') : t('timeRange.last', { range: preset.id })"
                block
                :color="selectedPreset === preset.id ? 'primary' : undefined"
                size="small"
                variant="outlined"
                @click="selectedPreset = preset.id"
              >
                {{ preset.id === 'custom' ? t('timeRange.custom') : preset.id }}
              </v-btn>
            </v-col>
          </v-row>

          <v-row v-if="selectedPreset === 'custom'" density="compact">
            <v-col cols="7">
              <div class="text-caption mb-1">{{ t('timeRange.range') }}</div>

              <v-text-field
                v-model.number="relativeValue"
                :aria-label="t('timeRange.range')"
                density="compact"
                hide-details="auto"
                min="0"
                step="any"
                type="number"
                variant="outlined"
              />
            </v-col>

            <v-col cols="5">
              <div class="text-caption mb-1">{{ t('timeRange.unit') }}</div>

              <v-row density="compact">
                <v-col v-for="unit in RELATIVE_TIME_UNITS" :key="unit" cols="3">
                  <v-btn
                    :active="relativeUnit === unit"
                    :aria-label="t(`units.${unit}`)"
                    block
                    :color="relativeUnit === unit ? 'primary' : undefined"
                    size="small"
                    slim
                    variant="outlined"
                    @click="relativeUnit = unit"
                  >
                    {{ RELATIVE_UNIT_SHORT[unit] }}
                  </v-btn>
                </v-col>
              </v-row>
            </v-col>
          </v-row>
        </template>

        <v-row v-else>
          <v-col cols="12">
            <v-text-field
              v-model="absoluteStart"
              density="compact"
              hide-details="auto"
              :label="t('timeRange.from')"
              type="datetime-local"
              variant="outlined"
            />
          </v-col>

          <v-col cols="12">
            <v-text-field
              v-model="absoluteStop"
              density="compact"
              hide-details="auto"
              :label="t('timeRange.to')"
              type="datetime-local"
              variant="outlined"
            />
          </v-col>
        </v-row>

        <div v-if="validationError" class="text-error text-caption mt-2" role="alert">
          {{ t(`validation.${validationError}`) }}
        </div>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script lang="ts" setup>
  import type { RelativeTimeUnit, TimeRangeSelection } from './timeRange'
  import { computed, ref, watch } from 'vue'
  import { useI18n } from './i18n'
  import {
    cloneTimeRangeSelection,
    findPreset,
    RELATIVE_TIME_UNITS,
    RELATIVE_UNIT_SHORT,
    TIME_RANGE_PRESETS,
    validateTimeRangeSelection,
  } from './timeRange'

  const props = defineProps<{
    modelValue: TimeRangeSelection
  }>()

  const emit = defineEmits<{
    'update:model-value': [value: TimeRangeSelection]
  }>()

  const { t } = useI18n()

  const mode = ref<TimeRangeSelection['mode']>(props.modelValue.mode)
  const menuOpen = ref(false)
  const selectedPreset = ref(findPreset(props.modelValue))
  const relativeValue = ref(props.modelValue.mode === 'relative' ? props.modelValue.value : 1)
  const relativeUnit = ref<RelativeTimeUnit>(props.modelValue.mode === 'relative' ? props.modelValue.unit : 'minutes')
  const absoluteStart = ref(props.modelValue.mode === 'absolute' ? props.modelValue.start : '')
  const absoluteStop = ref(props.modelValue.mode === 'absolute' ? props.modelValue.stop : '')

  const currentSelection = computed<TimeRangeSelection>(() => {
    if (mode.value === 'absolute') {
      return {
        mode: 'absolute',
        start: absoluteStart.value,
        stop: absoluteStop.value,
      }
    }

    const preset = TIME_RANGE_PRESETS.find(item => item.id === selectedPreset.value)
    if (preset?.value && preset.unit) {
      return {
        mode: 'relative',
        value: preset.value,
        unit: preset.unit,
      }
    }

    return {
      mode: 'relative',
      value: Number(relativeValue.value),
      unit: relativeUnit.value,
    }
  })

  const validationError = computed(() => validateTimeRangeSelection(currentSelection.value))
  const buttonLabel = computed(() => {
    const selection = currentSelection.value
    if (selection.mode === 'absolute') {
      return t('timeRange.absoluteRange')
    }
    return t('timeRange.last', { range: `${selection.value}${RELATIVE_UNIT_SHORT[selection.unit]}` })
  })

  watch(
    currentSelection,
    selection => emit('update:model-value', cloneTimeRangeSelection(selection)),
    { deep: true },
  )

  watch(
    () => props.modelValue,
    selection => {
      if (JSON.stringify(selection) === JSON.stringify(currentSelection.value)) {
        return
      }

      mode.value = selection.mode
      selectedPreset.value = findPreset(selection)
      if (selection.mode === 'relative') {
        relativeValue.value = selection.value
        relativeUnit.value = selection.unit
      } else {
        absoluteStart.value = selection.start
        absoluteStop.value = selection.stop
      }
    },
    { deep: true },
  )
</script>
