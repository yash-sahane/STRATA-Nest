import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JoinRequestsService } from './collections.services';
import { ApproveJoinRequestDto, CreateJoinRequestDto, UpdateJoinRequestDto } from './dto';
import { JoinRequestApprovalService } from './workflows.services';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('join_requests')
@Controller('join_requests')
export class JoinRequestsController {
  constructor(
    private readonly svc: JoinRequestsService,
    private readonly approvals: JoinRequestApprovalService,
  ) {}

  @Get()
  list(@CurrentUser() u: User, @Query() q: Q) {
    return this.svc.list(u, q);
  }

  @Post()
  create(@CurrentUser() u: User, @Body() d: CreateJoinRequestDto) {
    return this.svc.create(u, d); // self-service (non-member requests to join)
  }

  /** Approve → creates membership + marks request, transactionally. */
  @Post(':id/approve')
  approve(@CurrentUser() u: User, @Param('id') id: string, @Body() d: ApproveJoinRequestDto) {
    return this.approvals.approve(u, id, d?.role);
  }

  /** Reject → marks request rejected. */
  @Post(':id/reject')
  reject(@CurrentUser() u: User, @Param('id') id: string) {
    return this.approvals.reject(u, id);
  }

  @Get(':id')
  get(@CurrentUser() u: User, @Param('id') id: string) {
    return this.svc.retrieve(u, id);
  }

  /**
   * A request is decided by approving or rejecting it — which claim it, settle
   * the membership and tell the requester. A PATCH wrote `status` and
   * `handledBy` straight onto the row instead: a "rejected" nobody was told
   * about, recorded as handled by whoever the caller named. A PATCH that
   * rejects now goes through the same reject; anything else it carries is
   * refused (see JoinRequestsService.patch).
   */
  @Patch(':id')
  async patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateJoinRequestDto) {
    if (d?.status === 'REJECTED' && d.handledBy === undefined) {
      await this.approvals.reject(u, id);
      return this.svc.retrieve(u, id);
    }
    return this.svc.patch(u, id, d);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() u: User, @Param('id') id: string) {
    return this.svc.remove(u, id);
  }
}
