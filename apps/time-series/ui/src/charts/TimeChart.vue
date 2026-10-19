<template>
  <!-- The Web UI's LineChart, AreaChart and ScatterChart in one component.
       Line and area charts have the interpolation option. -->
  <div>
    <template v-if="type !== 'scatter'">
      <div class="text-title-small mb-2">{{ t('chart.options') }}</div>

      <v-row align="center">
        <v-col cols="12" md="4" sm="6">
          <v-select
            v-model="curve"
            data-test="interpolation"
            density="compact"
            hide-details
            :items="curveItems"
            :label="t('chart.interpolation')"
            variant="outlined"
          />
        </v-col>
      </v-row>
    </template>

    <div ref="container" data-test="time-chart" />
  </div>
</template>

<script lang="ts" setup>
  import type { Interpolation, TimeChartType } from '../chartOptions'
  import type { ResolvedTimeRange } from '../timeRange'
  import type { ChartSeries } from '../timeseries'
  import type { ThemeTokens } from '@basyx/studio-sdk'
  import type { ApexOptions } from 'apexcharts'
  import ApexCharts from 'apexcharts'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { apexLocale, apexSeries, INTERPOLATIONS, markerStroke, seriesLabels, themeOptions, timeChartOptions } from '../chartOptions'
  import { useI18n } from '../i18n'
  import { toApexTimeRange } from '../timeRange'

  const props = defineProps<{
    type: TimeChartType
    series: ChartSeries[]
    range: ResolvedTimeRange | null
    theme: ThemeTokens
    locale: string
    /** Changes when a different time range is committed: the viewport is reset (Web UI). */
    viewportResetKey: string
  }>()

  const { t } = useI18n()

  const container = ref<HTMLElement | null>(null)
  const curve = ref<Interpolation>('smooth')
  const curveItems = computed(() => INTERPOLATIONS.map(value => ({ title: t(`interpolation.${value}`), value })))

  let chart: ApexCharts | null = null
  let isViewportZoomed = false
  let lastViewportResetKey = props.viewportResetKey

  function render (): void {
    if (!container.value) {
      return
    }
    chart = new ApexCharts(container.value, timeChartOptions({
      type: props.type,
      series: props.series,
      range: props.range,
      theme: props.theme,
      locale: props.locale,
      curve: curve.value,
      events: {
        beforeResetZoom: () => {
          isViewportZoomed = false
          queueMicrotask(() => chart?.updateOptions({ xaxis: toApexTimeRange(props.range) }))
        },
        scrolled: () => {
          isViewportZoomed = true
        },
        zoomed: () => {
          isViewportZoomed = true
        },
      },
    }))
    void chart.render()
  }

  onMounted(render)

  onBeforeUnmount(() => {
    chart?.destroy()
    chart = null
  })

  watch(
    () => props.series,
    series => {
      if (!chart) {
        render()
        return
      }
      void chart.updateSeries(apexSeries(series), true)
      void chart.updateOptions(seriesLabels(series))
    },
  )

  // A refresh keeps the user's zoom; a newly committed range resets it (Web UI).
  watch(
    [() => props.range, () => props.viewportResetKey],
    ([range]) => {
      if (!chart) {
        return
      }
      const xaxis = toApexTimeRange(range)
      const shouldResetViewport = props.viewportResetKey !== lastViewportResetKey
      lastViewportResetKey = props.viewportResetKey
      if (shouldResetViewport || !isViewportZoomed) {
        isViewportZoomed = false
        chart.resetSeries(false, true)
        void chart.updateOptions({ xaxis })
      }
    },
  )

  watch(
    () => JSON.stringify(props.theme),
    () => {
      const options: ApexOptions = themeOptions(props.theme)
      if (props.type === 'scatter') {
        options.markers = { strokeColors: markerStroke(props.theme) }
      }
      void chart?.updateOptions(options, false, true)
    },
  )

  watch(
    () => props.locale,
    locale => chart?.setLocale(apexLocale(locale)),
  )

  watch(curve, value => {
    void chart?.updateOptions({ stroke: { curve: value } })
  })
</script>
