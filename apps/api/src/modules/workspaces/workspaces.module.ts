import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import { UsersModule } from '../users/users.module';
import { InviteCodesController, WorkspaceRolesController } from './collections.controllers';
import {
  InviteCodesService,
  JoinRequestsService,
  WorkspaceRolesService,
} from './collections.services';
import { JoinRequestsController } from './join-requests.controller';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { InvitationAcceptanceService, JoinRequestApprovalService } from './workflows.services';

@Module({
  imports: [DeletionModule, UsersModule],
  controllers: [
    WorkspacesController,
    WorkspaceMembersController,
    WorkspaceRolesController,
    InviteCodesController,
    JoinRequestsController,
  ],
  providers: [
    WorkspacesService,
    WorkspaceMembersService,
    WorkspaceRolesService,
    InviteCodesService,
    JoinRequestsService,
    InvitationAcceptanceService,
    JoinRequestApprovalService,
  ],
})
export class WorkspacesModule {}
