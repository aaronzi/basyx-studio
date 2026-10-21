<template>
  <AppModuleView
    :installation-id="String(route.params.installationId)"
    :route="String(route.params.route)"
    :shell-key="null"
    :sub-path="subPath"
    :target-id="null"
  />
</template>

<script lang="ts" setup>
  // One page per module: a new sub-path reaches the loaded frame with the
  // context instead of loading it again (external apps follow-up N1).
  definePageMeta({ key: route => `${String(route.params.installationId)}/${String(route.params.route)}` })

  const route = useRoute()
  const subPath = computed(() => [route.params.subPath ?? []].flat().join('/'))
</script>
