import { ForbiddenException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TimeApprovalService } from './time-tracking.workflows';

/**
 * Nobody decides their own hours — unless nobody else can. In a workspace with
 * one approver, that person's own time used to sit "awaiting approval" for good.
 */
describe('TimeApprovalService — your own entries', () => {
  const approver = { id: 'mgr', name: 'Manager', email: 'm@x.com' } as User;
  const entry = {
    id: 'te1',
    workspaceId: 'w1',
    userId: 'mgr',
    status: 'PENDING',
  };

  function build(approvers: string[]) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      timeEntry: {
        findUnique: jest.fn().mockResolvedValue(entry),
        updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...entry,
          status: 'APPROVED',
          startTime: new Date(),
          endTime: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          approvedAt: new Date(),
        }),
      },
    } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
      membersHolding: jest.fn().mockResolvedValue(approvers),
    } as unknown as WorkspaceAccessService;
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    return { svc: new TimeApprovalService(prisma, access, events), updateMany };
  }

  it('refuses approving your own entry while another approver exists', async () => {
    const { svc, updateMany } = build(['mgr', 'mgr2']);
    await expect(svc.approve(approver, 'te1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lets the only approver approve their own', async () => {
    const { svc, updateMany } = build(['mgr']);
    await svc.approve(approver, 'te1');
    expect(updateMany).toHaveBeenCalled();
  });

  // Your own entry is yours to edit or delete; "rejecting" it sent you a notice
  // about yourself.
  it('never lets you reject your own', async () => {
    const { svc, updateMany } = build(['mgr']);
    await expect(svc.reject(approver, 'te1', 'mine')).rejects.toThrow(/instead of rejecting/);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

/**
 * The owner edited the entry between the approval's read and its write: the
 * claim matched PENDING and the approval went on record against hours nobody
 * had looked at. It claims on what it read now.
 */
describe('TimeApprovalService — a decision on figures that changed under it', () => {
  const approver = { id: 'mgr', name: 'Manager', email: 'm@x.com' } as User;
  const read = {
    id: 'te2',
    workspaceId: 'w1',
    userId: 'dev',
    status: 'PENDING',
    startTime: new Date('2026-11-02T09:00:00.000Z'),
    endTime: new Date('2026-11-02T10:00:00.000Z'),
    duration: 60,
    isBillable: false,
  };

  function build(claimed: number) {
    const updateMany = jest.fn().mockResolvedValue({ count: claimed });
    const prisma = {
      timeEntry: {
        // Still pending when looked at again — so what changed was its figures.
        findUnique: jest.fn().mockResolvedValue(read),
        updateMany,
        findUniqueOrThrow: jest.fn(),
      },
    } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
      membersHolding: jest.fn().mockResolvedValue(['mgr', 'mgr2']),
    } as unknown as WorkspaceAccessService;
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    return { svc: new TimeApprovalService(prisma, access, events), updateMany, events };
  }

  it('claims on the window, the duration and the billable flag it read', async () => {
    const { svc, updateMany } = build(0);
    await expect(svc.approve(approver, 'te2')).rejects.toThrow(/changed while you were deciding/);
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: 'te2',
      status: 'PENDING',
      startTime: read.startTime,
      endTime: read.endTime,
      duration: 60,
      isBillable: false,
    });
  });

  it('announces no decision that was not made', async () => {
    const { svc, events } = build(0);
    await expect(svc.reject(approver, 'te2', 'too long')).rejects.toThrow(/changed/);
    expect((events as unknown as { emit: jest.Mock }).emit).not.toHaveBeenCalled();
  });
});
