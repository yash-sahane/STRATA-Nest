import { Module } from '@nestjs/common';
import { LeaveApprovalService } from './leave-approval.service';
import { LeaveBalancesController, LeaveRequestsController } from './leave.controllers';
import { LeaveBalancesService, LeaveRequestsService } from './leave.services';

@Module({
  controllers: [LeaveRequestsController, LeaveBalancesController],
  providers: [LeaveRequestsService, LeaveBalancesService, LeaveApprovalService],
})
export class LeaveModule {}
