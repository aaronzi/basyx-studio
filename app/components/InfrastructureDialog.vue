<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <v-card :title="existing ? t('admin.edit') : t('admin.add')">
      <v-card-text>
        <v-form ref="form" @submit.prevent="save">
          <v-text-field v-model="model.name" :label="t('admin.name')" :rules="[required]" />
          <v-text-field v-model="model.description" :label="t('admin.description')" />

          <div class="text-title-small mt-2 mb-2">{{ t('admin.endpoints') }}</div>

          <v-text-field
            v-model="model.aasRepository"
            :hint="t('admin.sameUrlHint')"
            :label="t('admin.aasRepository')"
            persistent-hint
            placeholder="https://aas.example.com"
            :rules="[required, httpUrl]"
          />

          <v-text-field v-model="model.submodelRepository" class="mt-2" :label="t('admin.submodelRepository')" :rules="[required, httpUrl]" />
          <v-text-field v-model="model.conceptDescriptionRepository" :label="t('admin.conceptDescriptionRepository')" :rules="[optionalHttpUrl]" />
          <v-checkbox v-model="model.allowPrivateNetwork" density="compact" :label="t('admin.allowPrivateNetwork')" />

          <div class="text-title-small mt-2 mb-2">{{ t('admin.security') }}</div>

          <v-select
            v-model="model.mode"
            :hint="t(`admin.modeHelp.${model.mode}`)"
            :items="modes"
            :label="t('admin.securityMode')"
            persistent-hint
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
        <v-btn :text="t('admin.cancel')" variant="text" @click="open = false" />

        <v-btn
          color="primary"
          :loading="saving"
          :text="t('admin.save')"
          variant="flat"
          @click="save"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { Infrastructure, InfrastructureInput, SecurityMode } from '#shared/contract'
  import { securityModes } from '#shared/contract'
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
      aasRepository: '',
      submodelRepository: '',
      conceptDescriptionRepository: '',
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
      const url = (type: string) => existing.endpoints.find(endpoint => endpoint.type === type)?.url ?? ''
      Object.assign(model.value, {
        name: existing.name,
        description: existing.description ?? '',
        aasRepository: url('aasRepository'),
        submodelRepository: url('submodelRepository'),
        conceptDescriptionRepository: url('conceptDescriptionRepository'),
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
  const violations = computed(() => error.value instanceof StudioApiError ? error.value.problem?.violations ?? [] : [])

  const required = (value: string) => !!value.trim() || 'Required'
  const httpUrl = (value: string) => /^https?:\/\/\S+$/.test(value.trim()) || 'http(s) URL required'
  const optionalHttpUrl = (value: string) => !value.trim() || httpUrl(value)

  function toInput (): InfrastructureInput {
    const m = model.value
    const endpoints: InfrastructureInput['endpoints'] = [
      { type: 'aasRepository', url: m.aasRepository.trim() },
      { type: 'submodelRepository', url: m.submodelRepository.trim() },
    ]
    if (m.conceptDescriptionRepository.trim()) {
      endpoints.push({ type: 'conceptDescriptionRepository', url: m.conceptDescriptionRepository.trim() })
    }
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
      endpoints,
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
