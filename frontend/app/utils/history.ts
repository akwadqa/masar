import type { HistoryEntry } from '~/types/api'
import { formatDuration } from '~/utils/duration'
import { formatDueDate, formatLongDate } from '~/utils/format'

// Plain-English sentences for Task history entries (ADR-057). Only resolved, permitted names arrive
// from the server; anything missing reads neutrally instead of being invented.
const FIELD_LABELS: Record<string, string> = {
  title: 'the title', description: 'the description', status: 'the status', priority: 'the priority', dueDate: 'the due date',
  isImportant: 'Important', isMyDay: 'My Day', remainingMinutes: 'the remaining time', feature: 'the Feature', release: 'the Release'
}

function value(field: string | undefined, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return 'none'
  if (field === 'dueDate') return formatDueDate(String(raw))
  if (field === 'isImportant' || field === 'isMyDay') return raw ? 'on' : 'off'
  if (field === 'remainingMinutes') return formatDuration(Number(raw))
  return String(raw)
}

export function describeHistory(entry: HistoryEntry): string {
  const who = entry.actor?.fullName ?? 'Someone'
  switch (entry.event) {
    case 'created': return `${who} created the task`
    case 'completed': return `${who} completed the task`
    case 'reopened': return `${who} reopened the task`
    case 'assigned': return `${who} assigned ${entry.user?.fullName ?? 'a member'}`
    case 'unassigned': return `${who} unassigned ${entry.user?.fullName ?? 'a member'}`
    case 'owner_changed': return `${who} made ${(entry.to as { fullName?: string } | null)?.fullName ?? 'nobody'} the task owner`
    case 'label_added': return `${who} added the label ${entry.label ?? '(deleted label)'}`
    case 'label_removed': return `${who} removed the label ${entry.label ?? '(deleted label)'}`
    case 'batch_added': return entry.carriedFrom
      ? `${who} carried the task over from ${entry.carriedFrom} to ${entry.batch ?? 'another Sprint'}`
      : `${who} planned the task into ${entry.batch ?? 'a Sprint'}`
    case 'batch_removed': return `${who} took the task out of ${entry.batch ?? 'a Sprint'}`
    case 'action_promoted': return `${who} promoted an Action to the task ${entry.task ?? '(no longer available)'}`
    case 'promoted_from_action': return `${who} created this task from an Action of ${entry.task ?? 'another task'}`
    case 'comment_deleted': return entry.moderated
      ? `${who} removed a comment by ${entry.author?.fullName ?? 'a member'}`
      : `${who} deleted their comment`
    case 'time_edited': {
      const from = entry.from as { minutes: number, workDate: string } | undefined
      const to = entry.to as { minutes: number, workDate: string } | undefined
      if (!from || !to) return `${who} corrected a time entry`
      const parts = []
      if (from.minutes !== to.minutes) parts.push(`${formatDuration(from.minutes)} → ${formatDuration(to.minutes)}`)
      if (from.workDate !== to.workDate) parts.push(`${formatLongDate(from.workDate)} → ${formatLongDate(to.workDate)}`)
      if (entry.noteChanged) parts.push('note updated')
      return `${who} corrected a time entry (${parts.join(', ') || 'no change'})`
    }
    case 'time_voided': return entry.moderated
      ? `${who} voided ${formatDuration(entry.minutes ?? 0)} logged by ${entry.worker?.fullName ?? 'a member'}${entry.reason ? `: ${entry.reason}` : ''}`
      : `${who} voided their ${formatDuration(entry.minutes ?? 0)} entry${entry.reason ? `: ${entry.reason}` : ''}`
    case 'attachment_added': return `${who} attached ${entry.fileName ?? 'a file'}`
    case 'attachment_removed': return `${who} removed ${entry.fileName ?? 'a file'}`
    case 'field_changed': {
      const field = entry.field ?? ''
      const label = FIELD_LABELS[field] ?? field
      if (field === 'description') return `${who} edited the description`
      // The nightly Overdue change runs as the system account (client revision 2).
      if (field === 'status' && entry.to === 'Overdue') {
        return entry.actor && entry.actor.name !== 'Administrator'
          ? `${who} set the status to Overdue`
          : 'Masar set the status to Overdue: the due date passed'
      }
      if (field === 'isImportant' || field === 'isMyDay') return `${who} turned ${label} ${value(field, entry.to)}`
      if (field === 'remainingMinutes') {
        if (entry.to === null || entry.to === undefined) return `${who} cleared the remaining estimate`
        return `${who} set the remaining estimate to ${value(field, entry.to)}${entry.from === null || entry.from === undefined ? '' : ` (was ${value(field, entry.from)})`}`
      }
      return `${who} changed ${label} from ${value(field, entry.from)} to ${value(field, entry.to)}`
    }
    default: return `${who} updated the task`
  }
}
