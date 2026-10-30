import type { InjectionKey, Ref } from 'vue'

/** Where mobile Task pages scroll as one page instead of a list that scrolls by itself (iPhone
 *  stabilization 2026-10-30): phones in portrait and landscape, in the browser and installed. Kept in
 *  step with the `page-scroll` / `list-scroll` variants in assets/css/main.css. */
export const PAGE_SCROLL_QUERY = '(max-width: 639px), (pointer: coarse) and (max-height: 600px)'

/** Where a Task page shows its composer in page scroll (TaskListView provides it, TaskList fills it). */
export const COMPOSER_SLOT: InjectionKey<Ref<HTMLElement | null>> = Symbol('masar:composer-slot')
