import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { HierarchyIdService } from './hierarchy-id.service';

/**
 * Generation persistence. `bulk-save` builds the project tree transactionally
 * with the hierarchy-id rules. The model itself is called by the web app's
 * server route (apps/frontend/src/app/api/ai-generate), with keys held there.
 */
@Module({
  controllers: [GenerationController],
  providers: [GenerationService, HierarchyIdService],
})
export class GenerationModule {}
