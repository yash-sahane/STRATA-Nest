import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { HierarchyIdService } from './hierarchy-id.service';

/**
 * Generation persistence (business). `bulk-save` builds the project tree
 * transactionally with the exact hierarchy-id rules. Model/prompt infra is the
 * separate AiModule.
 */
@Module({
  controllers: [GenerationController],
  providers: [GenerationService, HierarchyIdService],
})
export class GenerationModule {}
