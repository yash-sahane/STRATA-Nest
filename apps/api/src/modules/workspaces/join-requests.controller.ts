import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JoinRequestsService } from './collections.services';
import { CreateJoinRequestDto, UpdateJoinRequestDto } from './dto';
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

  /** [NEW] Approve → creates membership + marks request, transactionally. */
  @Post(':id/approve')
  approve(@CurrentUser() u: User, @Param('id') id: string) {
    return this.approvals.approve(u, id);
  }

  /** [NEW] Reject → marks request rejected. */
  @Post(':id/reject')
  reject(@CurrentUser() u: User, @Param('id') id: string) {
    return this.approvals.reject(u, id);
  }

  @Get(':id')
  get(@CurrentUser() u: User, @Param('id') id: string) {
    return this.svc.retrieve(u, id);
  }

  @Patch(':id')
  patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateJoinRequestDto) {
    return this.svc.patch(u, id, d);
  }

  @Put(':id')
  put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateJoinRequestDto) {
    return this.svc.patch(u, id, d);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() u: User, @Param('id') id: string) {
    return this.svc.remove(u, id);
  }
}
