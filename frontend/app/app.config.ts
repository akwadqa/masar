// Component defaults for all three Masar themes (client revision). Colours, radii and fonts come from
// semantic tokens in assets/css/themes.css, so these classes stay the same for every theme.
export default defineAppConfig({
  ui: {
    colors: {
      // The active theme maps these palettes through --ui-color-primary-* and --ui-color-neutral-*.
      primary: 'signal',
      neutral: 'neutral'
    },
    button: {
      slots: { base: 'rounded-pill font-semibold' },
      // Solid primary buttons use the theme's strong action fill (near-black, ink or deep teal).
      compoundVariants: [
        { color: 'primary', variant: 'solid', class: 'bg-action text-action-text hover:bg-action/90 active:bg-action/90 disabled:bg-action aria-disabled:bg-action' }
      ]
    },
    badge: { slots: { base: 'rounded-pill font-semibold' } },
    input: { slots: { base: 'rounded-(--ui-radius)' } },
    card: { slots: { root: 'rounded-card' } },
    modal: { slots: { content: 'rounded-card', title: 'text-section text-highlighted' } },
    popover: { slots: { content: 'rounded-card' } },
    // Lists are at least as wide as their trigger and grow to show whole items (client revision 3).
    dropdownMenu: { slots: { content: 'rounded-card min-w-56 max-w-[min(28rem,calc(100vw-2rem))]' } },
    select: { slots: { content: 'rounded-card w-auto min-w-(--reka-select-trigger-width) max-w-[min(28rem,calc(100vw-2rem))]', item: 'whitespace-nowrap' } },
    selectMenu: { slots: { content: 'rounded-card w-auto min-w-[max(var(--reka-combobox-trigger-width),16rem)] max-w-[min(28rem,calc(100vw-2rem))]' } },
    tabs: { slots: { trigger: 'font-semibold' } },
    dashboardSidebar: {
      slots: { root: 'bg-surface', header: 'px-3', body: 'px-3 gap-1', footer: 'px-3 py-3' }
    },
    // A page fills the shell (layouts/default.vue), never the whole screen: Nuxt UI's `min-h-svh` made it
    // one safe-area inset taller than the shell in the installed iPhone app, which cut off its bottom
    // (the Task composer) and let a focused field scroll the shell under the status bar.
    dashboardPanel: { slots: { root: 'min-h-0' } },
    dashboardNavbar: { slots: { title: 'text-page-title text-highlighted' } },
    navigationMenu: {
      slots: { link: 'before:rounded-pill' },
      compoundVariants: [
        { orientation: 'vertical', active: true, class: { link: 'before:bg-primary/10 text-primary font-semibold' } },
        { orientation: 'horizontal', highlight: true, active: true, class: { link: 'text-primary after:bg-primary' } }
      ]
    },
    tooltip: { slots: { content: 'bg-inverted text-inverted ring-0' } }
  }
})
