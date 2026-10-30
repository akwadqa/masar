/** Copies a link to a Workspace page. Links are built by the router, so they carry the Workspace's
 *  base path (/masar since client revision 4); a bare `/tasks/…` would open nothing. */
export function useCopyLink() {
  const router = useRouter()
  const toast = useToast()

  return async function copyLink(path: string, title = 'Link copied') {
    const url = new URL(router.resolve(path).href, window.location.origin).href
    try {
      await navigator.clipboard.writeText(url)
      toast.add({ title, icon: 'i-lucide-link', color: 'neutral' })
    } catch {
      toast.add({ title: 'Copy failed', description: url, color: 'warning' })
    }
  }
}
