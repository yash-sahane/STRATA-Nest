/**
 * Approval / rejection email bodies, rendered SERVER-SIDE.
 *
 * These used to be rendered in the browser and posted to `email/send-*` with a
 * caller-supplied `to` and `html`, which made every logged-in user an
 * authenticated relay able to put arbitrary markup in a message that reads as a
 * system notification. The decision endpoints now render and send it themselves,
 * so neither the recipient nor the body ever crosses the wire.
 */

/** Every interpolated value is stored free text (a name an admin set, a
 *  rejection reason a manager typed), so it must be escaped. */
const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface LeaveDecisionEmailInput {
  employeeName: string;
  leaveType: string;
  /** Date-only 'YYYY-MM-DD' strings, as the API renders them. */
  startDate: string;
  endDate: string;
  daysCount: number;
  approverName: string;
  /** Present only for a rejection. */
  rejectionReason?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderLeaveDecisionEmail(
  decision: 'approved' | 'rejected',
  p: LeaveDecisionEmailInput,
): RenderedEmail {
  const days = `${p.daysCount} day${p.daysCount === 1 ? '' : 's'}`;
  const range = `${p.startDate} to ${p.endDate}`;
  const subject = `Your leave request has been ${decision}`;
  const reason =
    decision === 'rejected' && p.rejectionReason ? `Reason: ${p.rejectionReason}` : '';

  return {
    subject,
    text: [
      `Hi ${p.employeeName},`,
      `Your ${p.leaveType} leave from ${range} (${days}) has been ${decision} by ${p.approverName}.`,
      reason,
    ]
      .filter(Boolean)
      .join('\n\n'),
    html: [
      `<p>Hi ${esc(p.employeeName)},</p>`,
      `<p>Your <strong>${esc(p.leaveType)}</strong> leave from <strong>${esc(p.startDate)}</strong>` +
        ` to <strong>${esc(p.endDate)}</strong> (${esc(days)}) has been` +
        ` <strong>${decision}</strong> by ${esc(p.approverName)}.</p>`,
      reason ? `<p><strong>Reason:</strong> ${esc(p.rejectionReason)}</p>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
