import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import { EpicsController } from './epics.controller';
import { EpicsService } from './epics.service';

@Module({
  imports: [DeletionModule],
  controllers: [EpicsController],
  providers: [EpicsService],
})
export class EpicsModule {}
