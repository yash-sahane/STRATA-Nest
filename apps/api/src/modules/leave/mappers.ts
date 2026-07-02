import { toDjangoIso } from '@lt/common';
import type { LeaveBalance, LeaveRequest } from '@prisma/client';

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const isoOrNull = (d: Date | null): string | null => (d ? toDjangoIso(d) : null);

export function leaveRequestResponse(r: LeaveRequest) {
  return {
    id: String(r.id),
    workspaceId: r.workspaceId,
    userId: r.userId,
    createdBy: r.createdById,
    createdByName: r.createdByName,
    type: r.type,
    startDate: dateOnly(r.startDate),
    endDate: dateOnly(r.endDate),
    reason: r.reason,
    status: r.status,
    approvedBy: r.approvedBy,
    approvedAt: isoOrNull(r.approvedAt),
    rejectionReason: r.rejectionReason,
    daysCount: r.daysCount,
    createdAt: toDjangoIso(r.createdAt),
    updatedAt: toDjangoIso(r.updatedAt),
  };
}

export function leaveBalanceResponse(b: LeaveBalance) {
  return {
    id: String(b.id),
    workspaceId: b.workspaceId,
    userId: b.userId,
    year: b.year,
    paidLeave: b.paidLeave,
    unpaidLeave: b.unpaidLeave,
    halfDay: b.halfDay,
    compOff: b.compOff,
    createdAt: toDjangoIso(b.createdAt),
    updatedAt: toDjangoIso(b.updatedAt),
  };
}
