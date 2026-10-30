import type { DueFilter, Priority, TaskListFilters, TaskSort, TaskStatus } from '~/types/api'
import { PRIORITIES, TASK_STATUSES } from '~/types/api'

const DUE: DueFilter[] = ['overdue', 'today', 'week', 'none']

/** Task filters stored in the URL query (shareable, survive reloads and back navigation). */
export function useTaskFilters(defaults: Partial<TaskListFilters> = {}) {
  const route = useRoute()
  const router = useRouter()

  const str = (key: string) => (typeof route.query[key] === 'string' ? route.query[key] as string : undefined)

  const filters = computed<TaskListFilters>(() => {
    const show = str('show')
    const sort = str('sort')
    const mine = str('mine') ?? (defaults.assignedToMe ? 'assigned' : undefined) // 'none' = no mine filter
    return {
      completed: show === 'completed' || show === 'all' || show === 'open' ? show : (defaults.completed ?? 'open'),
      assignedToMe: mine === 'assigned',
      ownedByMe: mine === 'owned',
      important: str('important') === '1',
      myDay: str('myday') === '1',
      statuses: (str('status')?.split(',').filter((s): s is TaskStatus => TASK_STATUSES.includes(s as TaskStatus)) ?? []),
      owners: str('owner')?.split(',').filter(Boolean) ?? [],
      priority: PRIORITIES.find(p => p === str('priority')) as Priority | undefined ?? null,
      due: DUE.find(d => d === str('due')) ?? null,
      label: str('label') ?? null,
      feature: str('feature') ?? null,
      release: str('release') ?? null,
      batch: str('batch') ?? null,
      q: str('q') ?? null,
      space: str('space') ?? null,
      spaces: str('spaces')?.split(',').filter(Boolean) ?? null,
      sort: (sort === 'recent' ? 'recently_updated' : sort === 'due' ? 'due_date' : sort === 'manual' ? 'manual' : (defaults.sort ?? 'manual')) as TaskSort
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
    return [f.important, f.myDay, f.statuses?.length, f.owners?.length, f.spaces?.length, f.priority, f.due, f.label, f.feature, f.release, f.batch, f.q].filter(Boolean).length
  })

  function clearFilters() {
    setQuery({ important: null, myday: null, status: null, owner: null, spaces: null, priority: null, due: null, label: null, feature: null, release: null, batch: null, q: null })
  }

  return { filters, setQuery, activeCount, clearFilters }
}
