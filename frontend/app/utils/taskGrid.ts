// One column template for the Task List header and rows. Columns in order:
// select · expand · title · status · space · priority · [due] · people. Narrower lists drop columns by
// changing the template together with the cells. Breakpoints are container queries (`@lg`, `@2xl`, `@4xl`),
// so a list inside a Batch box adapts to the box, not to the window.
// All Tasks shows no due column (client revision 2), hence the second template.
export const TASK_GRID = [
  'grid items-center gap-x-3',
  'grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_4.5rem]',
  '@lg:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.75rem_4.75rem]',
  '@2xl:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.75rem_4.75rem_5rem]',
  '@4xl:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.75rem_minmax(0,10rem)_5.5rem_4.75rem_5rem]'
].join(' ')

export const TASK_GRID_NO_DUE = [
  'grid items-center gap-x-3',
  'grid-cols-[1.5rem_1.5rem_minmax(0,1fr)]',
  '@lg:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.75rem]',
  '@2xl:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.75rem_5rem]',
  '@4xl:grid-cols-[1.75rem_1.5rem_minmax(0,1fr)_9.75rem_minmax(0,10rem)_5.5rem_5rem]'
].join(' ')

/** Drag payload of task rows: a JSON array of Task names the user can already see. */
export const TASK_DRAG_TYPE = 'application/x-masar-tasks'

/** Start dragging task rows: a selected row carries the whole selection. */
export function setTaskDrag(event: DragEvent, task: { name: string, title: string }, selected: ReadonlySet<string>) {
  if (!event.dataTransfer) return
  const names = selected.has(task.name) ? [...selected] : [task.name]
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify(names))
  event.dataTransfer.setData('text/plain', names.length === 1 ? task.title : `${names.length} tasks`)
}

/** Task names of a drop, or null when the drag does not carry Masar task rows. */
export function readTaskDrop(event: DragEvent): string[] | null {
  const payload = event.dataTransfer?.getData(TASK_DRAG_TYPE)
  if (!payload) return null
  try {
    const names = (JSON.parse(payload) as unknown[]).filter((name): name is string => typeof name === 'string')
    return names.length ? names : null
  } catch {
    return null
  }
}

export function carriesTasks(event: DragEvent): boolean {
  return !!event.dataTransfer?.types.includes(TASK_DRAG_TYPE)
}
