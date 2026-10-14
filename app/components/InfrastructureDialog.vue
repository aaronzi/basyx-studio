<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <v-card :title="existing ? t('admin.edit') : t('admin.add')">
      <v-card-text>
        <v-form ref="form" @submit.prevent="save">
          <v-text-field v-model="model.name" :label="t('admin.name')" :rules="[required]" />
          <v-text-field v-model="model.description" :label="t('admin.description')" />

          <div class="text-title-small mt-4 mb-2">{{ t('admin.deployment') }}</div>

          <v-select
            v-model="model.template"
            :hint="t(`admin.templates.${model.template}.help`)"
            :item-props="item => ({ subtitle: t(`admin.templates.${item.value}.short`) })"
            :items="templates"
            :label="t('admin.template')"
            persistent-hint
          />

          <v-text-field
            v-for="endpointType in endpointFields"
            :key="endpointType"
            v-model="model.urls[endpointType]"
            class="mt-4"
            :hint="t(`admin.endpointHints.${endpointType}`)"
            :label="t(`admin.endpointTypes.${endpointType}`)"
            persistent-hint
            :placeholder="endpointType === endpointFields[0] ? exampleUrl : undefined"
            :rules="rulesFor(endpointType)"
          />

          <template v-if="registryAndRepository">
            <div class="text-title-small mt-6 mb-2">{{ t('admin.listSource') }}</div>

            <v-btn-toggle
              v-model="model.listSource"
              class="d-flex"
              divided
              mandatory
              variant="outlined"
            >
              <v-btn class="flex-grow-1" :text="t('admin.listSources.registry')" value="registry" />
              <v-btn class="flex-grow-1" :text="t('admin.listSources.repository')" value="repository" />
            </v-btn-toggle>

            <div class="text-body-small text-medium-emphasis mt-2">{{ t(`admin.listSourceHelp.${model.listSource}`) }}</div>
          </template>

          <template v-if="hasRegistry || hasDiscovery">
            <div class="text-title-small mt-6">{{ t('admin.sync') }}</div>

            <v-checkbox v-if="hasRegistry" v-model="model.sync.serverSyncsRegistry" hide-details :label="t('admin.serverSyncsRegistry')" />
            <v-checkbox v-if="hasDiscovery" v-model="model.sync.serverSyncsDiscovery" hide-details :label="t('admin.serverSyncsDiscovery')" />

            <template v-if="studioSyncs">
              <v-select
                v-model="model.sync.studioDefault"
                class="mt-2"
                :hint="t('admin.studioDefaultHint')"
                :items="syncModeItems"
                :label="t('admin.studioDefault')"
                persistent-hint
              />

              <v-checkbox v-model="model.sync.userOverride" hide-details :label="t('admin.userOverride')" />
            </template>
          </template>

          <v-checkbox v-model="model.allowPrivateNetwork" class="mt-4" :label="t('admin.allowPrivateNetwork')" />

          <div class="text-title-small mt-2 mb-2">{{ t('admin.security') }}</div>

          <v-select
            v-model="model.mode"
            :hint="t(`admin.modeHelp.${model.mode}`)"
            :items="modes"
            :label="t('admin.securityMode')"
            persistent-hint
          />

          <v-alert
            v-if="model.mode === 'deployment_client_credentials'"
            class="mt-4"
            density="compact"
            :text="t('admin.sharingNote')"
            type="info"
          />

          <template v-if="model.mode !== 'unsecured'">
            <v-text-field v-model="model.issuer" class="mt-4" :label="t('admin.issuer')" :rules="[required, httpUrl]" />
            <v-text-field v-model="model.clientId" :label="t('admin.clientId')" :rules="[required]" />
            <v-text-field v-model="model.scopes" :hint="t('admin.scopesHint')" :label="t('admin.scopes')" persistent-hint />

            <v-text-field
              v-if="session.isDesktop"
              v-model="model.secretValue"
              class="mt-2"
              :hint="t('admin.clientSecretValueHint')"
              :label="t('admin.clientSecretValue')"
              persistent-hint
              type="password"
            />

            <v-text-field
              v-else
              v-model="model.secretRef"
              class="mt-2"
              :hint="t('admin.clientSecretRefHint')"
              :label="t('admin.clientSecretRef')"
              persistent-hint
              placeholder="env:AAS_CLIENT_SECRET"
            />

            <v-select
              v-if="model.mode === 'delegated_user'"
              v-model="model.loopbackHost"
              class="mt-2"
              :hint="t('admin.loopbackHostHint')"
              :items="['127.0.0.1', 'localhost']"
              :label="t('admin.loopbackHost')"
              persistent-hint
            />
          </template>
        </v-form>

        <ProblemAlert v-if="error" class="mt-4" :error="error" />

        <ul v-if="violations.length > 0" class="mt-2 text-body-small">
          <li v-for="violation in violations" :key="violation.path">{{ violation.path }}: {{ violation.message }}</li>
        </ul>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn :text="t('admin.cancel')" @click="open = false" />
        <v-btn-primary :loading="saving" :text="t('admin.save')" @click="save" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { EndpointType, Infrastructure, InfrastructureInput, InfrastructureTemplate, ListSource, SecurityMode, SyncSettings } from '#shared/contract'
  import { defaultSyncSettings, endpointTypes, infrastructureTemplates, securityModes, serviceUrl, syncModes, templateRules } from '#shared/contract'
  import { StudioApiError } from '~/composables/useStudioApi'

  const props = defineProps<{ existing: Infrastructure | null }>()
  const emit = defineEmits<{ saved: [Infrastructure] }>()
  const open = defineModel<boolean>({ required: true })

  const { t } = useI18n()
  const api = useStudioApi()
  const session = useSessionStore()

  const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)
  const saving = ref(false)
  const error = ref<unknown>(null)

  function emptyModel () {
    return {
      name: '',
      description: '',
      template: 'mono-all' as InfrastructureTemplate,
      urls: Object.fromEntries(endpointTypes.map(type => [type, ''])) as Record<EndpointType, string>,
      listSource: 'registry' as ListSource,
      sync: { ...defaultSyncSettings } as SyncSettings,
      allowPrivateNetwork: false,
      mode: 'unsecured' as SecurityMode,
      issuer: '',
      clientId: '',
      scopes: 'openid',
      secretRef: '',
      secretValue: '',
      loopbackHost: '127.0.0.1' as '127.0.0.1' | 'localhost',
    }
  }
  const model = ref(emptyModel())

  watch(open, isOpen => {
    if (!isOpen) {
      return
    }
    error.value = null
    const existing = props.existing
    model.value = emptyModel()
    if (existing) {
      for (const endpoint of existing.endpoints) {
        model.value.urls[endpoint.type] = endpoint.url
      }
      Object.assign(model.value, {
        name: existing.name,
        description: existing.description ?? '',
        template: existing.template,
        listSource: existing.listSource,
        sync: { ...existing.sync },
        allowPrivateNetwork: existing.allowPrivateNetwork,
        mode: existing.security.mode,
      })
      if (existing.security.mode !== 'unsecured') {
        Object.assign(model.value, {
          issuer: existing.security.issuer,
          clientId: existing.security.clientId,
          scopes: existing.security.scopes.join(' '),
        })
      }
      if (existing.security.mode === 'delegated_user') {
        model.value.loopbackHost = existing.security.desktopLoopbackHost
      }
    }
  })

  const modes = computed(() => securityModes.map(mode => ({ value: mode, title: t(`security.${mode}`) })))
  const templates = computed(() => infrastructureTemplates.map(template => ({ value: template, title: t(`admin.templates.${template}.title`) })))
  const syncModeItems = computed(() => syncModes.map(mode => ({ value: mode, title: t(`admin.syncModes.${mode}`) })))

  // A constant: vue-tsc 3.3 garbles `//` inside bound template expressions.
  const exampleUrl = 'https://aas.example.com'

  // The endpoints the template takes, and what they add up to with the current URLs.
  const endpointFields = computed(() => templateRules[model.value.template].allowed)
  const filled = computed(() => ({
    template: model.value.template,
    endpoints: endpointFields.value.filter(type => model.value.urls[type].trim()).map(type => ({ type, url: model.value.urls[type].trim() })),
  }))
  const hasRegistry = computed(() => serviceUrl(filled.value, 'aasRegistry') !== undefined || serviceUrl(filled.value, 'submodelRegistry') !== undefined)
  const hasDiscovery = computed(() => serviceUrl(filled.value, 'aasDiscovery') !== undefined)
  const registryAndRepository = computed(() => serviceUrl(filled.value, 'aasRegistry') !== undefined && serviceUrl(filled.value, 'aasRepository') !== undefined)
  const studioSyncs = computed(() => (hasRegistry.value && !model.value.sync.serverSyncsRegistry) || (hasDiscovery.value && !model.value.sync.serverSyncsDiscovery))

  /** A field is required alone, or as one of a group of alternatives (e.g. AAS repository or registry). */
  function rulesFor (type: EndpointType) {
    const group = templateRules[model.value.template].required.find(entry => entry.includes(type))
    const rules: Array<(value: string) => true | string> = [optionalHttpUrl]
    if (group?.length === 1) {
      rules.unshift(required)
    } else if (group) {
      rules.unshift(() => group.some(other => model.value.urls[other].trim()) || t('admin.oneOf', { types: group.map(other => t(`admin.endpointTypes.${other}`)).join(' / ') }))
    }
    return rules
  }
  const violations = computed(() => error.value instanceof StudioApiError ? error.value.problem?.violations ?? [] : [])

  const required = (value: string) => !!value.trim() || 'Required'
  const httpUrl = (value: string) => /^https?:\/\/\S+$/.test(value.trim()) || 'http(s) URL required'
  const optionalHttpUrl = (value: string) => !value.trim() || httpUrl(value)

  function toInput (): InfrastructureInput {
    const m = model.value
    const endpoints: InfrastructureInput['endpoints'] = filled.value.endpoints
    let security: InfrastructureInput['security'] = { mode: 'unsecured' }
    if (m.mode !== 'unsecured') {
      const secret = session.isDesktop
        ? (m.secretValue ? { value: m.secretValue } : undefined)
        : (m.secretRef.trim() ? { ref: m.secretRef.trim() } : undefined)
      const oidc = {
        issuer: m.issuer.trim(),
        clientId: m.clientId.trim(),
        scopes: m.scopes.split(/\s+/).filter(Boolean),
        clientSecret: secret,
      }
      security = m.mode === 'delegated_user'
        ? { mode: 'delegated_user', ...oidc, desktopLoopbackHost: m.loopbackHost }
        : { mode: 'deployment_client_credentials', ...oidc }
    }
    return {
      name: m.name.trim(),
      description: m.description.trim() || undefined,
      template: m.template,
      endpoints,
      listSource: m.listSource,
      sync: m.sync,
      security,
      allowPrivateNetwork: m.allowPrivateNetwork,
    }
  }

  async function save () {
    if (!(await form.value?.validate())?.valid) {
      return
    }
    saving.value = true
    error.value = null
    try {
      const existing = props.existing
      const saved = existing
        ? await api<Infrastructure>(`/infrastructures/${existing.id}`, {
          method: 'PUT',
          body: toInput(),
          headers: { 'If-Match': `"${existing.revision}"` },
        })
        : await api<Infrastructure>('/infrastructures', { method: 'POST', body: toInput() })
      emit('saved', saved)
      open.value = false
    } catch (error_) {
      error.value = error_
    } finally {
      saving.value = false
    }
  }
</script>
