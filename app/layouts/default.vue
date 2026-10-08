<template>
  <v-app>
    <v-app-bar>
      <template #prepend>
        <v-btn :active="false" class="text-none" to="/">
          <template #prepend>
            <v-img :alt="t('app.name')" :src="basyxLogo" width="28" />
          </template>

          <span class="text-title-medium font-weight-bold">{{ t('app.name') }}</span>
        </v-btn>
      </template>

      <div v-if="!session.needsLogin" class="d-flex ga-1 ms-4">
        <v-btn exact prepend-icon="mdi-database-search-outline" :text="t('app.browse')" to="/" />

        <v-btn
          v-if="session.isAdmin"
          prepend-icon="mdi-server-network"
          :text="t('app.infrastructures')"
          to="/admin/infrastructures"
        />
      </div>

      <template #append>
        <v-btn :aria-label="t('app.toggleTheme')" icon="mdi-theme-light-dark" @click="theme.cycle()" />

        <v-menu v-if="session.session">
          <template #activator="{ props }">
            <v-btn v-bind="props" class="me-2 text-none">
              <template #prepend>
                <v-avatar color="primary" size="28" :text="initials" />
              </template>
              {{ session.isDesktop ? t('app.localUser') : session.session.user.name }}
            </v-btn>
          </template>

          <v-list density="compact" min-width="220">
            <v-list-item
              :subtitle="session.isAdmin ? t('app.administrator') : undefined"
              :title="session.session.user.name"
            />

            <template v-if="!session.isDesktop">
              <v-divider />
              <v-list-item prepend-icon="mdi-logout" :title="t('app.signOut')" @click="session.logout()" />
            </template>
          </v-list>
        </v-menu>
      </template>
    </v-app-bar>

    <v-main>
      <slot />
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'
  import basyxLogo from '~/assets/basyx-logo.svg'

  const { t } = useI18n()
  const theme = useTheme()
  const session = useSessionStore()

  const initials = computed(() => {
    const name = session.isDesktop ? t('app.localUser') : (session.session?.user.name ?? '')
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('')
  })
</script>
