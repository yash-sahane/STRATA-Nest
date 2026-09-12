import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ArchiveService } from './archive.service';
import { DeletionSideEffectsService } from './deletion-side-effects.service';
import { EpicDeletionService } from './epic-deletion.service';
import { IntegrationDeletionService } from './integration-deletion.service';
import { ProjectDeletionService } from './project-deletion.service';
import { RequirementDeletionService } from './requirement-deletion.service';
import { SprintDeletionService } from './sprint-deletion.service';
import { TaskDeletionService } from './task-deletion.service';
import { UserDeactivationService } from './user-deactivation.service';
import { WorkspaceDeletionService } from './workspace-deletion.service';

/**
 * Delete-semantics sprint. The ONLY correct way to delete aggregate roots
 * (Workspace/Project/Sprint/Task/Epic/Requirement) and to retire users (soft
 * delete). Implements the two-zone, child-first, archive-and-cleanup design
 * from docs/domain/.
 *
 * Deps: WorkspaceAccessService + StorageService are @Global; AuthModule provides
 * RefreshTokenStore; IntegrationsModule exports GitQueueService + IntegrationAccess;
 * RealtimeModule exports RealtimeService (for explicit delete-frame emission).
 */
@Module({
  imports: [AuthModule, IntegrationsModule, RealtimeModule],
  providers: [
    ArchiveService,
    DeletionSideEffectsService,
    WorkspaceDeletionService,
    ProjectDeletionService,
    SprintDeletionService,
    TaskDeletionService,
    EpicDeletionService,
    RequirementDeletionService,
    UserDeactivationService,
    IntegrationDeletionService,
  ],
  exports: [
    WorkspaceDeletionService,
    ProjectDeletionService,
    SprintDeletionService,
    TaskDeletionService,
    EpicDeletionService,
    RequirementDeletionService,
    UserDeactivationService,
    IntegrationDeletionService,
  ],
})
export class DeletionModule {}
