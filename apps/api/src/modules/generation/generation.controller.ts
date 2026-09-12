import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { BulkSaveDto } from './dto';
import { GenerationService } from './generation.service';

/**
 * POST /bulk-save — atomic creation of the CR→Epic→FR→Task tree. Gated on the
 * same RequirementWrite permission as the individual create routes. The
 * optional `Idempotency-Key` header makes retries safe (same key → same tree).
 */
@ApiTags('generation')
@Controller('bulk-save')
export class GenerationController {
  constructor(private readonly svc: GenerationService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.RequirementWrite)
  bulkSave(
    @CurrentUser() user: User,
    @Body() dto: BulkSaveDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.svc.bulkSave(user, dto, idempotencyKey);
  }
}
