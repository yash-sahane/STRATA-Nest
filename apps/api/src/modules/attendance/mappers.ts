import { formatApiTimestamp } from '@strata/common';
import type { Attendance, Holiday } from '@prisma/client';

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const isoOrNull = (d: Date | null): string | null => (d ? formatApiTimestamp(d) : null);

export function attendanceResponse(a: Attendance) {
  return {
    id: String(a.id),
    workspaceId: a.workspaceId,
    userId: a.userId,
    date: dateOnly(a.date),
    checkInTime: formatApiTimestamp(a.checkInTime),
    checkOutTime: isoOrNull(a.checkOutTime),
    workHours: a.workHours,
    status: a.status,
    lateMinutes: a.lateMinutes,
    location: a.location,
    notes: a.notes,
    isWeekend: a.isWeekend,
    isHoliday: a.isHoliday,
    createdBy: a.createdById,
    createdByName: a.createdByName,
    createdAt: formatApiTimestamp(a.createdAt),
    updatedAt: formatApiTimestamp(a.updatedAt),
  };
}

export function holidayResponse(h: Holiday) {
  return {
    id: String(h.id),
    workspaceId: h.workspaceId,
    name: h.name,
    date: dateOnly(h.date),
    isOptional: h.isOptional,
    description: h.description,
    createdAt: formatApiTimestamp(h.createdAt),
    updatedAt: formatApiTimestamp(h.updatedAt),
  };
}
