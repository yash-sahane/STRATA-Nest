import { Module } from '@nestjs/common';
import { EpicsController } from './epics.controller';
import { EpicsService } from './epics.service';

@Module({
  controllers: [EpicsController],
  providers: [EpicsService],
})
export class EpicsModule {}
