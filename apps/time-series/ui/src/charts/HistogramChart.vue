<template>
  <!-- The Web UI's Histogram: bins and a stacked switch as options. -->
  <div>
    <div class="text-title-small mb-2">{{ t('chart.options') }}</div>

    <v-row align="center">
      <v-col cols="12" md="4" sm="6">
        <v-text-field
          v-model="binsInput"
          data-test="bins"
          density="compact"
          :error-messages="binsError"
          hide-details="auto"
          :label="t('chart.bins')"
          :max="MAX_HISTOGRAM_BINS"
          min="1"
          step="1"
          type="number"
          variant="outlined"
          @blur="applyBins"
          @keydown.enter="applyBins"
        />
      </v-col>

      <v-col cols="auto">
        <v-switch
          v-model="stacked"
          color="primary"
          density="compact"
          hide-details
          :label="t('chart.stacked')"
        />
      </v-col>
    </v-row>

    <div ref="container" data-test="histogram-chart" />
  </div>
</template>

<script lang="ts" setup>
  import type { ChartSeries } from '../timeseries'
  import type { ThemeTokens } from '@basyx/studio-sdk'
  import ApexCharts from 'apexcharts'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { apexLocale, histogramOptions, histogramSeries, themeOptions } from '../chartOptions'
  import { useI18n } from '../i18n'
  import { DEFAULT_HISTOGRAM_BINS, histogramData, MAX_HISTOGRAM_BINS, parseBins } from '../timeseries'

  const props = defineProps<{
    series: ChartSeries[]
    theme: ThemeTokens
    locale: string
  }>()

  const { t } = useI18n()

  const container = ref<HTMLElement | null>(null)
  const bins = ref(DEFAULT_HISTOGRAM_BINS)
  const binsInput = ref<string | number>(DEFAULT_HISTOGRAM_BINS)
  const stacked = ref(false)
  const binsError = computed(() => (parseBins(binsInput.value) === null ? t('validation.bins', { max: MAX_HISTOGRAM_BINS }) : undefined))

  let chart: ApexCharts | null = null

  function render (): void {
    const data = histogramData(props.series, bins.value)
    if (!container.value || data.histograms.length === 0) {
      return
    }
    chart = new ApexCharts(container.value, histogramOptions({
      data,
      series: props.series,
      stacked: stacked.value,
      theme: props.theme,
      locale: props.locale,
    }))
    void chart.render()
  }

  function update (): void {
    if (!chart) {
      render()
      return
    }
    const data = histogramData(props.series, bins.value)
    if (data.histograms.length === 0) {
      return
    }
    void chart.updateSeries(histogramSeries({ data, series: props.series }), true)
    void chart.updateOptions({ xaxis: { categories: data.categories } })
  }

  /** The Web UI applies the bins on blur and Enter. */
  function applyBins (): void {
    const value = parseBins(binsInput.value)
    if (value !== null && value !== bins.value) {
      bins.value = value
      update()
    }
  }

  onMounted(render)

  onBeforeUnmount(() => {
    chart?.destroy()
    chart = null
  })

  watch(() => props.series, update)

  watch(stacked, value => {
    void chart?.updateOptions({ chart: { stacked: value } })
  })

  watch(
    () => JSON.stringify(props.theme),
    () => {
      void chart?.updateOptions(themeOptions(props.theme), false, true)
    },
  )

  watch(
    () => props.locale,
    locale => chart?.setLocale(apexLocale(locale)),
  )
</script>
