import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../authz/permissions';
import { RequirePermission } from '../authz/require-permission.decorator';
import { RequirementDeletionService } from '../deletion/requirement-deletion.service';
import {
  CreateClientRequirementDto,
  CreateFunctionalRequirementDto,
  UpdateClientRequirementDto,
  UpdateFunctionalRequirementDto,
} from './dto';
import { ClientRequirementsService, FunctionalRequirementsService } from './requirements.services';

type Q = Record<string, string | string[] | undefined>;

/**
 * The FR rollup rule, on the Swagger surface as well as on
 * UpdateFunctionalRequirementDto — it is the one thing a caller cannot guess
 * from the DTO. Mirrors the epic rollup note in epics.controller.ts.
 */
const FR_ROLLUP_NOTE =
  'progress and status are the functional requirement task rollup. A body containing a ' +
  'progress and nothing but those two is also accepted from a caller holding task:update ' +
  '(not just requirement:write); for that caller both values are recomputed from the linked ' +
  'tasks and the submitted numbers are ignored, so task:update cannot declare a requirement ' +
  'tested or deployed. A requirement:write caller keeps the progress it sent, but its status ' +
  'is recomputed from the task counts so the pair cannot contradict itself. A status sent ' +
  'ALONE is a human decision (the sprint board moving an FR card) and still requires ' +
  'requirement:write, as does any body that touches a human-authored field.';

@ApiTags('client_requirements')
@Controller('client_requirements')
export class ClientRequirementsController {
  constructor(
    private readonly svc: ClientRequirementsService,
    private readonly deletion: RequirementDeletionService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.RequirementWrite) create(@CurrentUser() u: User, @Body() d: CreateClientRequirementDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateClientRequirementDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateClientRequirementDto) { return this.svc.patch(u, id, d); }
  /** 409 when linked FRs exist unless ?cascade=true (then dependent FRs are deleted, tasks/epics unlinked). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string, @Query('cascade') cascade?: string) { return this.deletion.deleteClientRequirement(u, id, cascade === 'true'); }
}

@ApiTags('functional_requirements')
@Controller('functional_requirements')
export class FunctionalRequirementsController {
  constructor(
    private readonly svc: FunctionalRequirementsService,
    private readonly deletion: RequirementDeletionService,
  ) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() @RequirePermission(Permission.RequirementWrite) create(@CurrentUser() u: User, @Body() d: CreateFunctionalRequirementDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') @ApiOperation({ description: FR_ROLLUP_NOTE }) patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateFunctionalRequirementDto) { return this.svc.patch(u, id, d); }
  @Put(':id') @ApiOperation({ description: FR_ROLLUP_NOTE }) put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateFunctionalRequirementDto) { return this.svc.patch(u, id, d); }
  /** 409 when child FRs exist unless ?cascade=true (then the subtree is deleted, tasks unlinked). */
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string, @Query('cascade') cascade?: string) { return this.deletion.deleteFunctionalRequirement(u, id, cascade === 'true'); }
}
