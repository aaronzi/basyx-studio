import type { Target } from '#shared/contract'
import type { MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'

/**
 * The target named in the route. Every target-scoped query key starts with
 * `['targets', targetId]`, so switching targets never reuses another
 * target's cached data.
 */
export function useTarget (targetId: MaybeRefOrGetter<string>) {
  const api = useStudioApi()
  const query = useQuery({
    key: () => ['targets', toValue(targetId)],
    query: ({ signal }) => api<Target>(`/targets/${toValue(targetId)}`, { signal }),
    enabled: () => toValue(targetId) !== '',
  })
  const needsAuthorization = computed(() => query.data.value?.authenticationState === 'required')
  /**
   * Files can be imported into the target now: it accepts uploads, or it is
   * a package, which imports through a copy plan (package editing plan,
   * E1), and the user is signed in to it.
   */
  const canImport = computed(() => Boolean(query.data.value && canImportInto(query.data.value)) && !needsAuthorization.value)
  return { ...query, needsAuthorization, canImport }
}

/** Whether files can be imported into a target: a BaSyx upload, or a copy plan into a package. */
export function canImportInto (target: Target): boolean {
  return target.capabilities.upload || (target.workspace !== null && target.capabilities.createResources)
}
