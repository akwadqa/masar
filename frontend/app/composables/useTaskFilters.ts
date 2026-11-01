import type { LocationQuery } from 'vue-router'
import type { DueFilter, TaskFilterField, TaskListFilters, TaskSort } from '~/types/api'
import { CHIP_OPERATORS, CHIP_PARAMS, chipIsActive, parseChips } from '~/utils/taskFilterChips'
import { nextColumnSort, parseColumnSort, type TaskColumn } from '~/utils/taskSort'
import { readSavedFilters, saveFilters } from '~/utils/savedFilters'
import { parseMine } from '~/utils/mineFilter'

const DUE: DueFilter[] = ['overdue', 'today', 'week', 'none']
const SORT_PARAMS: Record<string, TaskSort> = { recent: 'recently_updated', due: 'due_date', created: 'created', manual: 'manual' }
const CHIP_FIELDS = Object.keys(CHIP_OPERATORS) as TaskFilterField[]
/** Query parameters that describe a list's filters and sorting (saved per list); others, such as the
 *  open task panel (`task`, `comment`), are never saved or restored. */
export const FILTER_KEYS = [
  ...CHIP_FIELDS.flatMap(field => [CHIP_PARAMS[field], `${CHIP_PARAMS[field]}_op`]),
  'show', 'mine', 'important', 'myday', 'due', 'feature', 'release', 'batch', 'q', 'space', 'sort', 'order', 'dir', 'group'
]

/**
 * Task filters stored in the URL query (shareable, survive reloads and back navigation).
 * `sorts` limits the sorts a list offers; any other `sort` in a link falls back to the default
 * (the Task Lists dropped manual order, client decision 2026-10-31).
 *
 * With a `storageKey`, a list remembers its filters in this browser (client revision 6, 2026-11-01):
 * opening the list without filters in the link brings back the last ones; a link that carries
 * filters wins and becomes the remembered state; clearing the filters is remembered too.
 */
export function useTaskFilters(
  defaults: Partial<TaskListFilters> = {},
  sorts?: TaskSort[],
  options: { storageKey?: MaybeRefOrGetter<string | null | undefined> } = {}
) {
  const route = useRoute()
  const router = useRouter()

  // While a restored query is on its way into the URL, filters already read it (no fetch of the
  // unfiltered list first).
  const restoring = shallowRef<LocationQuery | null>(null)
  const query = computed(() => restoring.value ?? route.query)
  const str = (key: string) => (typeof query.value[key] === 'string' ? query.value[key] as string : undefined)
  const filterPart = (source: LocationQuery) =>
    Object.fromEntries(FILTER_KEYS.flatMap(key => (typeof source[key] === 'string' && source[key] ? [[key, source[key] as string]] : [])))

  // The page the remembered filters belong to: while leaving it, the route may already show another
  // page, whose (empty) filters must not overwrite the remembered ones.
  let listPath = route.path
  function restore() {
    listPath = route.path
    const key = toValue(options.storageKey)
    if (!key || Object.keys(filterPart(route.query)).length) return
    const saved = readSavedFilters(key)
    if (!saved || !Object.keys(saved).length) return
    const next = { ...route.query, ...saved }
    restoring.value = next
    void router.replace({ query: next }).finally(() => { restoring.value = null })
  }
  watch(() => toValue(options.storageKey), restore, { immediate: true })
  watch(() => [toValue(options.storageKey), JSON.stringify(filterPart(route.query))] as const, ([key, part]) => {
    if (key && !restoring.value && route.path === listPath) saveFilters(key, JSON.parse(part))
  })

  function parseSort(): TaskSort {
    const sort = SORT_PARAMS[str('sort') ?? '']
    const fallback = defaults.sort ?? 'manual'
    return sort && (!sorts || sorts.includes(sort)) ? sort : fallback
  }

  const filters = computed<TaskListFilters>(() => {
    const show = str('show')
    return {
      completed: show === 'completed' || show === 'all' || show === 'open' ? show : (defaults.completed ?? 'open'),
      ...parseMine(str('mine'), defaults.assignedToMe),
      important: str('important') === '1',
      myDay: str('myday') === '1',
      ...parseChips(str),
      due: DUE.find(d => d === str('due')) ?? null,
      feature: str('feature') ?? null,
      release: str('release') ?? null,
      batch: str('batch') ?? null,
      q: str('q') ?? null,
      space: str('space') ?? null,
      spaces: str('spaces')?.split(',').filter(Boolean) ?? null,
      sort: parseSort()
    }
  })

  /** Header sorting (client revision 6); null = the server order of `filters.sort`. */
  const columnSort = computed(() => parseColumnSort(str('order'), str('dir')))

  function setQuery(patch: Record<string, string | undefined | null>) {
    // Choosing a sort in the Sort menu replaces a column header sort.
    const sortChoice = 'sort' in patch && !('order' in patch) ? { order: null, dir: null } : {}
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries({ ...query.value, ...patch, ...sortChoice })) {
      if (typeof value === 'string' && value !== '') next[key] = value
    }
    void router.replace({ query: next })
  }

  function sortByColumn(column: TaskColumn) {
    const sort = nextColumnSort(columnSort.value, column)
    setQuery({ order: sort.column, dir: sort.direction })
  }

  const activeCount = computed(() => {
    const f = filters.value
    const chips = CHIP_FIELDS.filter(field => chipIsActive(f, field)).length
    return chips + [f.important, f.myDay, f.due, f.feature, f.release, f.batch, f.q].filter(Boolean).length
  })

  function clearFilters() {
    const chips = Object.fromEntries(CHIP_FIELDS.flatMap(field => [[CHIP_PARAMS[field], null], [`${CHIP_PARAMS[field]}_op`, null]]))
    setQuery({ ...chips, important: null, myday: null, due: null, feature: null, release: null, batch: null, q: null })
  }

  return { filters, columnSort, setQuery, sortByColumn, activeCount, clearFilters }
}
