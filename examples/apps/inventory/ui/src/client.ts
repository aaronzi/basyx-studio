import type { StudioClient } from '@basyx/studio-sdk'
import type { InjectionKey, Ref } from 'vue'
import { inject, provide, ref } from 'vue'

// The client and its context for the pages.

const key: InjectionKey<{ client: StudioClient, context: Ref<StudioClient['context']> }> = Symbol('client')

export function provideClient (client: StudioClient) {
  const context = ref(client.context)
  client.onContext(value => (context.value = value))
  provide(key, { client, context })
  return { client, context }
}

export function useClient () {
  const value = inject(key)
  if (!value) {
    throw new Error('useClient needs provideClient in App.vue.')
  }
  return value
}
