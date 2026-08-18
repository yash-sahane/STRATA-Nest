/**
 * Thin proxy: forwards to Django `/api/v1/email/send-leave/`.
 * The Django endpoint accepts a generic {to, subject, html, text?} payload;
 * we render approval/rejection HTML here to keep the existing caller shape.
 */
import { NextRequest, NextResponse } from 'next/server';
import { proxyToDjango } from '@/lib/api/server-proxy';
import { logger } from '@/lib/logger';

interface ApprovalPayload {
  to: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  approverName: string;
}
interface RejectionPayload extends ApprovalPayload {
  rejectionReason: string;
}

function renderApproval(p: ApprovalPayload): { subject: string; html: string } {
  return {
    subject: `Your leave request has been approved`,
    html: `
      <p>Hi ${p.employeeName},</p>
      <p>Your <strong>${p.leaveType}</strong> leave from
        <strong>${p.startDate}</strong> to <strong>${p.endDate}</strong>
        (${p.days} day${p.days === 1 ? '' : 's'}) has been
        <strong>approved</strong> by ${p.approverName}.</p>
    `,
  };
}

function renderRejection(p: RejectionPayload): { subject: string; html: string } {
  return {
    subject: `Your leave request has been rejected`,
    html: `
      <p>Hi ${p.employeeName},</p>
      <p>Your <strong>${p.leaveType}</strong> leave from
        <strong>${p.startDate}</strong> to <strong>${p.endDate}</strong>
        (${p.days} day${p.days === 1 ? '' : 's'}) has been
        <strong>rejected</strong> by ${p.approverName}.</p>
      <p><strong>Reason:</strong> ${p.rejectionReason}</p>
    `,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ...rest } = body;
    let rendered: { subject: string; html: string };

    if (type === 'approval') {
      rendered = renderApproval(rest as ApprovalPayload);
    } else if (type === 'rejection') {
      rendered = renderRejection(rest as RejectionPayload);
    } else {
      return NextResponse.json(
        { error: 'Invalid email type. Must be "approval" or "rejection"' },
        { status: 400 },
      );
    }

    const { status, data } = await proxyToDjango(request, '/api/v1/email/send-leave/', {
      method: 'POST',
      body: { to: rest.to, subject: rendered.subject, html: rendered.html },
    });
    return NextResponse.json(data ?? {}, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logger.error('send-leave-email proxy error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
