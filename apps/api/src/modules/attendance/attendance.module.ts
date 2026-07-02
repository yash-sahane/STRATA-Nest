import { Module } from '@nestjs/common';
import { AttendanceController, HolidaysController } from './attendance.controllers';
import { AttendanceService, HolidaysService } from './attendance.services';

@Module({
  controllers: [AttendanceController, HolidaysController],
  providers: [AttendanceService, HolidaysService],
})
export class AttendanceModule {}
