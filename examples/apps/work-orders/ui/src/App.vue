<template>
  <v-app>
    <v-main>
      <div class="d-flex flex-column ga-4 pa-4">
        <!-- Who the service sees: the static token's holder, or the signed-in user (delegatedUser). -->
        <div class="d-flex flex-wrap align-center ga-2">
          <v-chip v-if="caller" data-test="caller" prepend-icon="mdi-account-key-outline" :text="`The service sees: ${caller.subject} (${caller.via})`" />

          <v-select
            v-model="asset"
            class="flex-grow-1"
            data-test="asset"
            hide-details
            item-title="title"
            item-value="value"
            :items="assets"
            label="Asset"
          />
        </div>

        <v-alert
          v-if="error"
          closable
          data-test="error"
          :text="error"
          type="error"
          @click:close="error = null"
        />

        <v-card title="New work order">
          <v-card-text class="d-flex flex-wrap align-center ga-2">
            <v-text-field
              v-model="title"
              class="flex-grow-1"
              data-test="title"
              hide-details
              label="Title"
            />

            <v-text-field v-model="due" hide-details label="Due" type="date" />
            <v-btn-primary :disabled="!asset || !title.trim()" :loading="busy" text="Create" @click="create" />
          </v-card-text>
        </v-card>

        <v-card :title="`Work orders (${orders.length})`">
          <v-progress-linear v-if="loading" />

          <v-list v-if="orders.length > 0" data-test="orders">
            <v-list-item v-for="order in orders" :key="order.id" :subtitle="`#${order.id} · by ${order.createdBy}${order.due ? ` · due ${order.due}` : ''}`" :title="order.title">
              <template #append>
                <div class="d-flex align-center ga-2">
                  <v-chip :color="order.status === 'done' ? 'success' : undefined" :text="order.status" />
                  <v-btn v-if="order.status === 'open'" :loading="busy" text="Done" @click="markDone(order)" />
                </div>
              </template>

              <div class="d-flex flex-wrap align-center ga-2 mt-2">
                <v-img
                  v-for="photo in order.photos"
                  :key="photo.id"
                  :alt="photo.caption || `Photo ${photo.id}`"
                  cover
                  height="64"
                  :src="photoUrls[`${order.id}/${photo.id}`]"
                  width="64"
                />

                <v-file-input
                  accept="image/*"
                  density="compact"
                  hide-details
                  label="Add photo"
                  prepend-icon="mdi-camera-outline"
                  @update:model-value="file => addPhoto(order, file)"
                />
              </div>
            </v-list-item>
          </v-list>

          <v-card-text v-else-if="!loading" class="text-medium-emphasis">No work orders for this asset.</v-card-text>
        </v-card>
      </div>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import type { ConnectionCallParams, ConnectionCallResult, StudioClient } from '@basyx/studio-sdk'
  import { localized, StudioError } from '@basyx/studio-sdk'
  import { onMounted, reactive, ref, watch } from 'vue'

  interface Order { id: string, asset: string, title: string, status: 'open' | 'done', due: string | null, createdBy: string, photos: { id: string, caption: string }[] }

  const props = defineProps<{ client: StudioClient }>()

  const caller = ref<{ subject: string, via: string } | null>(null)
  const assets = ref<{ title: string, value: string }[]>([])
  const asset = ref<string | null>(null)
  const orders = ref<Order[]>([])
  const photoUrls = reactive<Record<string, string>>({})
  const title = ref('')
  const due = ref('')
  const loading = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)

  /**
   * Calls an operation of the work-order service through Studio. Answers
   * that are not 2xx are results: their problem details become the error.
   */
  async function callService (operation: string, params: Omit<ConnectionCallParams, 'connection' | 'operation'> = {}): Promise<ConnectionCallResult | null> {
    try {
      const result = await props.client.connections.call({ connection: 'orders', operation, ...params })
      if (result.status >= 400) {
        const problem = result.body as { title?: string, detail?: string } | null
        error.value = `${problem?.title ?? `HTTP ${result.status}`}${problem?.detail ? `: ${problem.detail}` : ''}`
        return null
      }
      return result
    } catch (error_) {
      // Refusals by Studio: not bound, not declared, invalid, busy, unreachable.
      error.value = error_ instanceof StudioError ? `${error_.message} (${error_.code})` : String(error_)
      return null
    }
  }

  async function load () {
    if (!asset.value) {
      orders.value = []
      return
    }
    loading.value = true
    const result = await callService('listOrders', { query: { asset: asset.value } })
    orders.value = (result?.body as Order[] | undefined) ?? []
    loading.value = false
    for (const order of orders.value) {
      for (const photo of order.photos) {
        const key = `${order.id}/${photo.id}`
        if (!photoUrls[key]) {
          const image = await callService('getPhoto', { path: { orderId: order.id, photoId: photo.id } })
          if (image?.body instanceof Uint8Array) {
            photoUrls[key] = URL.createObjectURL(new Blob([image.body as Uint8Array<ArrayBuffer>], { type: image.contentType ?? 'image/png' }))
          }
        }
      }
    }
  }

  async function create () {
    busy.value = true
    const created = await callService('createOrder', { body: { asset: asset.value, title: title.value.trim(), due: due.value || null } })
    busy.value = false
    if (created) {
      title.value = ''
      due.value = ''
      await props.client.ui.notify(`Created work order #${(created.body as Order).id}.`, 'success')
      await load()
    }
  }

  /** Reads the order for its ETag, then changes it only if no one else did (If-Match). */
  async function markDone (order: Order) {
    busy.value = true
    const current = await callService('getOrder', { path: { orderId: order.id } })
    if (current?.etag) {
      await callService('updateOrder', { path: { orderId: order.id }, headers: { 'If-Match': current.etag }, body: { status: 'done' } })
    }
    busy.value = false
    await load()
  }

  async function addPhoto (order: Order, file: File | File[] | null | undefined) {
    const photo = Array.isArray(file) ? file[0] : file
    if (!photo) {
      return
    }
    busy.value = true
    await callService('addPhoto', {
      path: { orderId: order.id },
      body: { fields: { caption: photo.name }, files: { file: { fileName: photo.name, contentType: photo.type || 'image/png', bytes: new Uint8Array(await photo.arrayBuffer()) } } },
    })
    busy.value = false
    await load()
  }

  watch(asset, load)

  onMounted(async () => {
    const me = await callService('whoAmI')
    caller.value = (me?.body as { subject: string, via: string } | undefined) ?? null
    const shells = await props.client.aas.listShells({ limit: 100 })
    assets.value = shells.items
      .filter(shell => shell.globalAssetId)
      .map(shell => ({ title: shell.displayName.length > 0 ? localized(Object.fromEntries(shell.displayName.map(name => [name.language, name.text])), props.client.context.locale) : (shell.idShort ?? shell.id), value: shell.globalAssetId! }))
    asset.value = assets.value[0]?.value ?? null
  })
</script>
