<template>
  <!-- The open packages as groups of the shell or submodel list (package
       editing plan, M1 to M3). Each row opens in its own package's route,
       so the views stay with one target. -->
  <v-list class="flex-grow-1 overflow-y-auto px-2 py-2" lines="two" nav>
    <PackageListGroup
      v-for="target in packages"
      :key="target.id"
      :active-key="target.id === currentTargetId ? activeKey : null"
      :current="target.id === currentTargetId"
      :expression="expression"
      :kind="kind"
      :kind-filter="kindFilter"
      :search-state="searchState"
      :target="target"
    />
  </v-list>
</template>

<script lang="ts" setup>
  import type { LocationQueryRaw } from 'vue-router'

  const props = defineProps<{
    kind: 'shells' | 'submodels'
    currentTargetId: string
    activeKey: string | null
    /** The list's search expression, as applied. */
    expression: string
    /** The kind chips: `all`, or `Instance`, `Type` or `Template`. */
    kindFilter: string
    /** The search in the URL, kept on the rows' links. */
    searchState: LocationQueryRaw
  }>()

  const { packages } = useOpenPackages(() => props.currentTargetId)
</script>
