import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BasedOn, TrimmedText } from '@strata/common';
import { LEAVE_TYPES } from '../leave-balance';

export class CreateLeaveRequestDto {
  @IsString() workspaceId!: string;
  @IsIn(LEAVE_TYPES) type!: string;
  @IsString() startDate!: string;
  @IsString() endDate!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(2_000) reason!: string;
}
/** `status` is deliberately absent: transitions only happen through
 *  POST :id/approve|reject|cancel, which own the authorization and the balance
 *  movement. `daysCount` is likewise derived server-side from the range. */
export class UpdateLeaveRequestDto {
  @IsOptional() @IsIn(LEAVE_TYPES) type?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() reason?: string;
}

export class RejectLeaveDto {
  @IsOptional() @IsString() reason?: string;
}

/** POST leave_balances/adjust — set a member's allowance for a year. */
export class AdjustLeaveBalanceDto {
  /**
   * The figures the editor saw, keyed like the fields below. Sent, a figure
   * that has moved since (an approval debited it) is refused with a 409 rather
   * than overwritten; see LeaveBalancesService.adjust.
   */
  @BasedOn() basedOn?: Record<string, unknown>;
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsInt() @Min(0) year!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(366) paidLeave?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(366) halfDay?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(366) compOff?: number;
}
