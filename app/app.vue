<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script lang="ts" setup>
  import { useTheme } from 'vuetify'

  // The user's theme preference (Settings); "system" follows the OS.
  const theme = useTheme()
  const preferences = usePreferences()
  if (import.meta.client) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const value = preferences.query.data.value?.theme
      if (value) {
        theme.change(value === 'system' ? (dark.matches ? 'dark' : 'light') : value)
      }
    }
    watch(() => preferences.query.data.value?.theme, apply, { immediate: true })
    dark.addEventListener('change', apply)
  }
</script>
