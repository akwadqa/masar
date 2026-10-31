import type { DueFilter, TaskFilterField, TaskListFilters, TaskSort } from '~/types/api'
import { CHIP_OPERATORS, CHIP_PARAMS, chipIsActive, parseChips } from '~/utils/taskFilterChips'

const DUE: DueFilter[] = ['overdue', 'today', 'week', 'none']
const SORT_PARAMS: Record<string, TaskSort> = { recent: 'recently_updated', due: 'due_date', created: 'created', manual: 'manual' }
const CHIP_FIELDS = Object.keys(CHIP_OPERATORS) as TaskFilterField[]

/**
 * Task filters stored in the URL query (shareable, survive reloads and back navigation).
 * `sorts` limits the sorts a list offers; any other `sort` in a link falls back to the default
 * (the Task Lists dropped manual order, client decision 2026-10-31).
 */
export function useTaskFilters(defaults: Partial<TaskListFilters> = {}, sorts?: TaskSort[]) {
  const route = useRoute()
  const router = useRouter()

  const str = (key: string) => (typeof route.query[key] === 'string' ? route.query[key] as string : undefined)

  function parseSort(): TaskSort {
    const sort = SORT_PARAMS[str('sort') ?? '']
    const fallback = defaults.sort ?? 'manual'
    return sort && (!sorts || sorts.includes(sort)) ? sort : fallback
  }

  const filters = computed<TaskListFilters>(() => {
    const show = str('show')
    const mine = str('mine') ?? (defaults.assignedToMe ? 'assigned' : undefined) // 'none' = no mine filter
    return {
      completed: show === 'completed' || show === 'all' || show === 'open' ? show : (defaults.completed ?? 'open'),
      assignedToMe: mine === 'assigned',
      ownedByMe: mine === 'owned',
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

  function setQuery(patch: Record<string, string | undefined | null>) {
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
      if (typeof value === 'string' && value !== '') query[key] = value
    }
    void router.replace({ query })
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

  return { filters, setQuery, activeCount, clearFilters }
}
