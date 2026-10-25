import type { Target } from '#shared/contract'
import { useQuery } from '@pinia/colada'

/**
 * The open AASX packages, from the target list the layout reads too (the
 * same query), and whether the lists show them as groups: while a package
 * is the current target and another one is open (package editing plan, M1).
 */
export function useOpenPackages (currentTargetId: () => string | null) {
  const api = useStudioApi()
  const targets = useQuery({
    key: ['targets'],
    query: ({ signal }) => api<{ items: Target[] }>('/targets', { signal }),
  })
  const packages = computed(() => (targets.data.value?.items ?? []).filter(target => target.workspace))
  const grouped = computed(() => packages.value.length > 1 && packages.value.some(target => target.id === currentTargetId()))
  return { packages, grouped }
}

/** Which package groups are expanded, for the session; the current package's group is unless the user collapsed it (M3). */
export function usePackageGroupState () {
  const expanded = useState<Record<string, boolean>>('studio-package-groups', () => ({}))
  return {
    isOpen: (targetId: string, current: boolean) => expanded.value[targetId] ?? current,
    toggle: (targetId: string, current: boolean) => {
      expanded.value = { ...expanded.value, [targetId]: !(expanded.value[targetId] ?? current) }
    },
    /** The current package's group stays open when the user moves on to another package. */
    remember: (targetId: string) => {
      if (!(targetId in expanded.value)) {
        expanded.value = { ...expanded.value, [targetId]: true }
      }
    },
  }
}
