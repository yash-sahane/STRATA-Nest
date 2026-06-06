/**
 * Thin proxy: forwards to Django `/api/v1/email/send-notification/`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { proxyToDjango } from '@/lib/api/server-proxy';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, notificationTitle, notificationMessage, actionUrl } = body;
    if (!name || !email || !notificationTitle || !notificationMessage) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const subject = notificationTitle;
    const html = `
      <p>Hi ${name},</p>
      <p>${notificationMessage}</p>
      ${actionUrl ? `<p><a href="${actionUrl}">View details</a></p>` : ''}
    `;
    const { status, data } = await proxyToDjango(
      request,
      '/api/v1/email/send-notification/',
      { method: 'POST', body: { to: email, subject, html } },
    );
    return NextResponse.json(data ?? {}, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logger.error('send-notification-email proxy error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
