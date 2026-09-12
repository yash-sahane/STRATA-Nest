/**
 * Thin proxy: forwards to `/api/v1/email/send-notification/`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { proxyToApi } from '@/lib/api/server-proxy';
import { logger } from '@/lib/logger';

/** Notification titles/messages are rendered from user-supplied data (task
 *  titles, comment text), so they must be escaped before they reach the body. */
const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      notificationTitle,
      notificationMessage,
      actionUrl,
      // Provenance, forwarded so the API can honour the RECIPIENT's email
      // opt-out for this notification type. Optional — omitted, nothing changes.
      workspaceId,
      notificationType,
    } = body;
    if (!name || !email || !notificationTitle || !notificationMessage) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const subject = notificationTitle;
    const html = `
      <p>Hi ${esc(name)},</p>
      <p>${esc(notificationMessage)}</p>
      ${actionUrl ? `<p><a href="${esc(actionUrl)}">View details</a></p>` : ''}
    `;
    // `to` is an array on the API contract (SendGenericEmailDto); a bare string
    // fails validation and the mail is never enqueued.
    const { status, data } = await proxyToApi(
      request,
      '/api/v1/email/send-notification/',
      {
        method: 'POST',
        body: {
          to: [email],
          subject,
          html,
          ...(typeof workspaceId === 'string' && workspaceId ? { workspaceId } : {}),
          ...(typeof notificationType === 'string' && notificationType
            ? { notificationType }
            : {}),
        },
      },
    );
    return NextResponse.json(data ?? {}, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logger.error('send-notification-email proxy error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
