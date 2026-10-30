/** Frappe's own login page (client revision 4: Masar has no sign-in page of its own). After signing in,
 *  Frappe returns to `sitePath`, a path on this site such as /masar/tasks. */
export function frappeLoginUrl(sitePath: string): string {
  const back = sitePath.startsWith('/') && !sitePath.startsWith('//') ? sitePath : '/masar'
  return `/login?redirect-to=${encodeURIComponent(back)}`
}
