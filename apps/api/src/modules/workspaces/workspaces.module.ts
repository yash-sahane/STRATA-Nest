import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import {
  EmailInvitationsController,
  InviteCodesController,
  PendingAccessController,
  WorkspaceRolesController,
} from './collections.controllers';
import {
  EmailInvitationsService,
  InviteCodesService,
  JoinRequestsService,
  PendingAccessService,
  WorkspaceRolesService,
} from './collections.services';
import { JoinRequestsController } from './join-requests.controller';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { InvitationAcceptanceService, JoinRequestApprovalService } from './workflows.services';

@Module({
  imports: [DeletionModule],
  controllers: [
    WorkspacesController,
    WorkspaceMembersController,
    WorkspaceRolesController,
    InviteCodesController,
    EmailInvitationsController,
    JoinRequestsController,
    PendingAccessController,
  ],
  providers: [
    WorkspacesService,
    WorkspaceMembersService,
    WorkspaceRolesService,
    InviteCodesService,
    EmailInvitationsService,
    JoinRequestsService,
    PendingAccessService,
    InvitationAcceptanceService,
    JoinRequestApprovalService,
  ],
})
export class WorkspacesModule {}
