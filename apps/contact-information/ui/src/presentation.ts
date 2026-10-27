import type { ContactInformation } from '@basyx/studio-app-kit/contacts'
import type { Translate } from '@basyx/studio-app-kit/i18n'
import { fieldText } from '@basyx/studio-app-kit/aas'
import { contactName, roleText } from '@basyx/studio-app-kit/contacts'

// What a contact's card and dialog show at the top; the rows below come from
// the app kit (`contactRows`).

export interface ContactHeading {
  /** The name; without one, the company or department, else the contact's position. */
  title: string
  /** Company and department; without a name, the department under the company. */
  subtitle: string
  role: string
  /** Whether the title is a person's name. */
  named: boolean
}

export function contactHeading (t: Translate, contact: ContactInformation, index: number, locale: string): ContactHeading {
  const name = contactName(contact, locale)
  const company = fieldText(contact.fields.company, locale)
  const department = fieldText(contact.fields.department, locale)
  return {
    title: name || company || department || t('contacts.untitled', { number: index + 1 }),
    subtitle: (name ? [company, department] : (company ? [department] : [])).filter(Boolean).join(' · '),
    role: roleText(contact, locale),
    named: name !== '',
  }
}
