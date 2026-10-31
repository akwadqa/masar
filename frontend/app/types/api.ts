// API contracts mirrored from backend/masar/services (docs/03-system-architecture.md §7).

export type Priority = 'Lowest' | 'Low' | 'Medium' | 'High' | 'Highest'
export type SpaceRole = 'Manager' | 'Member'
export type SpaceStatus = 'In Progress' | 'Completed' | 'Cancelled' | 'Closed'
export type MasarRole = 'Masar User' | 'Masar Planner' | 'Masar Admin'

export const PRIORITIES: Priority[] = ['Highest', 'High', 'Medium', 'Low', 'Lowest']

/** Task statuses (client revision 2). People set every status except Overdue, which Masar sets after
 * the due date has passed. Completed, Closed and Cancelled are finished (`isCompleted`). */
export type TaskStatus = 'Open' | 'Working' | 'Pending Review' | 'Changes Required' | 'Overdue' | 'Closed' | 'Completed' | 'Cancelled'
export const TASK_STATUSES: TaskStatus[] = ['Open', 'Working', 'Pending Review', 'Changes Required', 'Overdue', 'Completed', 'Closed', 'Cancelled']
export const MANUAL_STATUSES: TaskStatus[] = TASK_STATUSES.filter(status => status !== 'Overdue')
export const FINISHED_STATUSES: TaskStatus[] = ['Completed', 'Closed', 'Cancelled']
export const SPACE_STATUSES: SpaceStatus[] = ['In Progress', 'Completed', 'Cancelled', 'Closed']
export const SPACE_TYPES = ['Internal', 'External'] as const
export type SpaceType = typeof SPACE_TYPES[number]
export type DesignTheme = 'ink' | 'violet' | 'teal'
export type Appearance = 'light' | 'dark' | 'system'
export const SPACE_ICON_COLORS = ['blue', 'violet', 'teal', 'green', 'amber', 'rose', 'sky', 'slate'] as const
export type SpaceIconColor = typeof SPACE_ICON_COLORS[number]

export interface Preferences {
  theme: DesignTheme
  appearance: Appearance
  /** Boxed pages (Task, Feature, Release details, settings) use the full window width */
  fullWidth: boolean
  pinnedSpaces: string[]
  /** Masar e-mails for notifications (client revision 5); the notification list is always kept */
  emailNotifications: boolean
}

export interface UserRef {
  name: string
  fullName: string
  image: string | null
}

export interface SpaceSummary {
  name: string
  title: string
  category: string | null
  status: SpaceStatus
  spaceType: SpaceType
  completionDate: string | null
  /** ISO datetime the Space was created (Spaces page sort) */
  creation: string
  icon: string | null
  iconColor: SpaceIconColor | null
  owner: UserRef
  isOwner: boolean
  /** null when an administrator sees a Space they are not a member of */
  role: SpaceRole | null
  memberCount: number
  /** null for Spaces the user is not a member of (task data is member-only) */
  openTaskCount: number | null
}

export interface SpaceMember extends UserRef {
  role: SpaceRole
  addedAt?: string | null
}

export interface SpacePermissions {
  isMember: boolean
  canViewTasks: boolean
  canCreateTasks: boolean
  canEditTasks: boolean
  canEditDetails: boolean
  canManageMembers: boolean
  canChangeStatus: boolean
  canTransferOwnership: boolean
  /** Space owner or Masar administrator: deletes the Space and everything in it */
  canDelete: boolean
  /** Space files: members read them, Space Managers add and remove them */
  canViewFiles: boolean
  canManageFiles: boolean
  allowedStatuses: SpaceStatus[]
}

export interface SpaceDetail {
  name: string
  title: string
  category: string | null
  status: SpaceStatus
  spaceType: SpaceType
  completionDate: string | null
  icon: string | null
  iconColor: SpaceIconColor | null
  /** Markdown (like Task descriptions) */
  details: string | null
  gameplanUrl: string | null
  owner: UserRef
  members: SpaceMember[]
  myRole: SpaceRole | null
  modified: string
  permissions: SpacePermissions
}

export interface EditableSpaceFields {
  title: string
  category: string | null
  details: string | null
  completionDate: string | null
  spaceType: SpaceType
  gameplanUrl: string | null
  icon?: string | null
  iconColor?: SpaceIconColor | null
}

export interface CreateSpaceInput extends Partial<EditableSpaceFields> {
  title: string
  owner: string
}

export interface RemovalImpact {
  assignedTasks: number
  openAssignedTasks: number
  ownedTasks: number
  ownershipMoves: number
  tasksLeftUnassigned: number
  isOwner: boolean
}

export type Boot =
  | { authenticated: false }
  | {
      authenticated: true
      user: string
      fullName: string
      userImage: string | null
      isMasarUser: boolean
      roles: MasarRole[]
      hasDeskAccess: boolean
      canCreateSpaces: boolean
      spaces: SpaceSummary[]
      csrfToken: string
      preferences: Preferences | null
      timezone: string
      serverTime: string
    }

export type AuthenticatedBoot = Extract<Boot, { authenticated: true }>

export interface LabelRef {
  name: string
  title: string
  color: LabelColor
}

// Nuxt UI semantic colours, so labels follow the theme in light and dark mode.
export type LabelColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'
export const LABEL_COLORS: LabelColor[] = ['neutral', 'primary', 'secondary', 'success', 'info', 'warning', 'error']

export interface Label extends LabelRef {
  space: string
}

export interface TaskAction {
  name: string
  task: string
  title: string
  isDone: boolean
  doneBy: UserRef | null
  doneAt: string | null
  sortOrder: number
  promotedTask: string | null
  promotedAt: string | null
  promotedTaskCompleted?: boolean | null
  createdBy: string
  modified: string
  clientRequestId: string | null
}

export interface PromoteResult {
  action: TaskAction
  task: TaskDetail
  created: boolean
}

export interface TaskSearchResult {
  name: string
  title: string
  space: string
  spaceTitle: string | null
  status: TaskStatus
  isCompleted: boolean
}

// ----------------------------------------------------------------------------- planning (ADR-034 … ADR-040)

export type RoadmapColumn = 'Now' | 'Next' | 'Later' | 'Done'
export const ROADMAP_COLUMNS: RoadmapColumn[] = ['Now', 'Next', 'Later', 'Done']
export type ReleaseStatus = 'Planned' | 'Released' | 'Archived'
export const RELEASE_STATUSES: ReleaseStatus[] = ['Planned', 'Released', 'Archived']

export interface FeatureRef {
  name: string
  title: string
  roadmap: RoadmapColumn
}

export interface ReleaseRef {
  name: string
  title: string
  status: ReleaseStatus
}

/** Completed linked Tasks / all linked Tasks; `percent` is null when there are no Tasks. */
export interface PlanningProgress {
  total: number
  completed: number
  open: number
  percent: number | null
}

export interface PlanningPermissions {
  canManage: boolean
  canLinkTasks: boolean
}

export interface Feature {
  name: string
  space: string
  title: string
  roadmap: RoadmapColumn
  sortOrder: number
  progress: PlanningProgress
  modified: string
  /** Roadmap list only: up to four people on the Feature's open Tasks */
  people?: UserRef[]
  /** Cross-Space lists (All Tasks) only */
  spaceTitle?: string
}

export interface FeatureDetail extends Feature {
  description: string | null
  createdBy: UserRef | null
  creation: string
  spaceTitle: string
  permissions: PlanningPermissions
  /** Present on move responses: open Tasks of the Feature (warn when moved to Done). */
  openTasks?: number
}

export interface Release {
  name: string
  space: string
  releaseName: string
  releaseDate: string | null
  status: ReleaseStatus
  releasedAt: string | null
  releasedBy: UserRef | null
  progress: PlanningProgress
  modified: string
  /** Cross-Space lists (All Tasks) only */
  spaceTitle?: string
}

export interface ReleaseDetail extends Release {
  notes: string | null
  createdBy: UserRef | null
  creation: string
  spaceTitle: string
  allowedStatuses: ReleaseStatus[]
  permissions: PlanningPermissions
  openTasks?: number
}

export interface PlanningList<T> {
  items: T[]
  permissions: PlanningPermissions
}

// ----------------------------------------------------------------------------- Batches (ADR-043 … ADR-050)

export type BatchStatus = 'Planned' | 'Active' | 'Finished'
export const BATCH_STATUSES: BatchStatus[] = ['Planned', 'Active', 'Finished']
export type BatchPreset = 'one_week' | 'two_weeks'
export type BatchOutcome = 'Open' | 'Completed' | 'Carried Over' | 'Returned' | 'Removed'

export interface BatchRef {
  name: string
  title: string
  status: BatchStatus
}

/** Counts cover only the viewer's own Spaces (or one Space on a Space tab). `percent` is null with no tasks. */
export interface BatchProgress {
  total: number
  completed: number
  open: number
  percent: number | null
  addedAfterStart: number
  removed: number
}

export interface Batch {
  name: string
  batchName: string
  startDate: string
  endDate: string
  durationDays: number
  status: BatchStatus
  owner: UserRef
  isOwner: boolean
  startedAt: string | null
  finishedAt: string | null
  progress: BatchProgress
  canManage: boolean
}

export interface BatchDetail extends Batch {
  startedBy: UserRef | null
  finishedBy: UserRef | null
  finishCarry: 'Unbatched' | 'Batch' | null
  finishDestination: { name: string, batchName: string } | null
  ownerLacksAccess: boolean
  ownerLacksAuthority: boolean
  canClaim: boolean
}

export interface BatchList {
  items: Batch[]
  permissions: { canCreate: boolean }
}

export interface BatchHistoryRow {
  name: string
  /** null when the task was deleted later; the participation result is kept */
  task: TaskListRow | null
  outcome: BatchOutcome
  completedAtFinish: boolean | null
  addedAfterStart: boolean
  addedAt: string | null
  removedAt: string | null
  carriedTo: { name: string, batchName: string } | null
  carriedFrom: { name: string, batchName: string } | null
}

export interface FinishPreview {
  completed: number
  unfinished: number
  unfinishedInClosedSpaces: number
  destinations: Array<{ name: string, batchName: string, startDate: string }>
}

export interface FinishResult {
  batch: BatchDetail
  completed: number
  carriedOver: number
  returned: number
}

export interface TaskListRow {
  name: string
  title: string
  space: string
  spaceTitle?: string | null
  labels: LabelRef[]
  feature: FeatureRef | null
  release: ReleaseRef | null
  /** Current Planned or Active Batch */
  batch: BatchRef | null
  priority: Priority
  dueDate: string | null
  status: TaskStatus
  /** Derived from the status: Completed, Closed or Cancelled */
  isCompleted: boolean
  isImportant: boolean
  isMyDay: boolean
  assignees: UserRef[]
  taskOwner: string | null
  /** The owner's person; may be outside the assignees (Tasks imported from ERPNext keep their creator) */
  taskOwnerRef?: UserRef | null
  actionCount: number
  actionDoneCount: number
  commentCount: number
  /** Files shown in Task details (client revision 5); absent in older responses */
  attachmentCount?: number
  sortOrder: number
  modified: string
  clientRequestId: string | null
}

export interface TaskDetail extends TaskListRow {
  description: string | null
  remainingMinutes: number | null
  loggedMinutes: number
  createdBy: UserRef | null
  creation: string
  completedBy: UserRef | null
  completedAt: string | null
  spaceTitle: string
  sourceTask: { name: string, title: string } | null
  sourceAction: string | null
  permissions: { canEdit: boolean, canDelete: boolean }
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export type DueFilter = 'overdue' | 'today' | 'week' | 'none'
/** `manual` remains for Batch boxes; the Task Lists offer `recently_updated` and `created`. */
export type TaskSort = 'manual' | 'recently_updated' | 'due_date' | 'created'

/** Filter chip operators (specs/dynamic-task-filters.md); sent as `<filter>_op`, `is` is the default. */
export type FilterOperator = 'is' | 'not' | 'empty' | 'set'
export type TaskFilterField = 'status' | 'assignee' | 'owner' | 'priority' | 'label' | 'space'

export interface TaskListFilters {
  completed: 'open' | 'completed' | 'all'
  assignedToMe: boolean
  ownedByMe: boolean
  important?: boolean
  myDay?: boolean
  /** Exact statuses; when empty, `completed` decides (open = unfinished statuses) */
  statuses?: TaskStatus[] | null
  /** Task owners (user ids) */
  owners?: string[] | null
  /** Task assignees (user ids): Tasks assigned to any of them */
  assignees?: string[] | null
  priorities?: Priority[] | null
  due?: DueFilter | null
  /** Label names (one Space's labels) */
  labels?: string[] | null
  /** Operator of each filter chip; a missing field means `is` */
  operators?: Partial<Record<TaskFilterField, FilterOperator>> | null
  /** Feature / Release name, or 'none' for Tasks without one */
  feature?: string | null
  release?: string | null
  /** Batch name, 'none' (unbatched) or 'any' (in a current Batch) */
  batch?: string | null
  q?: string | null
  space?: string | null
  /** Cross-Space scope (All Tasks): only these authorised Spaces */
  spaces?: string[] | null
  sort: TaskSort
}

export type BulkOperation = 'priority' | 'add_label' | 'remove_label' | 'add_assignee' | 'remove_assignee' | 'set_completed' | 'set_status'
  | 'set_feature' | 'set_release' | 'set_batch'

export interface BulkResult {
  changed: string[]
  unchanged: string[]
  items: TaskListRow[]
}

export interface EditableTaskFields {
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  dueDate: string | null
  isImportant: boolean
  isMyDay: boolean
  remainingMinutes: number | null
  /** Feature / Release names; the server answers with refs on the Task */
  feature: string | null
  release: string | null
}

export interface CreateTaskResult {
  task: TaskDetail
  created: boolean
}

export interface FieldConflict {
  field: string
  current: unknown
  yours: unknown
}

// ----------------------------------------------------------------------------- collaboration (ADR-051 … ADR-057)

export type ReactionKey = 'thumbs_up' | 'heart' | 'tada' | 'smile' | 'eyes' | 'check'
export const REACTIONS: Array<{ key: ReactionKey, emoji: string, label: string }> = [
  { key: 'thumbs_up', emoji: '👍', label: 'Thumbs up' },
  { key: 'heart', emoji: '❤️', label: 'Heart' },
  { key: 'tada', emoji: '🎉', label: 'Celebrate' },
  { key: 'smile', emoji: '😄', label: 'Smile' },
  { key: 'eyes', emoji: '👀', label: 'Looking' },
  { key: 'check', emoji: '✅', label: 'Done' }
]

export interface CommentReaction {
  emoji: ReactionKey
  count: number
  mine: boolean
  /** Display names of the people who reacted */
  users: string[]
}

export interface AttachmentRef {
  name: string
  fileName: string
  /** Private, authorised URL (/private/files/…) */
  url: string
  size: number
  isImage: boolean
  contentType: string
}

/** A private Space file (BRD, customer documents, project material) */
export interface SpaceFile extends AttachmentRef {
  uploadedBy: UserRef | null
  uploadedAt: string
  canDelete: boolean
}

export interface TaskAttachment extends AttachmentRef {
  comment: string | null
  uploadedBy: UserRef | null
  uploadedAt: string
  canDelete: boolean
}

export interface TaskComment {
  name: string
  task: string
  author: UserRef | null
  /** Server-sanitised HTML; null once deleted */
  content: string | null
  createdAt: string
  editedAt: string | null
  modified: string
  isDeleted: boolean
  deletedAt: string | null
  deletedBy: UserRef | null
  reactions: CommentReaction[]
  attachments: AttachmentRef[]
  permissions: { canEdit: boolean, canDelete: boolean, canReact: boolean }
}

export interface HistoryEntry {
  event: string
  actor: UserRef | null
  field?: string
  from?: unknown
  to?: unknown
  user?: UserRef | null
  label?: string | null
  batch?: string | null
  carriedFrom?: string | null
  author?: UserRef | null
  moderated?: boolean
  fileName?: string
  task?: string | null
  title?: string
  worker?: UserRef | null
  minutes?: number
  reason?: string | null
  noteChanged?: boolean
}

export type TimelineView = 'all' | 'comments' | 'history' | 'worklog'
export type TimelineItem =
  | { kind: 'comment', id: string, at: string, comment: TaskComment }
  | { kind: 'history', id: string, at: string, history: HistoryEntry }
  | { kind: 'time', id: string, at: string, entry: TimeEntry }

export interface TimelinePage {
  items: TimelineItem[]
  earlierCursor: string | null
  laterCursor: string | null
  /** True since Phase 7 (Time Entries) */
  worklogAvailable: boolean
}

// ----------------------------------------------------------------------------- time tracking (ADR-060 … ADR-063)

export interface TimeEntry {
  name: string
  task: string
  worker: UserRef | null
  /** Qatar business date (YYYY-MM-DD) */
  workDate: string
  minutes: number
  description: string | null
  loggedAt: string
  modified: string
  editedAt: string | null
  isVoided: boolean
  voidedAt: string | null
  voidedBy: UserRef | null
  voidReason: string | null
  permissions: { canEdit: boolean, canVoid: boolean }
}

export interface TimeResult {
  entry: TimeEntry
  task: TaskDetail
  created: boolean
}

export type TimerState = 'Running' | 'Paused' | 'Stopped' | 'Discarded'

/** A persisted start/stop timer of the session user (one active timer per person). */
export interface TimerSession {
  name: string
  task: string
  taskTitle: string | null
  space: string
  state: TimerState
  startedAt: string
  /** Measured seconds at `serverTime`, excluding paused time */
  elapsedSeconds: number
  serverTime: string
  timeEntry: string | null
}

export interface TimerStopResult extends TimerSession {
  logged: boolean
  minutes?: number
  result?: TimeResult
}

// --------------------------------------------------------------------------- notifications (client revision 5)

export type NotificationKind = 'Assigned' | 'Task Owner' | 'Overdue' | 'Mention' | 'Comment' | 'Space Member' | 'Space Role' | 'Space Owner'

export interface MasarNotification {
  name: string
  kind: NotificationKind
  /** Who caused it; null for changes made by Masar itself (Overdue) */
  actor: UserRef | null
  space: string | null
  task: string | null
  subject: string
  detail: string | null
  /** Workspace path it opens, e.g. /tasks/<name> */
  link: string | null
  isRead: boolean
  at: string
}

export interface NotificationPage {
  items: MasarNotification[]
  nextBefore: string | null
  unread: number
}
