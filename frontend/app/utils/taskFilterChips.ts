import type { FilterOperator, Priority, TaskFilterField, TaskListFilters, TaskStatus } from '~/types/api'
import { PRIORITIES, TASK_STATUSES } from '~/types/api'

// Filter chips of the Task Lists (specs/dynamic-task-filters.md): one chip per field, values of a
// chip are OR, chips are AND. Pure helpers shared by the URL state, the API query and the UI.

export const CHIP_OPERATORS: Record<TaskFilterField, FilterOperator[]> = {
  status: ['is', 'not'],
  assignee: ['is', 'not', 'empty', 'set'],
  owner: ['is', 'not'],
  priority: ['is', 'not'],
  label: ['is', 'not', 'empty', 'set'],
  // The Space chip is the scope of All Tasks (labels need exactly one Space), so only "is".
  space: ['is']
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  not: 'is not',
  empty: 'is empty',
  set: 'is not empty'
}

/** URL query parameter of each chip; its operator is `<param>_op`. */
export const CHIP_PARAMS: Record<TaskFilterField, string> = {
  status: 'status',
  assignee: 'assignee',
  owner: 'owner',
  priority: 'priority',
  label: 'label',
  space: 'spaces'
}

/** API parameter of each chip's operator (masar.api.tasks._filters). */
const API_OPERATOR_PARAMS: Partial<Record<TaskFilterField, string>> = {
  status: 'statuses_op',
  assignee: 'assignees_op',
  owner: 'owners_op',
  priority: 'priority_op',
  label: 'label_op'
}

export const takesValues = (operator: FilterOperator) => operator === 'is' || operator === 'not'

/** A known operator for this field, else `is`: hand-edited links never produce an invalid request. */
export function parseOperator(field: TaskFilterField, raw: unknown): FilterOperator {
  return CHIP_OPERATORS[field].find(op => op === raw) ?? 'is'
}

export function operatorOf(filters: Partial<TaskListFilters>, field: TaskFilterField): FilterOperator {
  return filters.operators?.[field] ?? 'is'
}

export function chipValues(filters: Partial<TaskListFilters>, field: TaskFilterField): string[] {
  const values = {
    status: filters.statuses,
    assignee: filters.assignees,
    owner: filters.owners,
    priority: filters.priorities,
    label: filters.labels,
    space: filters.spaces
  }[field]
  return values ?? []
}

/** Whether the chip narrows the list: "is empty"/"is not empty" always, the others once a value is chosen. */
export function chipIsActive(filters: Partial<TaskListFilters>, field: TaskFilterField): boolean {
  const operator = operatorOf(filters, field)
  return !takesValues(operator) || chipValues(filters, field).length > 0
}

/** Parses the chip fields of a URL query. */
export function parseChips(read: (key: string) => string | undefined) {
  const list = (field: TaskFilterField) => read(CHIP_PARAMS[field])?.split(',').filter(Boolean) ?? []
  const operators: Partial<Record<TaskFilterField, FilterOperator>> = {}
  for (const field of Object.keys(CHIP_OPERATORS) as TaskFilterField[]) {
    const operator = parseOperator(field, read(`${CHIP_PARAMS[field]}_op`))
    if (operator !== 'is') operators[field] = operator
  }
  return {
    statuses: list('status').filter((s): s is TaskStatus => TASK_STATUSES.includes(s as TaskStatus)),
    assignees: list('assignee'),
    owners: list('owner'),
    priorities: list('priority').filter((p): p is Priority => PRIORITIES.includes(p as Priority)),
    labels: list('label'),
    operators
  }
}

/** URL patch that sets one chip; `is` and unused values are never written, so links stay short. */
export function chipQuery(field: TaskFilterField, operator: FilterOperator, values: string[]) {
  const param = CHIP_PARAMS[field]
  return {
    [param]: takesValues(operator) && values.length ? values.join(',') : null,
    [`${param}_op`]: operator === 'is' ? null : operator
  }
}

/** API parameters of the chips (values and operators), only for chips that narrow the list. */
export function chipApiQuery(filters: TaskListFilters) {
  const query: Record<string, string> = {}
  const values: Record<string, TaskFilterField> = { statuses: 'status', assignees: 'assignee', owners: 'owner', priority: 'priority', label: 'label' }
  for (const [param, field] of Object.entries(values)) {
    if (!chipIsActive(filters, field)) continue
    const operator = operatorOf(filters, field)
    if (takesValues(operator)) query[param] = chipValues(filters, field).join(',')
    if (operator !== 'is') query[API_OPERATOR_PARAMS[field]!] = operator
  }
  return query
}

/**
 * Whether the chips admit a brand-new Task: open, Medium priority, unassigned, without labels. Its
 * owner is the creator, so an owner chip is treated as not admitting it (the list refetches anyway).
 */
export function chipsAdmitNewTask(filters: Partial<TaskListFilters>): boolean {
  const admits = (field: TaskFilterField, value: string | null) => {
    if (!chipIsActive(filters, field)) return true
    const operator = operatorOf(filters, field)
    if (operator === 'empty') return value === null
    if (operator === 'set') return value !== null
    const matches = value !== null && chipValues(filters, field).includes(value)
    return operator === 'is' ? matches : !matches
  }
  return admits('status', 'Open') && admits('priority', 'Medium') && admits('assignee', null)
    && admits('label', null) && !chipIsActive(filters, 'owner')
}
