import type { ConceptDescriptionDetail, CopyDependencies, CopyResourceType, ShellDetail, SubmodelDetail } from '#shared/contract'

const allDependencies: CopyDependencies = { submodels: 'referenced', conceptDescriptions: 'referenced', supplementaryFiles: 'referenced' }

/**
 * Copy and paste of shells, submodels and concept descriptions (package
 * editing plan, K1, K2, K9): *Copy* keeps where the resource is and puts
 * its AAS JSON on the system clipboard; *Paste* and *Paste from text* open
 * the copy plan dialog for a destination.
 */
export function useCopyActions () {
  const { t } = useI18n()
  const api = useStudioApi()
  const store = useClipboardStore()
  const copyText = useClipboard()
  const notifications = useNotificationsStore()

  async function copy (type: CopyResourceType, targetId: string, key: string, label: string, json: () => Promise<unknown>) {
    store.copyResource({ type, targetId, key, label })
    try {
      await copyText(JSON.stringify(await json(), null, 2), label)
    } catch {
      // Studio's clipboard has it; the system clipboard is a convenience.
      notifications.notify({ text: t('copies.copied', { name: label }), color: 'info' })
    }
  }

  const copyShell = (targetId: string, key: string, label: string) =>
    copy('shell', targetId, key, label, async () => (await api<ShellDetail>(`/targets/${targetId}/shells/${key}`)).shell)
  const copySubmodel = (targetId: string, key: string, label: string) =>
    copy('submodel', targetId, key, label, async () => (await api<SubmodelDetail>(`/targets/${targetId}/submodels/${key}`, { query: { content: 'full' } })).submodel)
  const copyConceptDescription = (targetId: string, key: string, label: string) =>
    copy('conceptDescription', targetId, key, label, async () => (await api<ConceptDescriptionDetail>(`/targets/${targetId}/concept-descriptions/${key}`)).conceptDescription)

  /** The copied resource, if it is one of these types (K2). */
  const pasteable = (...types: CopyResourceType[]) => {
    const entry = store.resource
    return entry && types.includes(entry.type) ? entry : null
  }

  /** Pastes the copied resource into a target, a submodel also into `destinationShellKey`. */
  function paste (destinationTargetId: string, destinationShellKey?: string) {
    const entry = store.resource
    if (!entry) {
      return
    }
    store.openCopy({
      request: {
        source: { kind: 'target', targetId: entry.targetId, resources: [{ type: entry.type, key: entry.key }] },
        destinationTargetId,
        destinationShellKey,
        dependencies: allDependencies,
      },
      plan: null,
      title: t('copies.pasteTitle', { name: entry.label }),
    })
  }

  /** AAS JSON or XML from the system clipboard (K9). */
  async function pasteText (destinationTargetId: string, destinationShellKey?: string) {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      notifications.notify({ text: t('copies.clipboardUnreadable'), color: 'error' })
      return
    }
    if (text.trim() === '') {
      notifications.notify({ text: t('copies.clipboardEmpty'), color: 'warning' })
      return
    }
    store.openCopy({
      request: {
        source: { kind: 'text', format: text.trimStart().startsWith('<') ? 'xml' : 'json', content: text },
        destinationTargetId,
        destinationShellKey,
        dependencies: allDependencies,
      },
      plan: null,
      title: t('copies.pasteTextTitle'),
    })
  }

  return { copyShell, copySubmodel, copyConceptDescription, pasteable, paste, pasteText }
}
