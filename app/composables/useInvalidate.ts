import type { EntryKey } from '@pinia/colada'
import { useQueryCache } from '@pinia/colada'

/**
 * Invalidates and refetches cached queries. A failed refetch stays in that
 * query's error state, where the page shows it, so it is not re-thrown here.
 */
export function useInvalidate () {
  const queryCache = useQueryCache()
  return async (...keys: EntryKey[]): Promise<void> => {
    await Promise.all(keys.map(key => queryCache.invalidateQueries({ key }).catch(() => {})))
  }
}
