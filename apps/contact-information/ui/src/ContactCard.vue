<template>
  <v-card class="h-100 d-flex flex-column" data-test="contact">
    <v-card-item>
      <template #prepend>
        <v-avatar color="primary" variant="tonal">
          <v-icon :icon="named ? 'mdi-account-outline' : 'mdi-domain'" />
        </v-avatar>
      </template>

      <v-card-title class="text-break" data-test="contact-name">{{ title }}</v-card-title>

      <v-card-subtitle v-if="subtitle" class="text-break" data-test="contact-organization">{{ subtitle }}</v-card-subtitle>
    </v-card-item>

    <div v-if="role && !canEdit" class="px-4">
      <v-chip color="primary" data-test="contact-role" prepend-icon="mdi-account-tie-outline" :text="role" />
    </div>

    <v-card-text class="flex-grow-1 pt-2">
      <DetailList :rows="rows" />
    </v-card-text>

    <v-card-actions v-if="!canEdit">
      <v-spacer />

      <v-btn
        data-test="save-vcard"
        prepend-icon="mdi-card-account-details-outline"
        size="small"
        :text="t('contact.save')"
        @click="emit('save')"
      />
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
  import { fieldText } from '@basyx/studio-app-kit/aas'
  import { contactName, contactRows, roleText } from '@basyx/studio-app-kit/contacts'
  import { computed } from 'vue'
  import { useRowActions } from './actions'
  import DetailList from './DetailList.vue'
  import { useI18n } from './i18n'

  // One contact: name (or company), organization and role at the top, then
  // address, channels and links; in edit mode every element as a row.
  const props = defineProps<{ contact: ContactInformation, index: number }>()
  const emit = defineEmits<{ save: [] }>()

  const { t, formatLocale } = useI18n()
  const { canEdit } = useRowActions()

  const name = computed(() => contactName(props.contact, formatLocale.value))
  const named = computed(() => name.value !== '')
  const company = computed(() => fieldText(props.contact.fields.company, formatLocale.value))
  const department = computed(() => fieldText(props.contact.fields.department, formatLocale.value))
  /** The name; without one, the company or department, else its position. */
  const title = computed(() => name.value || company.value || department.value || t('contacts.untitled', { number: props.index + 1 }))
  const subtitle = computed(() => (named.value ? [company.value, department.value] : (company.value ? [department.value] : [])).filter(Boolean).join(' · '))
  const role = computed(() => roleText(props.contact, formatLocale.value))

  /** In view mode without what the heading shows. */
  const rows = computed(() => contactRows(props.contact, formatLocale.value, { edit: canEdit.value })
    .filter(row => canEdit.value || !['role', 'company', 'department'].includes(row.key)))
</script>
