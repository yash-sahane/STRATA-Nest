import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsString() workspaceId!: string;
  @IsString() type!: string;
  @IsString() startDate!: string;
  @IsString() endDate!: string;
  @IsString() reason!: string;
  @IsOptional() @IsNumber() daysCount?: number;
}
export class UpdateLeaveRequestDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsNumber() daysCount?: number;
}

export class RejectLeaveDto {
  @IsOptional() @IsString() reason?: string;
}

export class CreateLeaveBalanceDto {
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsInt() @Min(0) year!: number;
  @IsOptional() @IsNumber() paidLeave?: number;
  @IsOptional() @IsNumber() unpaidLeave?: number;
  @IsOptional() @IsNumber() halfDay?: number;
  @IsOptional() @IsNumber() compOff?: number;
}
export class UpdateLeaveBalanceDto {
  @IsOptional() @IsNumber() paidLeave?: number;
  @IsOptional() @IsNumber() unpaidLeave?: number;
  @IsOptional() @IsNumber() halfDay?: number;
  @IsOptional() @IsNumber() compOff?: number;
}
