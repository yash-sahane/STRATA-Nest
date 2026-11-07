import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import {
  ClientRequirementsController,
  FunctionalRequirementsController,
} from './requirements.controllers';
import {
  ClientRequirementsService,
  FunctionalRequirementsService,
} from './requirements.services';
import { RollupReconcileService } from './rollup-reconcile.service';

@Module({
  imports: [DeletionModule],
  controllers: [ClientRequirementsController, FunctionalRequirementsController],
  providers: [ClientRequirementsService, FunctionalRequirementsService, RollupReconcileService],
})
export class RequirementsModule {}
