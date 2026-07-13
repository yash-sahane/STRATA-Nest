import { Module } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * AiModule — model/prompt infrastructure seam (kept separate from the business
 * GenerationModule). No-op today because generation runs client-side; provided
 * so the boundary exists for a future server-side move.
 */
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
