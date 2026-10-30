/** The Task details panel of a list page, driven by `?task=` (client revision 5).
 *
 *  A Task opened from the list gets its own history entry, so Back (the edge swipe in Safari, Android's
 *  back button, the browser button) closes the panel and shows the list again, as in a native app.
 *  Moving to another Task replaces that entry, so Back always returns to the list in one step; closing
 *  from the panel goes back through the same entry. A panel opened by a link (no such entry) closes in
 *  place. */
export function useTaskPanel() {
  const route = useRoute()
  const router = useRouter()
  const activeTask = computed(() => (typeof route.query.task === 'string' ? route.query.task : null))

  function withTask(task: string | null) {
    const query = { ...route.query }
    if (task) query.task = task
    else delete query.task
    return query
  }

  function openTask(name: string) {
    if (activeTask.value === name) return
    if (activeTask.value) void router.replace({ query: withTask(name) })
    else void router.push({ query: withTask(name), state: { masarTaskPanel: true } })
  }

  function closeTask() {
    if (!activeTask.value) return
    if (window.history.state?.masarTaskPanel) router.back()
    else void router.replace({ query: withTask(null) })
  }

  return { activeTask, openTask, closeTask }
}
