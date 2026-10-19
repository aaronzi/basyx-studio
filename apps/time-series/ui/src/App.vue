<template>
  <v-app>
    <!-- Layout of the BaSyx AAS Web UI's Time Series Data plugin: the
         submodel, the preview configuration and the preview chart. Studio
         reads the data (studio.timeseries.read); the view never fetches it. -->
    <v-view-card>
      <v-progress-linear v-if="loading" />

      <v-alert v-else-if="error" class="ma-4" :text="error" type="error" />

      <div v-else class="d-flex flex-column ga-4 pa-4">
        <!-- Header -->
        <v-card>
          <v-card-title>
            <div class="text-body-large text-wrap" data-test="name">{{ name }}</div>
          </v-card-title>

          <v-card-text v-if="description" class="pt-0">{{ description }}</v-card-text>
        </v-card>

        <!-- Preview configuration -->
        <v-card>
          <v-card-item class="pb-0">
            <v-card-title class="text-title-small">{{ t('config.title') }}</v-card-title>
          </v-card-item>

          <v-card-text class="pt-1">
            <v-select
              v-model="segmentId"
              clearable
              data-test="segment"
              density="compact"
              :items="segmentItems"
              :label="t('config.segment')"
              :no-data-text="t('config.noData')"
              variant="outlined"
            />

            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="timeId"
                  clearable
                  data-test="time"
                  density="compact"
                  :items="recordItems"
                  :label="t('config.time')"
                  :no-data-text="t('config.noData')"
                  variant="outlined"
                />
              </v-col>

              <v-col cols="12" md="6">
                <v-select
                  v-model="valueIds"
                  clearable
                  data-test="values"
                  density="compact"
                  :items="recordItems"
                  :label="t('config.values')"
                  multiple
                  :no-data-text="t('config.noData')"
                  variant="outlined"
                />
              </v-col>
            </v-row>

            <v-alert
              v-if="connectionProblem"
              class="mb-2"
              data-test="connection-problem"
              density="compact"
              :text="connectionProblem"
              type="warning"
            />

            <div class="d-flex justify-end mt-2">
              <v-btn-group>
                <TimeRangeSelector v-model="timeRangeSelection" />
                <AutoRefreshSelector v-model="autoRefreshSelection" />
              </v-btn-group>
            </div>
          </v-card-text>

          <v-divider />

          <v-card-actions>
            <v-spacer />

            <v-btn-primary
              data-test="fetch"
              :disabled="!canFetch"
              :loading="isFetching"
              size="small"
              @click="fetchData(true)"
            >
              {{ t('config.fetch') }}
            </v-btn-primary>
          </v-card-actions>
        </v-card>

        <!-- Preview chart -->
        <v-card>
          <v-card-item class="pb-0">
            <v-card-title class="text-title-small">{{ t('chart.title') }}</v-card-title>
          </v-card-item>

          <v-card-text class="pt-1">
            <v-select
              v-model="chartType"
              data-test="chart-type"
              density="compact"
              :items="chartTypeItems"
              :label="t('chart.type')"
              variant="outlined"
            />

            <v-empty-state
              v-if="hasFetched && !hasData"
              data-test="empty"
              icon="mdi-chart-line-variant"
              :text="t('chart.emptyText')"
              :title="t('chart.emptyTitle')"
            />

            <template v-else-if="hasData">
              <TimeChart
                v-if="chartType === 'line' || chartType === 'area' || chartType === 'scatter'"
                :key="chartType"
                :locale="locale"
                :range="resolvedRange"
                :series="series"
                :theme="theme"
                :type="chartType"
                :viewport-reset-key="viewportResetKey"
              />

              <HistogramChart v-else-if="chartType === 'histogram'" :locale="locale" :series="series" :theme="theme" />

              <GaugeChart v-else-if="chartType === 'gauge'" :series="series" :theme="theme" />

              <DisplayField v-else :series="series" />
            </template>
          </v-card-text>
        </v-card>
      </div>
    </v-view-card>
  </v-app>
</template>

<script lang="ts" setup>
  import type { AutoRefreshSelection } from './autoRefresh'
  import type { ChartType } from './chartOptions'
  import type { ResolvedTimeRange, TimeRangeSelection } from './timeRange'
  import type { AppContext, JsonObject, StudioClient, TimeSeriesReadParams, TimeSeriesResult } from '@basyx/studio-sdk'
  import { StudioError } from '@basyx/studio-sdk'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { langText, loadSubmodel } from '../../../shared/app'
  import {
    autoRefreshIntervalMs,
    cloneAutoRefreshSelection,
    DEFAULT_AUTO_REFRESH,
    RequestCounter,
    startAutoRefresh,
    validateAutoRefreshSelection,
  } from './autoRefresh'
  import AutoRefreshSelector from './AutoRefreshSelector.vue'
  import { CHART_TYPES } from './chartOptions'
  import DisplayField from './charts/DisplayField.vue'
  import GaugeChart from './charts/GaugeChart.vue'
  import HistogramChart from './charts/HistogramChart.vue'
  import TimeChart from './charts/TimeChart.vue'
  import { provideI18n } from './i18n'
  import {
    cloneTimeRangeSelection,
    DEFAULT_TIME_RANGE,
    rangeFromResult,
    validateTimeRangeSelection,
  } from './timeRange'
  import TimeRangeSelector from './TimeRangeSelector.vue'
  import { defaultSelection, findRecords, findSegments, hasPoints, prepareSeries, readParams } from './timeseries'

  // IDTA 02008 Time Series Data 1.1 (time series plan U1 to U6).
  const props = defineProps<{ client: StudioClient }>()

  const { t, locale } = provideI18n(props.client)

  const context = ref<AppContext>(props.client.context)
  props.client.onContext(value => {
    context.value = value
  })
  const theme = computed(() => context.value.theme)

  const loading = ref(true)
  const error = ref<string | null>(null)
  const submodel = ref<JsonObject | null>(null)

  const segments = computed(() => findSegments(submodel.value))
  const records = computed(() => findRecords(submodel.value))
  const name = computed(() => langText(submodel.value?.displayName, locale.value) || t('app.title'))
  const description = computed(() => langText(submodel.value?.description, locale.value))

  // The Web UI lists segments and records by idShort.
  const segmentItems = computed(() => segments.value.map(segment => ({ title: segment.idShort, value: segment.idShort })))
  const recordItems = computed(() => records.value.map(record => ({ title: record.idShort, value: record.idShort })))
  const chartTypeItems = computed(() => CHART_TYPES.map(type => ({ title: t(`chartType.${type}`), value: type })))

  const segmentId = ref<string | null>(null)
  const timeId = ref<string | null>(null)
  const valueIds = ref<string[]>([])
  const segment = computed(() => segments.value.find(entry => entry.idShort === segmentId.value) ?? null)

  const timeRangeSelection = ref<TimeRangeSelection>(cloneTimeRangeSelection(DEFAULT_TIME_RANGE))
  const autoRefreshSelection = ref<AutoRefreshSelection>(cloneAutoRefreshSelection(DEFAULT_AUTO_REFRESH))
  const committedTimeRangeSelection = ref<TimeRangeSelection>(cloneTimeRangeSelection(DEFAULT_TIME_RANGE))
  const resolvedRange = ref<ResolvedTimeRange | null>(null)
  const result = ref<TimeSeriesResult | null>(null)
  const chartType = ref<ChartType>('line')
  const hasFetched = ref(false)
  const isFetching = ref(false)
  /** The detail of a `connection_not_configured` problem, shown until the next successful read. */
  const connectionProblem = ref<string | null>(null)

  const timeRangeError = computed(() => validateTimeRangeSelection(timeRangeSelection.value))
  const autoRefreshError = computed(() => validateAutoRefreshSelection(autoRefreshSelection.value))
  const canFetch = computed(() => Boolean(segment.value && timeId.value && valueIds.value.length > 0 && !timeRangeError.value))
  const series = computed(() => prepareSeries(result.value, records.value, locale.value))
  const hasData = computed(() => hasPoints(series.value))
  const viewportResetKey = computed(() => JSON.stringify(committedTimeRangeSelection.value))

  const requests = new RequestCounter()
  let stopAutoRefresh: (() => void) | null = null
  /** What the last read reported, so that auto refresh does not repeat the same notifications. */
  let lastReport = ''

  function notify (message: string, level: 'warning' | 'error'): void {
    void props.client.ui.notify(message, level).catch(() => {
      // Notifications are best effort.
    })
  }

  /** Reports warnings and errors; auto refresh repeats them only when they change. */
  function report (messages: string[], level: 'warning' | 'error', manual: boolean): void {
    const key = `${level}:${messages.join('\n')}`
    if (manual || key !== lastReport) {
      for (const message of messages) {
        notify(message, level)
      }
    }
    lastReport = key
  }

  function invalidatePendingRequest (): void {
    requests.invalidate()
    isFetching.value = false
  }

  async function fetchData (manual: boolean): Promise<void> {
    const selectedSegment = segment.value
    if (!canFetch.value || !selectedSegment || !timeId.value) {
      return
    }
    const selection = cloneTimeRangeSelection(timeRangeSelection.value)
    let params: TimeSeriesReadParams
    try {
      params = readParams({
        submodelId: context.value.submodel!.id,
        segment: selectedSegment,
        time: timeId.value,
        values: valueIds.value,
        selection,
        now: new Date(),
      })
    } catch (error_) {
      report([t(`validation.${error_ instanceof RangeError ? error_.message : 'rangeInvalid'}`)], 'warning', manual)
      return
    }

    const requestId = requests.begin()
    isFetching.value = true
    try {
      const answer = await props.client.timeseries.read(params)
      if (!requests.isCurrent(requestId)) {
        return
      }
      connectionProblem.value = null
      report(answer.warnings.map(warning => t(`warnings.${warning.code}`, warning.params)), 'warning', manual)
      result.value = answer
      resolvedRange.value = rangeFromResult(answer.range, selection.mode)
      committedTimeRangeSelection.value = selection
      hasFetched.value = true
    } catch (error_) {
      if (!requests.isCurrent(requestId)) {
        return
      }
      if (error_ instanceof StudioError && error_.code === 'connection_not_configured') {
        connectionProblem.value = error_.problem.detail ?? error_.message
        lastReport = ''
        return
      }
      const message = error_ instanceof StudioError ? (error_.problem.detail ?? t('errors.fetch')) : t('errors.fetch')
      report([message], 'error', manual)
    } finally {
      if (requests.isCurrent(requestId)) {
        isFetching.value = false
      }
    }
  }

  function clearAutoRefresh (): void {
    stopAutoRefresh?.()
    stopAutoRefresh = null
  }

  function configureAutoRefresh (): void {
    clearAutoRefresh()
    if (!autoRefreshSelection.value.enabled || autoRefreshError.value || !canFetch.value) {
      return
    }
    stopAutoRefresh = startAutoRefresh({
      intervalMs: autoRefreshIntervalMs(autoRefreshSelection.value),
      tick: () => void fetchData(false),
      isBusy: () => isFetching.value,
      visibility: document,
    })
  }

  watch(autoRefreshSelection, configureAutoRefresh, { deep: true })
  watch(canFetch, configureAutoRefresh)

  // A changed selection makes a pending answer stale (Web UI).
  watch([segmentId, timeId, valueIds], invalidatePendingRequest, { flush: 'sync' })
  watch(segmentId, () => {
    connectionProblem.value = null
  })

  onMounted(async () => {
    try {
      submodel.value = await loadSubmodel(props.client)
      const defaults = defaultSelection(segments.value, records.value)
      segmentId.value = defaults.segment
      timeId.value = defaults.time
    } catch (error_) {
      error.value = t('errors.load', { message: error_ instanceof StudioError ? error_.message : String(error_) })
    } finally {
      loading.value = false
    }
  })

  onBeforeUnmount(() => {
    clearAutoRefresh()
    invalidatePendingRequest()
  })
</script>
