<template>
  <v-container>
    <v-empty-state
      v-if="session.needsLogin"
      :image="basyxLogo"
      size="96"
      :text="t('home.signInText')"
      :title="t('home.signInTitle')"
    >
      <template #actions>
        <v-btn-primary :loading="signingIn" prepend-icon="mdi-login" :text="t('app.signIn')" @click="signIn" />
      </template>
    </v-empty-state>

    <template v-else>
      <div class="mb-6">
        <h1 class="text-headline-medium">{{ t('home.title') }}</h1>
        <p class="text-body-large text-medium-emphasis">{{ t('home.subtitle') }}</p>
      </div>

      <ProblemAlert v-if="authError" class="mb-4" :error="authErrorProblem" />

      <ProblemAlert
        v-if="targets.error.value"
        class="mb-4"
        :error="targets.error.value"
        retry
        @retry="targets.refetch()"
      />

      <v-progress-linear v-if="targets.isLoading.value" />

      <v-row v-else-if="targets.data.value?.items.length">
        <v-col v-for="target in targets.data.value.items" :key="target.id" cols="12" md="6">
          <v-card class="h-100" :to="`/targets/${target.id}`">
            <v-card-item :prepend-icon="targetIcon(target)" :title="target.name" />

            <v-card-text>
              <p v-if="target.description" class="text-medium-emphasis mb-3">{{ target.description }}</p>
              <TargetChips :target="target" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-empty-state
        v-else-if="targets.data.value"
        icon="mdi-server-network-off"
        :text="session.isAdmin ? t('home.noTargetsAdmin') : t('home.noTargetsUser')"
        :title="t('home.noTargets')"
      >
        <template v-if="session.isAdmin" #actions>
          <v-btn-primary :text="t('home.addInfrastructure')" to="/admin/infrastructures" />
        </template>
      </v-empty-state>
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  import type { Target } from '#shared/contract'
  import { useQuery } from '@pinia/colada'
  import basyxLogo from '~/assets/basyx-logo.svg'
  import { StudioApiError } from '~/composables/useStudioApi'
  import { targetIcon } from '~/utils/aas'

  const { t } = useI18n()
  const route = useRoute()
  const session = useSessionStore()
  const api = useStudioApi()

  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
    enabled: () => !session.needsLogin,
  })

  const authError = computed(() => typeof route.query.authError === 'string' ? route.query.authError : null)
  const authErrorProblem = computed(() => new StudioApiError({
    type: 'about:blank',
    title: 'Authorization failed',
    status: 400,
    code: authError.value === 'access_denied' ? 'forbidden' : 'target_auth_required',
    requestId: '-',
    retryable: false,
  }))

  const signingIn = ref(false)
  async function signIn () {
    signingIn.value = true
    const returnTo = typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') ? route.query.returnTo : '/'
    try {
      await session.login(returnTo)
    } finally {
      signingIn.value = false
    }
  }
</script>
