import { useEventListener } from '@vueuse/core'

/** Swipe from the left edge to go back, for the app installed on an iPhone's home screen (client
 *  revision 5). iOS offers no back gesture to installed web apps; Safari's own gesture already goes
 *  back in the browser, so this one is active only in standalone mode (never both at once).
 *  The element follows the finger and slides away, or springs back if the swipe is too short. */
const EDGE = 24
const DISTANCE = 0.3 // of the element's width
const VELOCITY = 0.45 // px per ms

export function isStandalone() {
  return import.meta.client && (
    window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function useEdgeSwipe(target: () => HTMLElement | null | undefined, onBack: () => void, enabled: () => boolean) {
  let start: { x: number, y: number, t: number } | null = null
  let dx = 0
  let horizontal: boolean | null = null

  function element() {
    return target() ?? null
  }

  function onStart(event: TouchEvent) {
    const touch = event.touches[0]
    if (!enabled() || !isStandalone() || event.touches.length !== 1 || !touch || touch.clientX > EDGE) return
    start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp }
    dx = 0
    horizontal = null
  }

  function onMove(event: TouchEvent) {
    const touch = event.touches[0]
    const el = element()
    if (!start || !touch || !el) return
    const x = touch.clientX - start.x
    const y = touch.clientY - start.y
    if (horizontal === null && Math.abs(x) + Math.abs(y) > 8) horizontal = Math.abs(x) > Math.abs(y)
    if (!horizontal) return
    event.preventDefault()
    dx = Math.max(0, x)
    el.style.transition = 'none'
    el.style.transform = `translateX(${dx}px)`
  }

  function onEnd(event: TouchEvent) {
    const el = element()
    if (!start || !el || !horizontal) {
      start = null
      return
    }
    const fast = dx / Math.max(1, event.timeStamp - start.t) > VELOCITY
    const back = dx > el.offsetWidth * DISTANCE || (fast && dx > 40)
    start = null
    el.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)'
    el.style.transform = back ? 'translateX(100%)' : ''
    if (back) setTimeout(() => {
      onBack()
      el.style.transition = ''
      el.style.transform = ''
    }, 180)
  }

  useEventListener(document, 'touchstart', onStart, { passive: true })
  useEventListener(document, 'touchmove', onMove, { passive: false })
  useEventListener(document, 'touchend', onEnd, { passive: true })
  useEventListener(document, 'touchcancel', onEnd, { passive: true })
}
