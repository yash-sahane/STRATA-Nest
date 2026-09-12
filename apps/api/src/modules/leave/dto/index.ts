import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimmedText } from '@strata/common';
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

export class CreateLeaveBalanceDto {
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsInt() @Min(0) year!: number;
  @IsOptional() @IsNumber() @Min(0) paidLeave?: number;
  @IsOptional() @IsNumber() @Min(0) unpaidLeave?: number;
  @IsOptional() @IsNumber() @Min(0) halfDay?: number;
  @IsOptional() @IsNumber() @Min(0) compOff?: number;
}
export class UpdateLeaveBalanceDto {
  @IsOptional() @IsNumber() @Min(0) paidLeave?: number;
  @IsOptional() @IsNumber() @Min(0) unpaidLeave?: number;
  @IsOptional() @IsNumber() @Min(0) halfDay?: number;
  @IsOptional() @IsNumber() @Min(0) compOff?: number;
}
