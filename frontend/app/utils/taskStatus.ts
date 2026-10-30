import type { TaskStatus } from '~/types/api'

// Presentation of the Task statuses. Colours are semantic tokens (assets/css/themes.css), so every
// theme and appearance shows the same meaning; the label is always visible, never colour alone.
export interface StatusStyle { icon: string, text: string, tint: string, dot: string }

export const STATUS_STYLES: Record<TaskStatus, StatusStyle> = {
  'Open': { icon: 'i-lucide-circle', text: 'text-open', tint: 'bg-open-tint', dot: 'bg-open' },
  'Working': { icon: 'i-lucide-loader', text: 'text-status-working', tint: 'bg-status-working/12', dot: 'bg-status-working' },
  'Pending Review': { icon: 'i-lucide-eye', text: 'text-status-review', tint: 'bg-status-review/12', dot: 'bg-status-review' },
  'Changes Required': { icon: 'i-lucide-pencil-line', text: 'text-status-changes', tint: 'bg-status-changes/14', dot: 'bg-status-changes' },
  'Overdue': { icon: 'i-lucide-alarm-clock', text: 'text-overdue', tint: 'bg-overdue-tint', dot: 'bg-overdue' },
  'Completed': { icon: 'i-lucide-circle-check', text: 'text-success', tint: 'bg-success-tint', dot: 'bg-success' },
  'Closed': { icon: 'i-lucide-archive', text: 'text-status-closed', tint: 'bg-status-closed/12', dot: 'bg-status-closed' },
  'Cancelled': { icon: 'i-lucide-ban', text: 'text-status-cancelled', tint: 'bg-status-cancelled/12', dot: 'bg-status-cancelled' }
}

export function statusStyle(status: TaskStatus | null | undefined): StatusStyle {
  return STATUS_STYLES[status ?? 'Open'] ?? STATUS_STYLES.Open
}
