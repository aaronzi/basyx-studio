<template>
  <!-- In the frame Studio shows alone over its dimmed page (openFullscreen without
       header), so the dialog has the whole window; Studio dims, so it does not. -->
  <v-dialog
    max-width="720"
    :model-value="true"
    :persistent="!entered"
    :scrim="false"
    scrollable
    @after-enter="entered = true"
    @update:model-value="emit('close')"
  >
    <v-card data-test="contact-dialog">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" variant="tonal">
            <v-icon :icon="heading.named ? 'mdi-account-outline' : 'mdi-domain'" />
          </v-avatar>
        </template>

        <v-card-title class="text-break" data-test="contact-dialog-name">{{ heading.title }}</v-card-title>
        <v-card-subtitle v-if="heading.subtitle" class="text-break">{{ heading.subtitle }}</v-card-subtitle>

        <template #append>
          <v-btn
            :aria-label="t('contacts.close')"
            data-test="contact-dialog-close"
            icon="mdi-close"
            size="small"
            @click="emit('close')"
          />
        </template>
      </v-card-item>

      <div v-if="heading.role && !canEdit" class="px-4">
        <v-chip color="primary" prepend-icon="mdi-account-tie-outline" :text="heading.role" />
      </div>

      <v-card-text class="d-flex flex-column ga-3">
        <v-alert
          v-if="notice"
          closable
          data-test="notice"
          density="compact"
          :text="notice.text"
          :type="notice.type"
          @click:close="emit('dismiss')"
        />

        <DetailList :rows="rows" />
      </v-card-text>

      <v-card-actions v-if="!canEdit">
        <v-spacer />

        <v-btn
          data-test="save-vcard"
          prepend-icon="mdi-card-account-details-outline"
          :text="t('contact.save')"
          @click="emit('save')"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
  import { contactRows } from '@basyx/studio-app-kit/contacts'
  import { computed, ref } from 'vue'
  import { useRowActions } from './actions'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'
  import { contactHeading } from './presentation'

  // A contact's details: address with map, every channel and link, languages
  // and further details, and the vCard; in edit mode every element as a row.
  const props = defineProps<{ contact: ContactInformation, index: number, notice: { type: 'success' | 'error', text: string } | null }>()
  const emit = defineEmits<{ close: [], save: [], dismiss: [] }>()

  const { t, formatLocale } = useI18n()
  /** A click while the dialog fades in is not taken for one outside it. */
  const entered = ref(false)
  const { canEdit } = useRowActions()

  const heading = computed(() => contactHeading(t, props.contact, props.index, formatLocale.value))
  /** In view mode without what the heading shows. */
  const rows = computed(() => contactRows(props.contact, formatLocale.value, { edit: canEdit.value })
    .filter(row => canEdit.value || !['role', 'company', 'department'].includes(row.key)))
</script>
