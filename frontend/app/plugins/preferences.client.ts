// Applies the signed-in account's own theme and appearance as soon as the session is known, and
// returns to the default when nobody is signed in (a shared browser never shows another account's choice).
// While the session is still loading nothing changes: the head script already painted the last theme.
export default defineNuxtPlugin(() => {
  const { boot, user } = useSession()
  const preferences = usePreferences()
  watch(() => [boot.value?.authenticated, user.value?.user] as const, ([authenticated]) => {
    if (user.value?.preferences) preferences.apply(user.value.preferences)
    else if (authenticated === false) preferences.reset()
  }, { immediate: true })
  // Boxed pages (class masar-boxed) widen to the window when the user chose full-width pages.
  watch(preferences.fullWidth, (value) => {
    document.documentElement.toggleAttribute('data-full-width', value)
  }, { immediate: true })
})
