<template>
  <v-app>
    <v-app-bar border="b" density="comfortable" flat>
      <template #prepend>
        <NuxtLink class="d-flex align-center ga-2 text-decoration-none text-high-emphasis ml-2" to="/">
          <img alt="" height="28" src="~/assets/logo.svg" width="28">
          <span class="text-title-medium font-weight-bold">{{ t('app.name') }}</span>
        </NuxtLink>
      </template>

      <div v-if="!session.needsLogin" class="d-flex ga-1 ml-6">
        <v-btn prepend-icon="mdi-database-search-outline" :text="t('app.browse')" to="/" variant="text" />

        <v-btn
          v-if="session.isAdmin"
          prepend-icon="mdi-server-network"
          :text="t('app.infrastructures')"
          to="/admin/infrastructures"
          variant="text"
        />
      </div>

      <template #append>
        <v-btn
          :aria-label="t('app.toggleTheme')"
          icon="mdi-theme-light-dark"
          variant="text"
          @click="theme.cycle()"
        />

        <v-menu v-if="session.session">
          <template #activator="{ props }">
            <v-btn v-bind="props" class="mr-2" prepend-icon="mdi-account-circle-outline" variant="text">
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

  const { t } = useI18n()
  const theme = useTheme()
  const session = useSessionStore()
</script>
