import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { NotificationType } from '@strata/shared';

/**
 * "Tell these people this" — for the writes whose only consequence, outside the
 * record itself, is that somebody ought to know.
 *
 * A task assigned or moved has its own event, because several things follow
 * from it. A comment, a correction to somebody's attendance, a change to their
 * leave balance have exactly one thing follow: the person concerned should be
 * told. Those said nothing at all — an approver could rewrite a colleague's
 * hours or allowance and the first that colleague knew of it was a number that
 * looked different.
 *
 * The service that made the change says who it concerns and in what words; the
 * subscriber (WorkNotificationSubscriber) applies the rules every notice
 * shares: never the person who did it, the recipient's own preferences, and
 * mail where mail works.
 */
export const NOTICE_EVENT = 'notice.tell';

export interface NoticePayload {
  workspaceId: string;
  /** Everybody it concerns. The actor is left out by the subscriber. */
  recipients: readonly string[];
  /** Whoever did the thing; '' or absent when nobody did (a commit, a job). */
  actorId?: string;
  /** One of NOTIFICATION_TYPES: it is what a preference is keyed by. */
  type: NotificationType;
  title: string;
  message: string;
  projectId?: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  /** Also by mail, where mail is delivered and the recipient has not said no. */
  email?: boolean;
  /**
   * A reminder rather than news: skip anybody who already has an UNREAD notice
   * of this type in this workspace. Time waiting for approval is one thing to
   * go and look at, however many entries have arrived since.
   */
  oncePerUnread?: boolean;
}

/**
 * Emit a notice. `events` is optional because the services that call this take
 * the emitter as an optional constructor argument: a unit test that builds one
 * without it simply tells nobody.
 */
export function tellPeople(events: EventEmitter2 | undefined, notice: NoticePayload): void {
  if (!events || notice.recipients.length === 0) return;
  events.emit(NOTICE_EVENT, notice);
}
