<template>
  <!-- The header of a shell or submodel (package editing plan, H1 to H4):
       title and a muted meta line, the actions, then the identifiers as a
       description list. Its layout follows the width of the content area,
       not of the window, as the drawers beside it take their share. -->
  <v-card class="mb-3">
    <v-card-item class="pa-3">
      <template #prepend>
        <slot :large="layout !== 'narrow'" name="avatar" />
      </template>

      <v-card-title class="ma-0 text-wrap text-break" :class="layout === 'narrow' ? 'text-title-medium' : 'text-title-large'" tag="h1">{{ title }}</v-card-title>

      <!-- One line, truncated, with all of it in the tooltip. -->
      <div v-tooltip="{ text: metaText, openDelay: 500 }" class="text-truncate text-body-small text-medium-emphasis">
        <span v-for="item in meta" :key="item.text" class="me-3" :class="item.class">
          <v-icon class="me-1" :icon="item.icon" size="14" />{{ item.text }}
        </span>
      </div>

      <template v-if="(layout === 'wide' && split.inline.length > 0) || menuShown" #append>
        <div class="d-flex align-center ga-1">
          <template v-if="layout === 'wide'">
            <ResourceHeaderAction v-for="action in split.inline" :key="action.id" :action="action" />
          </template>

          <v-menu v-if="menuShown">
            <template #activator="{ props: activator }">
              <v-btn v-bind="activator" :aria-label="t('shell.more')" icon="mdi-dots-vertical" />
            </template>

            <v-card>
              <v-list>
                <template v-for="action in regularMenu" :key="action.id">
                  <template v-if="action.items">
                    <v-list-subheader :title="action.title" />

                    <v-list-item
                      v-for="item in action.items"
                      :key="item.href"
                      :href="item.href"
                      :prepend-icon="item.icon"
                      :title="item.title"
                    />

                    <v-divider class="my-1" />
                  </template>

                  <v-list-item v-else :prepend-icon="action.icon" :title="action.title" @click="action.onClick?.()" />
                </template>

                <v-list-item
                  v-if="layout === 'narrow' && identifiers.length > 0"
                  :prepend-icon="showIdentifiers ? 'mdi-information-off-outline' : 'mdi-information-outline'"
                  :title="showIdentifiers ? t('shell.hideIdentifiers') : t('shell.showIdentifiers')"
                  @click="showIdentifiers = !showIdentifiers"
                />

                <template v-if="dangerMenu.length > 0">
                  <v-divider v-if="regularMenu.length > 0 || layout === 'narrow'" class="my-1" />

                  <v-list-item
                    v-for="action in dangerMenu"
                    :key="action.id"
                    base-color="error"
                    :prepend-icon="action.icon"
                    :title="action.title"
                    @click="action.onClick?.()"
                  />
                </template>
              </v-list>
            </v-card>
          </v-menu>
        </div>
      </template>
    </v-card-item>

    <!-- Medium width: the actions below the title, which keeps the card's whole width. -->
    <div v-if="layout === 'medium' && split.inline.length > 0" class="d-flex flex-wrap align-center ga-2 px-3 pb-3">
      <ResourceHeaderAction v-for="action in split.inline" :key="action.id" :action="action" />
    </div>

    <!-- Identifiers: label column, value and its copy button side by side.
         Narrow, label and value stack and show on request. -->
    <template v-if="identifiers.length > 0 && (layout !== 'narrow' || showIdentifiers)">
      <v-divider />

      <div class="d-flex align-center ga-3 px-3 py-2">
        <div class="flex-grow-1 overflow-hidden">
          <div
            v-for="row in identifiers"
            :key="row.label"
            class="d-flex text-body-small"
            :class="layout === 'narrow' ? 'flex-column mb-1' : 'align-center'"
          >
            <v-sheet
              class="d-flex align-center ga-2 flex-shrink-0 text-medium-emphasis text-no-wrap"
              color="transparent"
              :width="layout === 'narrow' ? undefined : 136"
            >
              <v-icon :icon="row.icon" size="16" />
              {{ row.label }}
            </v-sheet>

            <div class="d-flex align-center ga-1 overflow-hidden">
              <span :class="layout === 'narrow' ? 'text-break' : 'text-truncate'" :title="row.value">{{ row.value }}</span>
              <v-btn :aria-label="t('common.copyLabel', { label: row.label })" icon="mdi-content-copy" size="x-small" @click="copy(row.value, row.label)" />
            </div>
          </div>
        </div>

        <slot v-if="layout !== 'narrow'" name="identifiers-append" />
      </div>
    </template>

    <slot />
  </v-card>
</template>

<script lang="ts" setup>
  import type { HeaderAction, HeaderIdentifier, HeaderMeta } from '~/utils/resource-header'
  import { useDisplay, useLayout } from 'vuetify'
  import { headerLayout, splitActions } from '~/utils/resource-header'

  const props = defineProps<{
    title: string
    meta: HeaderMeta[]
    identifiers: HeaderIdentifier[]
    actions: HeaderAction[]
  }>()
  defineSlots<{
    'avatar': (props: { large: boolean }) => unknown
    'identifiers-append'?: () => unknown
    'default'?: () => unknown
  }>()

  const { t } = useI18n()
  const copy = useClipboard()
  const { width } = useDisplay()
  const { mainRect } = useLayout()

  // The content area: the window without the app bar's rail and the
  // drawers that take room beside it (H2).
  const layout = computed(() => headerLayout(width.value - mainRect.value.left - mainRect.value.right))
  const split = computed(() => splitActions(props.actions, layout.value))
  const regularMenu = computed(() => split.value.menu.filter(action => !action.danger))
  const dangerMenu = computed(() => split.value.menu.filter(action => action.danger))
  const menuShown = computed(() => split.value.menu.length > 0 || (layout.value === 'narrow' && props.identifiers.length > 0))
  const metaText = computed(() => props.meta.map(item => item.text).join(' · '))

  const showIdentifiers = ref(false)
</script>
