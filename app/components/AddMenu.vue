<template>
  <!-- One way to add a shell, submodel or concept description wherever it
       can be added (package editing plan, A1): new, pasted from Studio's
       clipboard, from AAS JSON or XML, or imported from a file, always in
       this order. Paste is listed when nothing fits too, with how to copy. -->
  <v-menu>
    <template #activator="{ props: activator }">
      <!-- Attributes such as `class` style the button, not the menu. -->
      <v-btn
        v-if="compact"
        v-bind="{ ...$attrs, ...activator }"
        append-icon="mdi-chevron-down"
        prepend-icon="mdi-plus"
        size="small"
        :text="label"
      />

      <v-btn-secondary
        v-else
        v-bind="{ ...$attrs, ...activator }"
        append-icon="mdi-chevron-down"
        :block="block"
        prepend-icon="mdi-plus"
        :text="label"
      />
    </template>

    <v-card>
      <v-list>
        <v-list-item
          v-for="item in newItems"
          :key="item.title"
          :prepend-icon="item.icon"
          :title="item.title"
          @click="item.onClick"
        />

        <v-divider class="my-1" />

        <!-- One line each, as every menu: what is pasted, or how to copy something first. -->
        <v-list-item
          :disabled="!pasteLabel"
          prepend-icon="mdi-content-paste"
          :title="pasteLabel ? t('copies.pasteInto', { name: pasteLabel }) : t(`copies.copyFirst.${kind}`)"
          @click="emit('paste')"
        />

        <v-list-item prepend-icon="mdi-code-json" :title="t('copies.fromText')" @click="emit('text')" />

        <v-list-item
          v-if="importable"
          prepend-icon="mdi-tray-arrow-up"
          :title="t('copies.importFile')"
          @click="emit('import')"
        />
      </v-list>
    </v-card>
  </v-menu>
</template>

<script lang="ts" setup>
  import type { CopyResourceType } from '#shared/contract'

  defineOptions({ inheritAttrs: false })

  defineProps<{
    /** What is added, as the button says it: "Shell", "Submodel". */
    label: string
    kind: CopyResourceType
    /** The ways to make a new one (the form, a template). */
    newItems: Array<{ title: string, icon: string, onClick: () => void }>
    /** What Studio's clipboard holds of this kind, or `null`. */
    pasteLabel: string | null
    /** Files can be imported here. */
    importable: boolean
    /** The small button of a toolbar. */
    compact?: boolean
    block?: boolean
  }>()
  const emit = defineEmits<{ paste: [], text: [], import: [] }>()

  const { t } = useI18n()
</script>
