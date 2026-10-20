import { decodeResourceKey, resourceKey } from '~/utils/aas'

/**
 * The search of a record list (MVP-4 plan, S2): the Web UI's expression
 * syntax, or a raw query from the advanced dialog, kept in the URL as
 * `?search=` and `?query=` (base64url JSON) so that links and reloads keep
 * the list. The typed expression applies once typing pauses.
 */
export function useListSearch () {
  const route = useRoute()
  const router = useRouter()

  function queryFromRoute (): Record<string, unknown> | null {
    const encoded = route.query.query
    const json = typeof encoded === 'string' ? decodeResourceKey(encoded) : null
    try {
      const value: unknown = json ? JSON.parse(json) : null
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const searchFromRoute = () => (typeof route.query.search === 'string' ? route.query.search : '')

  /** The text in the search field. */
  const search = ref(searchFromRoute())
  /** The raw query of the advanced dialog, which replaces the expression. */
  const rawQuery = ref<Record<string, unknown> | null>(queryFromRoute())
  /** The expression the list is searched with. */
  const applied = ref(searchFromRoute().trim())

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  watch(search, value => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => (applied.value = value.trim()), 300)
  })

  /** The URL's part of the search, for links that keep it. */
  const searchState = computed(() => ({
    search: applied.value || undefined,
    query: rawQuery.value ? resourceKey(JSON.stringify(rawQuery.value)) : undefined,
  }))
  watch(searchState, state => {
    if (state.search !== route.query.search || state.query !== route.query.query) {
      void router.replace({ query: { ...route.query, ...state } })
    }
  })
  // Back and forward restore the search of the URL.
  watch(() => [route.query.search, route.query.query], () => {
    if (searchFromRoute().trim() !== applied.value) {
      search.value = searchFromRoute()
      applied.value = searchFromRoute().trim()
    }
    if (route.query.query !== searchState.value.query) {
      rawQuery.value = queryFromRoute()
    }
  })

  function clear () {
    search.value = ''
    applied.value = ''
    rawQuery.value = null
  }

  onScopeDispose(() => clearTimeout(searchTimer))

  return { search, applied, rawQuery, searchState, clear }
}
