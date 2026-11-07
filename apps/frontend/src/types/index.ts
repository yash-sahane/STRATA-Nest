// User Roles
export type UserRole =
  | 'MANAGER'
  | 'ASSISTANT_MANAGER'
  | 'SOFTWARE_DEVELOPER'
  | 'DEVELOPER_INTERN'
  | 'TESTER'
  | 'CONTENT_ENGINEER'
  | 'MEMBER';

// User type
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  role: UserRole;
  workspaceId: string;
  workspaceIds?: string[];
  hasTempPassword?: boolean;
  isAdmin?: boolean;
  /** Whether mail from this installation reaches an inbox (from /auth/me). */
  mailDelivers?: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

// Workspace
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  memberIds: string[];
  settings: WorkspaceSettings;
  createdAt: string;
  updatedAt: string;
}

/** What a workspace declares about itself: exactly the keys the API keeps. */
export interface WorkspaceSettings {
  /**
   * The IANA zone this organisation's working day belongs to, e.g. 'Asia/Kolkata'.
   *
   * Attendance is filed against a DAY, and without this the day is whichever one the
   * server happens to be living in — so moving the deployment would redraw everyone's
   * attendance, and a member in another timezone saw their check-in land on a day their
   * own calendar called tomorrow. Both the API and the date helpers resolve this first
   * and fall back to the server's zone when it is unset.
   */
  timezone?: string;
  /** 'HH:MM', 24-hour: when the working day starts. Unset means 08:30. */
  workdayStart?: string;
  /** Minutes after the start before an arrival counts as late. Unset means 15. */
  lateGraceMinutes?: number;
  /**
   * Which Saturdays the office works, as a history the API keeps: each period holds
   * from its `from` day until the next, and days before the first work the 1st and 3rd
   * Saturdays. Read only — a save sends `workingSaturdays`, the rule from today on.
   */
  workingWeek?: Array<{ from: string; saturdays: number[] }>;
  /** Sent, never received: the Saturdays worked (weeks of the month, 1-5) from today on. */
  workingSaturdays?: number[];
}

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

// Project
/**
 * An update body that can say what the editor believed they were changing.
 *
 * `basedOn` holds the values those fields had when the form opened, exactly as the API
 * rendered them. The API refuses the save — 409, nothing written — if somebody else has
 * changed any of the fields this save writes; other fields they may have changed are
 * none of this edit's business and are left alone, so two people working on different
 * parts of the same record never interrupt each other.
 *
 * Omit it and the save applies unconditionally, which is the behaviour before this
 * existed. See `basedOnFor` for building one from a diff.
 */
export type EditBasedOn<T> = T & { basedOn?: Record<string, unknown> };

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  shortCode: string; // e.g., "ABC"
  description?: string;
  clientName?: string;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  ownerId: string;
  createdBy: string; // User id who created the project
  createdByName?: string; // Denormalized name for display
  createdAt: string;
  updatedAt: string;
}

// Client Requirements
export type RequirementPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RequirementStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ARCHIVED';
export type FunctionalRequirementStatus =
  | 'DRAFT'
  | 'REVIEW'
  | 'APPROVED'
  | 'IMPLEMENTED'
  | 'TESTED'
  | 'DEPLOYED';

export interface ClientRequirement {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string;
  clientName: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  createdBy: string;
  createdByName?: string; // Denormalized name for display
  createdAt: string;
  updatedAt: string;
}

// Functional Requirements
export type FRComplexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export type FRType = 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'TECHNICAL' | 'BUSINESS';

export interface FunctionalRequirement {
  id: string;
  workspaceId: string;
  projectId: string;
  hierarchyId: string; // e.g., "PTES-RAU-EAU-FRL-01" (Project-CR-Epic-FR-Seq)
  epicId?: string; // ✅ FIXED: Link to parent epic (primary parent)
  sprintId?: string; // ✅ NEW: Optional sprint assignment
  clientRequirementId?: string; // Keep for traceability
  /** Parent FR for sub-requirements; '' (not undefined) for a top-level FR. */
  parentRequirementId?: string;
  title: string;
  description: string;
  /** Classification the create/edit dialogs send; server defaults to FUNCTIONAL. */
  type?: FRType;
  complexity: FRComplexity;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; // ✅ NEW: Priority field
  status: FunctionalRequirementStatus;
  /** Its task roll-up, 0-100: the server's. */
  progress?: number;
  /** Who works on it, and their names (index-aligned; the server writes the names). */
  assigneeIds: string[];
  assigneeNames: string[];
  createdBy: string;
  createdByName?: string; // Denormalized name for display
  createdAt: string;
  updatedAt: string;
}

// Epic
export interface Epic {
  id: string;
  workspaceId: string;
  projectId: string;
  requirementId?: string; // ✅ FIXED: Link to parent requirement (not functionalRequirementId)
  hierarchyId: string;
  name: string;
  description?: string;
  color?: string;
  startDate?: string;
  endDate?: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  progress: number;
  createdBy: string;
  createdByName?: string; // Denormalized name for display
  createdAt: string;
  updatedAt: string;
}

// Sprint (Scrum)
export interface Sprint {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: 'PLANNING' | 'ACTIVE' | 'COMPLETED';
  retrospectiveNotes?: string;
  /**
   * What the sprint had actually finished when it was closed. Completion rolls
   * unfinished tasks OUT of the sprint, so counting tasks by sprintId afterwards
   * finds only the DONE ones — these are the only surviving record of the real
   * figures. Null on a sprint completed before they were recorded.
   */
  completedAt?: string | null;
  completedTaskCount?: number | null;
  totalTaskCount?: number | null;
  rolledOverTaskCount?: number | null;
  createdBy: string;
  createdByName?: string; // Denormalized name for display
  createdAt: string;
  updatedAt: string;
}

// Task Status
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Task
export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  hierarchyId: string; // e.g., "PTES-RAU-EAU-FRL-01-LOG-01" (FR-TaskCode-Seq)
  sprintId?: string;
  epicId?: string;
  functionalRequirementId?: string; // Link to FR for full hierarchy
  parentTaskId?: string; // For subtasks
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  /** Their names, index-aligned with assigneeIds. The server writes them. */
  assigneeNames: string[];
  /** Who last changed the assignees (the server stamps it). */
  assignedBy?: string;
  assignedByName?: string;
  createdBy: string;
  createdByName?: string; // Denormalized name for display
  dueDate?: string;
  estimatedHours?: number;
  labels: string[];
  position: number; // For ordering
  blockedBy: string[]; // Array of task IDs that block this task
  blocks: string[]; // Array of task IDs that this task blocks
  createdAt: string;
  /**
   * When the task last entered DONE (null while it is not done). Burndowns and
   * completion trends must bucket on this, not `updatedAt` — any edit to a done
   * task moves updatedAt and would re-date the completion.
   * The API returns it on every task (apps/api/src/modules/tasks/mappers.ts).
   */
  completedAt?: string | null;
  updatedAt: string;
}

// Task Comment
export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  mentions: string[]; // User IDs
  createdAt: string;
  updatedAt: string;
}

// Attendance
export interface Attendance {
  id: string;
  workspaceId: string;
  userId: string;
  date: string; // YYYY-MM-DD
  checkInTime: string; // ISO timestamp - MUST match database attribute name
  checkOutTime?: string; // ISO timestamp - MUST match database attribute name
  workHours?: number; // MUST match database attribute name (not workingHours)
  status: 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY';
  lateMinutes?: number; // Minutes late for check-in
  location?: string; // Check-in location
  notes?: string;
  isWeekend?: boolean;
  isHoliday?: boolean;
  createdBy?: string; // User id who created the record
  createdByName?: string; // Denormalized name for display
  createdAt: string;
  updatedAt: string;
}

// Leave Types
export type LeaveType = 'UNPAID' | 'CASUAL' | 'SICK' | 'ANNUAL' | 'MATERNITY' | 'PATERNITY' | 'BEREAVEMENT' | 'HALF_DAY' | 'COMP_OFF';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

// Leave Request
export interface LeaveRequest {
  id: string;
  workspaceId: string;
  userId: string;
  createdBy: string; // User id who created the leave request (usually same as userId)
  createdByName?: string; // Denormalized name for display
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  daysCount: number;
  createdAt: string;
  updatedAt: string;
}

// Leave Balance
export interface LeaveBalance {
  id: string;
  workspaceId: string;
  userId: string;
  year: number;
  /** Days left of the paid allowance. */
  paidLeave: number;
  /** Unpaid days TAKEN (unpaid leave is not limited). */
  unpaidLeave: number;
  halfDay: number;
  compOff: number;
  updatedAt: string;
}

// Notification
/**
 * Every type of notification the API writes. A copy of NOTIFICATION_TYPES in
 * packages/shared, which this app cannot import; apps/api checks the two are
 * the same list (notification-types.spec). Rows written before 2026-10 can
 * carry the snake_case spelling (`leave_approved`), so compare normalised.
 */
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_UNASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_PRIORITY_CHANGED'
  | 'TASK_REVIEW_REQUESTED'
  | 'TASK_REVIEWED_DONE'
  | 'TASK_COMMENT_ADDED'
  | 'TASK_COMMENT_REMOVED'
  | 'TASK_DEADLINE_REMINDER'
  | 'TASK_OVERDUE'
  | 'TASK_DELETED'
  | 'REQUIREMENT_CREATED'
  | 'EPIC_CREATED'
  | 'FR_ASSIGNED'
  | 'FR_UNASSIGNED'
  | 'SPRINT_STARTED'
  | 'SPRINT_READY_TO_CLOSE'
  | 'SPRINT_COMPLETED'
  | 'LEAVE_REQUESTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'LEAVE_BALANCE_ADJUSTED'
  | 'ATTENDANCE_CORRECTED'
  | 'TIME_ENTRY_SUBMITTED'
  | 'TIME_ENTRY_APPROVED'
  | 'TIME_ENTRY_REJECTED'
  | 'WORKSPACE_MEMBER_ADDED'
  | 'WORKSPACE_INVITATION'
  | 'WORKSPACE_ROLE_CHANGED'
  | 'WORKSPACE_OWNERSHIP_TRANSFERRED'
  | 'WORKSPACE_ACCESS_CHANGED'
  | 'WORKSPACE_MEMBER_REMOVED'
  | 'JOIN_REQUEST_RECEIVED'
  | 'JOIN_REQUEST_APPROVED'
  | 'JOIN_REQUEST_REJECTED';

export interface Notification {
  id: string;
  workspaceId: string;
  userId: string;
  /** One of NotificationType — or, on an older row, its snake_case spelling. */
  // `string & Record<never, never>` keeps NotificationType's names offered by the editor.
  type: NotificationType | (string & Record<never, never>);
  title: string;
  message: string;
  projectId?: string;
  relatedEntityId?: string;
  /** Upper- or lower-case (`LEAVE_REQUEST`, `leave_request`): compare normalised. */
  relatedEntityType?: string;
  isRead: boolean;
  createdAt: string;
}

// The integration rows are typed in hooks/use-integrations.ts, where they are
// read. The copies that used to sit here declared `accessToken`, `webhookSecret`
// and `webhookUrl` — none of which the API has ever serialized back.

// Git Commit
export interface GitCommit {
  id: string;
  projectId: string;
  provider: 'GITHUB' | 'GITLAB';
  commitSha: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  linkedTaskIds: string[]; // Parsed from commit message
  url: string;
  createdAt: string;
}

// Activity Log
export interface ActivityLog {
  id: string;
  workspaceId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// Time Tracking
export type TimeEntryStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface TimeEntry {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  userEmail: string;
  createdBy: string; // User id who created the time entry
  createdByName?: string; // Denormalized name for display
  taskId?: string;
  taskTitle?: string;
  taskHierarchyId?: string;
  projectId?: string;
  projectName?: string;
  description: string;
  startTime: string;
  endTime: string;
  duration: number; // in minutes
  isBillable: boolean;
  status: TimeEntryStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ActiveTimer {
  id: string;
  userId: string;
  taskId?: string;
  taskTitle?: string;
  taskHierarchyId?: string;
  projectId?: string;
  description: string;
  startTime: string;
  isPaused: boolean;
  pausedAt?: string;
  // SECONDS, not minutes: the column is `total_paused_time` and
  // TimeTrackingWorkflows increments it by elapsed seconds on every resume.
  totalPausedTime: number;
}

// Join Requests
export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Mirrors `joinRequestResponse` on the API. Everything the server actually
 * serialises is required here; the display fields below it are NOT on the wire
 * and must be joined in client-side (they used to be typed as required, so any
 * consumer reading `userName`/`inviteCode` silently got `undefined`).
 */
export interface JoinRequest {
  id: string;
  workspaceId: string;
  userId: string;
  message: string; // '' when the requester left no note
  status: JoinRequestStatus;
  handledBy?: string | null; // Admin/Manager userId who approved or rejected
  createdAt: string;
  updatedAt: string;

  // --- Not returned by the API: resolve from the workspace/user caches. ---
  workspaceName?: string;
  userName?: string;
  userEmail?: string;
  userAvatar?: string;
}

// Workspace Member with Role
export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userAvatar?: string;
  phone?: string;
  roleId?: string; // Reference to WorkspaceRole
  roleName?: string; // Denormalized for quick access
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED';
  joinedAt: string;
  invitedBy?: string;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Holidays
// ============================================================================

export type HolidayType = 'PUBLIC' | 'OPTIONAL' | 'RESTRICTED';

export interface Holiday {
  id: string;
  workspaceId: string;
  name: string;
  date: string; // YYYY-MM-DD format
  type: HolidayType;
  description?: string;
  recurring: boolean; // If true, repeats annually
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
