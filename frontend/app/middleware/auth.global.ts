import { frappeLoginUrl } from '~/utils/redirect'

// Every Workspace route requires a Frappe session. Signing in happens on Frappe's own login page
// (client revision 4), which brings the person back to the page they asked for.
export default defineNuxtRouteMiddleware(async (to) => {
  const { loadBoot } = useSession()
  let boot
  try {
    boot = await loadBoot()
  } catch {
    // Backend unreachable: let the page render its error state instead of looping redirects.
    return
  }
  if (!boot.authenticated) return navigateTo(frappeLoginUrl(useRouter().resolve(to.fullPath).href), { external: true })
})
