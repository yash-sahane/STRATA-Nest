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
  defaultWorkspaceId?: string;
  workspaceIds?: string[];
  hasTempPassword?: boolean;
  isAdmin?: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

// Workspace
export interface Workspace {
  id: string;
  name: string;
  description?: string;
  logo?: string;
  color?: string;
  ownerId: string;
  memberIds: string[];
  inviteCode: string;
  settings: WorkspaceSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  allowPublicSignup: boolean;
  requireApproval: boolean;
  defaultRole: UserRole;
  brandingEnabled: boolean;
  allowMemberInvites?: boolean;
  isPublic?: boolean;
  requireTaskApproval?: boolean;
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
  [key: string]: unknown;
}

// Project Methodology - Only Scrum supported
export type ProjectMethodology = 'SCRUM';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

// Project
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  shortCode: string; // e.g., "ABC"
  description?: string;
  clientName?: string; // ✅ NEW: Client name for the project
  logo?: string;
  color?: string;
  methodology: ProjectMethodology;
  status: ProjectStatus;
  archived: boolean;
  startDate?: string;
  endDate?: string;
  ownerId: string;
  createdBy: string; // User id who created the project
  createdByName?: string; // Denormalized name for display
  memberIds: string[];
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  enableTimeTracking: boolean;
  enableCustomFields: boolean;
  autoAssignToCreator: boolean;
  requireEstimates: boolean;
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
  attachments: Attachment[];
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
  progress?: number; // ✅ NEW: Progress percentage (0-100) based on linked tasks
  reusable: boolean;
  assignedTo?: string[]; // ✅ NEW: Array of user IDs assigned to this FR
  assignedToNames?: string[]; // ✅ NEW: Denormalized names for display
  tags?: string; // Tags as string
  linkedProjectIds?: string; // Linked project IDs as string
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
  assignedTeam?: string; // ✅ NEW: Team assignment
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
  assignedBy?: string; // User id who assigned the task
  assignedByName?: string; // Denormalized name for display
  assignedTo?: string[]; // Same as assigneeIds, but tracking the assignment explicitly
  assignedToNames?: string[]; // Denormalized names for display
  watcherIds: string[]; // Users who watch this task (get notifications)
  createdBy: string;
  createdByName?: string; // Denormalized name for display
  dueDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  labels: string[];
  attachments: Attachment[];
  customFields: Record<string, any>;
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
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

// Attachment
export interface Attachment {
  fileId: string;
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
}

// Kanban Column
export interface KanbanColumn {
  id: string;
  projectId: string;
  name: string;
  status: TaskStatus;
  wipLimit?: number;
  position: number;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

// Labels
export interface Label {
  id: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  color: string;
  description?: string;
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
  status: 'PRESENT' | 'LATE' | 'EARLY_LEAVE' | 'ABSENT' | 'LEAVE' | 'HALF_DAY';
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
export type LeaveType = 'PAID' | 'UNPAID' | 'CASUAL' | 'SICK' | 'ANNUAL' | 'MATERNITY' | 'PATERNITY' | 'BEREAVEMENT' | 'HALF_DAY' | 'COMP_OFF';
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
  paidLeave: number; // monthly: 1.5, carry forward
  unpaidLeave: number; // max 5
  halfDay: number;
  compOff: number; // max 5
  updatedAt: string;
}

// Notification
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_COMPLETED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_DUE_SOON'
  | 'TASK_OVERDUE'
  | 'TASK_DEADLINE_REMINDER'
  | 'TASK_REVIEW_REQUESTED'
  | 'TASK_REVIEWED_DONE'
  | 'TASK_COMMENT'
  | 'SPRINT_STARTED'
  | 'SPRINT_ENDING_SOON'
  | 'SPRINT_COMPLETED'
  | 'SPRINT_READY_TO_CLOSE'
  | 'SPRINT_EVENT'
  | 'EPIC_CREATED'
  | 'EPIC_UPDATED'
  | 'EPIC_COMPLETED'
  | 'FR_CREATED'
  | 'FR_UPDATED'
  | 'FR_STATUS_CHANGED'
  | 'FR_ASSIGNED'
  | 'REQUIREMENT_CREATED'
  | 'REQUIREMENT_UPDATED'
  | 'LEAVE_REQUESTED'
  | 'LEAVE_REQUEST'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'ATTENDANCE_LATE'
  | 'ATTENDANCE_MISSED'
  | 'ATTENDANCE_REMINDER'
  | 'ATTENDANCE_CHECKOUT_REMINDER'
  | 'ATTENDANCE_ALERT'
  | 'COMMENT_MENTION'
  | 'COMMENT_REPLY'
  | 'COMMENT_ON_TASK'
  | 'MENTION'
  | 'TEAM_MEMBER_ADDED'
  | 'PROJECT_INVITATION';

export interface Notification {
  id: string;
  workspaceId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId?: string;
  relatedEntityId?: string;
  relatedEntityType?: 'TASK' | 'SPRINT' | 'LEAVE' | 'ATTENDANCE' | 'EPIC' | 'FR' | 'PROJECT';
  isRead: boolean;
  createdAt: string;
}

// Integration Types
export interface GitHubIntegration {
  id: string;
  projectId: string;
  repoOwner: string;
  repoName: string;
  accessToken: string;
  webhookSecret?: string;
  autoUpdateStatus: boolean;
  enabledEvents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GitLabIntegration {
  id: string;
  projectId: string;
  projectPath: string; // owner/repo
  accessToken: string;
  webhookSecret?: string;
  autoUpdateStatus: boolean;
  enabledEvents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DiscordIntegration {
  id: string;
  projectId: string;
  webhookUrl: string;
  enabledEvents: string[];
  createdAt: string;
  updatedAt: string;
}

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
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt: string;
}

// Analytics types
export interface TaskAnalytics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
  byAssignee: Record<string, number>;
  completionRate: number;
  avgCompletionTime: number;
}

export interface SprintAnalytics {
  velocity: number;
  burndownData: { date: string; remaining: number }[];
  completionRate: number;
}

export interface AttendanceAnalytics {
  totalDays: number;
  presentDays: number;
  lateDays: number;
  leaveDays: number;
  avgWorkingHours: number;
  attendanceRate: number;
}

// Dashboard Widget
export interface DashboardWidget {
  id: string;
  type: 'TASKS' | 'SPRINTS' | 'ATTENDANCE' | 'LEAVE' | 'ACTIVITY';
  title: string;
  size: 'SMALL' | 'MEDIUM' | 'LARGE';
  position: { x: number; y: number };
  config: Record<string, any>;
}

// Time Tracking
export type TimeEntryStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type TimeEntryType = 'MANUAL' | 'TIMER' | 'POMODORO';

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
  billableRate?: number; // hourly rate
  type: TimeEntryType;
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
  type: 'TIMER' | 'POMODORO';
  pomodoroSettings?: {
    workDuration: number; // in minutes (default: 25)
    breakDuration: number; // in minutes (default: 5)
    longBreakDuration: number; // in minutes (default: 15)
    longBreakInterval: number; // after how many pomodoros (default: 4)
    currentSession: number; // current pomodoro session count
    isBreak: boolean; // is currently on break
  };
}

export interface TimeReport {
  userId: string;
  userName: string;
  userEmail: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  totalBillableAmount: number;
  entriesCount: number;
  byProject: {
    projectId: string;
    projectName: string;
    hours: number;
    billableHours: number;
    amount: number;
  }[];
  byTask: {
    taskId: string;
    taskTitle: string;
    hierarchyId: string;
    hours: number;
    billableHours: number;
  }[];
  byDate: {
    date: string;
    hours: number;
    billableHours: number;
  }[];
}

export interface TimesheetDay {
  date: string;
  entries: TimeEntry[];
  totalHours: number;
  billableHours: number;
  isWeekend: boolean;
  isToday: boolean;
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

// Workspace Roles
export interface WorkspaceRole {
  id: string;
  workspaceId: string;
  name: string; // e.g., "Software Developer", "QA Engineer"
  description?: string;
  permissions: RolePermissions;
  color?: string; // For badge display
  isCustom: boolean; // true for user-created roles
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RolePermissions {
  // Project permissions
  canCreateProjects: boolean;
  canEditProjects: boolean;
  canDeleteProjects: boolean;
  canArchiveProjects: boolean;

  // Task permissions
  canCreateTasks: boolean;
  canEditAllTasks: boolean;
  canEditOwnTasks: boolean;
  canDeleteTasks: boolean;
  canAssignTasks: boolean;

  // Sprint permissions
  canCreateSprints: boolean;
  canEditSprints: boolean;
  canDeleteSprints: boolean;
  canStartSprints: boolean;
  canCompleteSprints: boolean;

  // Requirements permissions
  canCreateRequirements: boolean;
  canEditRequirements: boolean;
  canDeleteRequirements: boolean;
  canApproveRequirements: boolean;

  // Team permissions
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canEditMemberRoles: boolean;
  canViewAllMembers: boolean;

  // Time tracking permissions
  canTrackTime: boolean;
  canEditOwnTime: boolean;
  canEditAllTime: boolean;
  canApproveTime: boolean;

  // Leave permissions
  canRequestLeave: boolean;
  canApproveLeave: boolean;
  canViewAllLeave: boolean;

  // Workspace permissions
  canEditWorkspaceSettings: boolean;
  canDeleteWorkspace: boolean;
  canManageBilling: boolean;

  // Analytics permissions
  canViewAnalytics: boolean;
  canExportData: boolean;
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
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  joinedAt: string;
  invitedBy?: string;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Enhanced Invitation System
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'REVOKED';
export type InvitationType = 'EMAIL' | 'CODE';

// Email Invitation
export interface EmailInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: UserRole;
  invitedBy: string;
  inviterName: string;
  status: InvitationStatus;
  inviteCode: string; // Unique code for this invitation
  expiresAt?: string; // Optional expiration
  acceptedAt?: string;
  acceptedByUserId?: string;
  rejectedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  emailSent: boolean;
  emailSentAt?: string;
  remindersSent: number;
  lastReminderAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Invite Code
export interface InviteCode {
  id: string;
  workspaceId: string;
  workspaceName: string;
  code: string; // The actual invite code
  role: UserRole;
  createdBy: string;
  creatorName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'DEPLETED';
  expiresAt?: string; // Optional expiration date
  maxUses?: number; // Optional max number of uses (null = unlimited)
  currentUses: number;
  usedBy: string[]; // Array of userIds who used this code
  requiresApproval: boolean; // If true, join requests need admin approval
  description?: string; // Optional description for the code
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  createdAt: string;
  updatedAt: string;
}

// Invitation Metadata (for tracking)
export interface InvitationMetadata {
  totalEmailInvites: number;
  totalCodeInvites: number;
  pendingEmailInvites: number;
  pendingCodeInvites: number;
  acceptedInvites: number;
  rejectedInvites: number;
  expiredInvites: number;
  revokedInvites: number;
  activeCodes: number;
  expiredCodes: number;
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
